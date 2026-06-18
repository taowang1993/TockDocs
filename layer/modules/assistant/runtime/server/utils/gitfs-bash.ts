import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, posix } from 'node:path'
import { tool } from 'ai'
import type { Bash as JustBash, BashExecResult, MountableFs as JustBashMountableFs } from 'just-bash'
import { Bash, InMemoryFs, MountableFs, ReadWriteFs } from 'just-bash'
import { z } from 'zod'
import { GitHubProvider, GitRepoFilesystem, PersistentGitFsCache } from '@taowang1993/gitfs'

const DEFAULT_GITFS_OWNER = 'taowang1993'
const DEFAULT_GITFS_REPO = 'tockdocs'
const DEFAULT_GITFS_REF = 'main'
const DEFAULT_GITFS_ROOT = 'docs/content'
const DEFAULT_GITFS_CACHE_DIR = '/tmp/gitfs-cache'
const DEFAULT_GITFS_WORKSPACE_ROOT = '/tmp/tockdocs-assistant-workspace'
const GITFS_BASH_TIMEOUT_MS = 30_000
const DEFAULT_GITFS_PREFETCH_FILE_LIMIT = 80
const DEFAULT_GITFS_PREFETCH_CONCURRENCY = 8
const ALLOWED_GITFS_ROOTS = ['/repo', '/workspace'] as const

export interface GitFsBashOptions {
  githubToken: string
  owner?: string
  repo?: string
  ref?: string
  root?: string
  cacheDir?: string
  workspaceRoot?: string
  fetch?: typeof globalThis.fetch
  prefetchFileLimit?: number
  prefetchConcurrency?: number
}

export type GitFsBashContext = {
  bash: JustBash
  repoFs: GitRepoFilesystem
  fs: JustBashMountableFs
  workspaceDir: string
}

function logGitFs(step: string, data: Record<string, unknown>) {
  console.info(`[tockdocs-gitfs] ${JSON.stringify({ step, ...data })}`)
}

function tokenizeCommand(command: string) {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | '\'' | null = null
  let escaped = false

  const flush = () => {
    if (current.length === 0) {
      return
    }

    tokens.push(current)
    current = ''
  }

  for (const char of command) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\' && quote !== '\'') {
      escaped = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
        continue
      }

      current += char
      continue
    }

    if (char === '"' || char === '\'') {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      flush()
      continue
    }

    if ('|&;()<>'.includes(char)) {
      flush()
      continue
    }

    current += char
  }

  if (escaped) {
    current += '\\'
  }

  flush()

  return tokens
}

function getTokenValue(token: string) {
  const equalsIndex = token.indexOf('=')
  return equalsIndex === -1 ? token : token.slice(equalsIndex + 1)
}

function hasParentTraversal(token: string) {
  const value = getTokenValue(token)

  return value === '..'
    || value.startsWith('../')
    || value.startsWith('..\\')
    || value.includes('/../')
    || value.endsWith('/..')
}

function getAbsolutePathCandidates(tokens: string[]) {
  const candidates: string[] = []

  for (const token of tokens) {
    if (token.startsWith('/')) {
      candidates.push(token)
      continue
    }

    const value = getTokenValue(token)
    if (value.startsWith('/')) {
      candidates.push(value)
    }
  }

  return candidates
}

function isAllowedVirtualPath(path: string) {
  return ALLOWED_GITFS_ROOTS.some(root => path === root || path.startsWith(`${root}/`))
}

export function validateGitFsCommand(command: string) {
  const trimmedCommand = command.trim()

  if (!trimmedCommand) {
    throw new Error('Command cannot be empty.')
  }

  const tokens = tokenizeCommand(trimmedCommand)
  const traversalToken = tokens.find(hasParentTraversal)

  if (traversalToken) {
    throw new Error('Parent-directory traversal is blocked. Use absolute paths under /repo or /workspace.')
  }

  const disallowedPath = getAbsolutePathCandidates(tokens)
    .map(candidate => posix.normalize(candidate))
    .find(candidate => !isAllowedVirtualPath(candidate))

  if (disallowedPath) {
    throw new Error(`Commands may only access /repo or /workspace. Found disallowed path: ${disallowedPath}`)
  }
}

function formatBashResult(result: BashExecResult) {
  const stdout = result.stdout.trim()
  const stderr = result.stderr.trim()

  if (result.exitCode === 0) {
    return stdout || stderr || '(no output)'
  }

  const sections = [`exitCode: ${result.exitCode}`]

  if (stdout) {
    sections.push(`stdout:\n${stdout}`)
  }

  if (stderr) {
    sections.push(`stderr:\n${stderr}`)
  }

  return sections.join('\n\n')
}

export async function executeGitFsCommand(bash: JustBash, command: string, timeoutMs = GITFS_BASH_TIMEOUT_MS) {
  const startedAt = performance.now()
  let abortTimer: ReturnType<typeof setTimeout> | undefined

  try {
    validateGitFsCommand(command)

    const abortController = new AbortController()
    abortTimer = setTimeout(() => {
      abortController.abort(new Error(`Command timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const result = await bash.exec(command, { signal: abortController.signal })

    logGitFs('gitfs_bash_exec', {
      command,
      exitCode: result.exitCode,
      durationMs: Number((performance.now() - startedAt).toFixed(1)),
    })

    return result
  }
  catch (error) {
    logGitFs('gitfs_bash_exec', {
      command,
      durationMs: Number((performance.now() - startedAt).toFixed(1)),
      error: error instanceof Error ? error.message : String(error),
    })

    throw error
  }
  finally {
    if (abortTimer) {
      clearTimeout(abortTimer)
    }
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && value && value > 0
    ? Math.floor(value)
    : fallback
}

async function prefetchGitFsFiles(repoFs: GitRepoFilesystem, options: Pick<GitFsBashOptions, 'prefetchFileLimit' | 'prefetchConcurrency'>) {
  const prefetchStartedAt = performance.now()
  const allPaths = repoFs.getAllPaths()
  const prefetchFileLimit = normalizePositiveInteger(options.prefetchFileLimit, DEFAULT_GITFS_PREFETCH_FILE_LIMIT)
  const prefetchConcurrency = normalizePositiveInteger(options.prefetchConcurrency, DEFAULT_GITFS_PREFETCH_CONCURRENCY)
  const candidatePaths = allPaths
    .filter(p => p !== '/' && !p.endsWith('/'))
    .slice(0, prefetchFileLimit)

  let prefetchedCount = 0
  let skippedCount = 0

  for (let index = 0; index < candidatePaths.length; index += prefetchConcurrency) {
    const chunk = candidatePaths.slice(index, index + prefetchConcurrency)
    const results = await Promise.allSettled(
      chunk.map(async (p) => {
        try {
          await repoFs.readFile(p)
          return true
        }
        catch {
          // Directories throw EISDIR; silently skip non-file entries.
          return false
        }
      }),
    )

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        prefetchedCount += 1
      }
      else {
        skippedCount += 1
      }
    }
  }

  const prefetchMs = Number((performance.now() - prefetchStartedAt).toFixed(1))
  logGitFs('gitfs_prefetch', {
    fileCount: allPaths.length,
    candidateCount: candidatePaths.length,
    prefetchFileLimit,
    prefetchConcurrency,
    prefetchedCount,
    skippedCount,
    omittedCount: Math.max(0, allPaths.length - candidatePaths.length),
    durationMs: prefetchMs,
  })
}

export async function createGitFsBash(options: GitFsBashOptions): Promise<GitFsBashContext> {
  const startedAt = performance.now()
  const cacheDir = options.cacheDir ?? DEFAULT_GITFS_CACHE_DIR
  const workspaceRoot = options.workspaceRoot ?? DEFAULT_GITFS_WORKSPACE_ROOT
  const workspaceDir = join(workspaceRoot, randomUUID())

  mkdirSync(cacheDir, { recursive: true })
  mkdirSync(workspaceDir, { recursive: true })

  const provider = new GitHubProvider({
    owner: options.owner ?? DEFAULT_GITFS_OWNER,
    repo: options.repo ?? DEFAULT_GITFS_REPO,
    token: options.githubToken,
    fetch: options.fetch,
  })

  const repoFs = await GitRepoFilesystem.create({
    provider,
    ref: options.ref ?? DEFAULT_GITFS_REF,
    root: options.root ?? DEFAULT_GITFS_ROOT,
    cache: new PersistentGitFsCache({ dir: cacheDir }),
  })

  // Warm a bounded number of file blobs so the first rg / cat command
  // avoids a cold-cache penalty without letting one public request fan out
  // across an entire repository tree.
  await prefetchGitFsFiles(repoFs, options)

  const fs = new MountableFs({ base: new InMemoryFs() })
  fs.mount('/repo', repoFs)
  fs.mount('/workspace', new ReadWriteFs({ root: workspaceDir }))

  const bash = new Bash({
    fs,
    cwd: '/workspace',
  })

  const repoInfo = repoFs.info()
  logGitFs('gitfs_init', {
    providerId: repoInfo.providerId,
    ref: repoInfo.ref,
    root: repoInfo.root,
    commitSha: repoInfo.commitSha,
    committedAt: repoInfo.committedAt,
    warnings: repoInfo.warnings,
    fileCount: repoFs.getAllPaths().length,
    bootMs: Number((performance.now() - startedAt).toFixed(1)),
  })

  return {
    bash,
    repoFs,
    fs,
    workspaceDir,
  }
}

export interface GitFsRepoUrlContext {
  /** The TockDocs site origin, e.g. https://tockdocs.vercel.app */
  siteUrl: string
  /** The Nuxt Content route prefix, e.g. /docs/chemistry/zh or /zh */
  routePrefix: string
  /** The GitFS root path within the repo, e.g. docs/content/chemistry/zh */
  gitFsRoot: string
  /** The GitHub owner of the source repo */
  owner: string
  /** The GitHub repo name */
  repo: string
  /** The Git ref (branch/tag) */
  ref: string
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toDocsRoutePath(path: string): string {
  let result = path.replace(/\.mdc?$/, '')

  // Strip numeric ordering prefixes from each path segment.
  // TockDocs drops leading digits + dot (e.g. "06.elements-compounds" → "elements-compounds")
  // when generating public routes from ordered content filenames.
  result = result.split('/').map(segment => segment.replace(/^\d+\./, '')).join('/')

  return result
}

/**
 * Creates a deterministic mapper from filesystem repo paths and GitHub URLs
 * to the corresponding TockDocs documentation URLs.
 */
export function createRepoPathToUrlMapper(ctx: GitFsRepoUrlContext) {
  const baseUrl = ctx.siteUrl.replace(/\/$/, '')
  const prefix = ctx.routePrefix.startsWith('/') ? ctx.routePrefix : `/${ctx.routePrefix}`

  const ghBlobPattern = new RegExp(
    `^https://github\\.com/${escapeRegex(ctx.owner)}/${escapeRegex(ctx.repo)}/blob/${escapeRegex(ctx.ref)}/${escapeRegex(ctx.gitFsRoot)}/(.+\\.mdc?)$`,
  )
  const ghRawPattern = new RegExp(
    `^https://raw\\.githubusercontent\\.com/${escapeRegex(ctx.owner)}/${escapeRegex(ctx.repo)}/${escapeRegex(ctx.ref)}/${escapeRegex(ctx.gitFsRoot)}/(.+\\.mdc?)$`,
  )

  return (filePathOrUrl: string): string | undefined => {
    // Case 1: /repo/{path}.md → TockDocs URL (without extension)
    const repoPath = filePathOrUrl.match(/^\/repo\/(.+\.mdc?)$/)?.[1]
    if (repoPath) {
      return `${baseUrl}${prefix}/${toDocsRoutePath(repoPath)}`
    }

    // Case 2: GitHub blob URL → TockDocs URL (without extension)
    const ghBlobPath = filePathOrUrl.match(ghBlobPattern)?.[1]
    if (ghBlobPath) {
      return `${baseUrl}${prefix}/${toDocsRoutePath(ghBlobPath)}`
    }

    // Case 3: GitHub raw URL → TockDocs URL (without extension)
    const ghRawPath = filePathOrUrl.match(ghRawPattern)?.[1]
    if (ghRawPath) {
      return `${baseUrl}${prefix}/${toDocsRoutePath(ghRawPath)}`
    }

    return undefined
  }
}

/**
 * Replaces all filesystem paths and GitHub URLs in a text string with
 * the proper TockDocs URLs using the provided mapper.
 */
export function replaceRepoPathsInText(
  text: string,
  repoPathToUrl: (pathOrUrl: string) => string | undefined,
): string {
  let result = text

  // Pattern 1: Markdown links with /repo/ path → replace URL part
  // [text](/repo/path.md) → [text](tockdocs-url)
  result = result.replace(
    /\[([^\]]*)\]\((\/repo\/[^\s)]+\.mdc?)\)/g,
    (full, label, path) => {
      const url = repoPathToUrl(path)
      return url ? `[${label}](${url})` : full
    },
  )

  // Pattern 2: Backtick-wrapped /repo/ paths → replace content with URL
  // `/repo/path.md` → `tockdocs-url`
  result = result.replace(
    /`(\/repo\/[^`\s]+\.mdc?)`/g,
    (full, path) => {
      const url = repoPathToUrl(path)
      return url ? `\`${url}\`` : full
    },
  )

  // Pattern 3: Plain /repo/ paths → replace with markdown link
  // Use negative lookbehind for `]() and backtick to avoid double-processing
  result = result.replace(
    /(?<!\]\()(?<!`)(\/repo\/[^\s)]+\.mdc?)/g,
    (full, path) => {
      const url = repoPathToUrl(path)
      if (!url) return full
      const label = path.split('/').pop()?.replace(/\.mdc?$/, '') || 'page'
      return `[${label}](${url})`
    },
  )

  // Pattern 4: GitHub blob URLs → replace with TockDocs URL if mappable
  result = result.replace(
    /https:\/\/github\.com\/[^\s)]+\/blob\/[^\s)]+\.mdc?/g,
    (url) => {
      const mapped = repoPathToUrl(url)
      return mapped || url
    },
  )

  // Pattern 5: GitHub raw URLs → replace with TockDocs URL if mappable
  result = result.replace(
    /https:\/\/raw\.githubusercontent\.com\/[^\s)]+\.mdc?/g,
    (url) => {
      const mapped = repoPathToUrl(url)
      return mapped || url
    },
  )

  return result
}

/**
 * Creates an AI SDK stream transform that deterministically replaces
 * /repo/ filesystem paths and GitHub URLs in text-delta chunks with
 * the proper TockDocs documentation URLs.
 *
 * Uses a small sliding buffer (200 chars) so that paths split across
 * chunk boundaries are still captured and replaced.
 */
export function createGitFsUrlTransform(
  repoPathToUrl: (pathOrUrl: string) => string | undefined,
) {
  let buffer = ''

  // The returned function matches the `StreamTextTransform` signature
  // from the AI SDK: (options: { tools, stopStream }) => TransformStream.
  // We ignore the options because our transform only needs the URL mapper.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (_options: any) =>
    new TransformStream({
      transform(chunk: { type?: string, textDelta?: string }, controller: TransformStreamDefaultController) {
        if (chunk.type === 'text-delta' && chunk.textDelta) {
          buffer += chunk.textDelta

          // Keep the last 200 chars in the buffer in case they contain
          // a partial /repo/... path or GitHub URL spanning a boundary.
          const bufferWindow = 200
          const safeLength = Math.max(0, buffer.length - bufferWindow)

          if (safeLength > 0) {
            const safe = buffer.slice(0, safeLength)
            buffer = buffer.slice(safeLength)
            const transformed = replaceRepoPathsInText(safe, repoPathToUrl)
            controller.enqueue({ ...chunk, textDelta: transformed })
          }
          // If safeLength is 0, we hold the entire chunk in the buffer
          // without emitting (it might be the start of a path pattern).
          // The next chunk will accumulate enough for safeLength > 0.
        }
        else if (chunk.type === 'text-end') {
          // Flush remaining buffer before the text-end event
          if (buffer) {
            const transformed = replaceRepoPathsInText(buffer, repoPathToUrl)
            buffer = ''
            controller.enqueue({ ...chunk, type: 'text-delta', textDelta: transformed })
          }
          controller.enqueue(chunk)
        }
        else {
          controller.enqueue(chunk)
        }
      },
    })
}

export function createBashTool(
  bash: JustBash,
  repoPathToUrl?: (pathOrUrl: string) => string | undefined,
) {
  return tool({
    description: 'Execute a bash command in the current documentation filesystem. Documentation is mounted read-only at /repo and scratch files may be written to /workspace. Use rg to search (faster than grep), cat to read files, ls to explore directories, and find to discover files.',
    inputSchema: z.object({
      command: z.string().min(1).describe('The bash command to execute. Prefer absolute paths under /repo or /workspace.'),
    }),
    execute: async ({ command }) => {
      const result = await executeGitFsCommand(bash, command)
      let output = formatBashResult(result)

      // Augment cat output with the proper TockDocs URL so the model
      // can cite the page correctly instead of using filesystem paths.
      if (repoPathToUrl) {
        const catMatch = command.match(/\bcat\s+\/repo\/(.+\.mdc?)/)
        if (catMatch) {
          const url = repoPathToUrl(`/repo/${catMatch[1]}`)
          if (url) {
            output += `\n\n---\nPage URL: ${url}`
          }
        }
      }

      return output
    },
  })
}
