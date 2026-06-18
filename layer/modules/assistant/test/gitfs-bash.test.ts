import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Bash as JustBash, BashExecResult } from 'just-bash'
import { createBashTool, createGitFsBash, createRepoPathToUrlMapper, executeGitFsCommand, replaceRepoPathsInText, validateGitFsCommand } from '../runtime/server/utils/gitfs-bash'
import { getGitFsSystemPrompt, getIndexSystemPrompt, getMcpSystemPrompt } from '../runtime/server/utils/system-prompt'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function encodeBase64(content: string) {
  return Buffer.from(content, 'utf8').toString('base64')
}

function createToolExecutionOptions() {
  return {
    toolCallId: 'call-1',
    messages: [],
  }
}

test('createGitFsBash initializes GitFS + bash with a mocked GitHub API', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'tockdocs-gitfs-'))
  const cacheDir = join(tempRoot, 'cache')
  const workspaceRoot = join(tempRoot, 'workspace')
  const requests: string[] = []

  const fetchMock: typeof fetch = async (input) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url

    requests.push(url)

    if (url.endsWith('/repos/taowang1993/tockdocs/commits/main')) {
      return jsonResponse({
        sha: 'commit-sha',
        commit: {
          tree: { sha: 'tree-sha' },
          committer: { date: '2025-01-02T03:04:05.000Z' },
        },
      })
    }

    if (url.endsWith('/repos/taowang1993/tockdocs/git/trees/tree-sha?recursive=1')) {
      return jsonResponse({
        truncated: false,
        tree: [
          { path: 'docs', type: 'tree', sha: 'docs-tree', mode: '040000' },
          { path: 'docs/content', type: 'tree', sha: 'content-tree', mode: '040000' },
          { path: 'docs/content/manual', type: 'tree', sha: 'manual-tree', mode: '040000' },
          { path: 'docs/content/manual/en', type: 'tree', sha: 'en-tree', mode: '040000' },
          { path: 'docs/content/manual/en/index.md', type: 'blob', sha: 'index-blob', mode: '100644', size: 42 },
          { path: 'docs/content/manual/en/guide.mdc', type: 'blob', sha: 'guide-blob', mode: '100644', size: 32 },
        ],
      })
    }

    if (url.endsWith('/repos/taowang1993/tockdocs/git/blobs/index-blob')) {
      return jsonResponse({
        encoding: 'base64',
        content: encodeBase64('# Welcome\n\nGitFS-backed docs.\n'),
      })
    }

    if (url.endsWith('/repos/taowang1993/tockdocs/git/blobs/guide-blob')) {
      return jsonResponse({
        encoding: 'base64',
        content: encodeBase64('# Guide\n\nMore details here.\n'),
      })
    }

    return jsonResponse({ message: `Unhandled request: ${url}` }, 404)
  }

  try {
    const { bash, repoFs } = await createGitFsBash({
      githubToken: 'test-token',
      owner: 'taowang1993',
      repo: 'tockdocs',
      ref: 'main',
      root: 'docs/content/manual/en',
      cacheDir,
      workspaceRoot,
      fetch: fetchMock,
    })

    const lsResult = await executeGitFsCommand(bash, 'ls /repo')
    const catResult = await executeGitFsCommand(bash, 'cat /repo/index.md')

    assert.equal(repoFs.info().commitSha, 'commit-sha')
    assert.match(lsResult.stdout, /guide\.mdc/)
    assert.match(lsResult.stdout, /index\.md/)
    assert.match(catResult.stdout, /GitFS-backed docs\./)
    // 1 resolveRef + 1 listTree + 2 blob fetches (pre-fetch caches index.md and guide.mdc)
    assert.equal(requests.length, 4)
  }
  finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('createGitFsBash caps eager blob prefetches', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'tockdocs-gitfs-cap-'))
  const cacheDir = join(tempRoot, 'cache')
  const workspaceRoot = join(tempRoot, 'workspace')
  const blobRequests: string[] = []

  const fetchMock: typeof fetch = async (input) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url

    if (url.endsWith('/repos/taowang1993/tockdocs/commits/main')) {
      return jsonResponse({
        sha: 'commit-sha',
        commit: {
          tree: { sha: 'tree-sha' },
          committer: { date: '2025-01-02T03:04:05.000Z' },
        },
      })
    }

    if (url.endsWith('/repos/taowang1993/tockdocs/git/trees/tree-sha?recursive=1')) {
      return jsonResponse({
        truncated: false,
        tree: [
          { path: 'docs/content/manual/en/one.md', type: 'blob', sha: 'one-blob', mode: '100644', size: 10 },
          { path: 'docs/content/manual/en/two.md', type: 'blob', sha: 'two-blob', mode: '100644', size: 10 },
          { path: 'docs/content/manual/en/three.md', type: 'blob', sha: 'three-blob', mode: '100644', size: 10 },
        ],
      })
    }

    const blobMatch = url.match(/\/repos\/taowang1993\/tockdocs\/git\/blobs\/(.+)$/)
    if (blobMatch) {
      blobRequests.push(blobMatch[1])
      return jsonResponse({
        encoding: 'base64',
        content: encodeBase64(`# ${blobMatch[1]}\n`),
      })
    }

    return jsonResponse({ message: `Unhandled request: ${url}` }, 404)
  }

  try {
    await createGitFsBash({
      githubToken: 'test-token',
      owner: 'taowang1993',
      repo: 'tockdocs',
      ref: 'main',
      root: 'docs/content/manual/en',
      cacheDir,
      workspaceRoot,
      fetch: fetchMock,
      prefetchFileLimit: 1,
      prefetchConcurrency: 1,
    })

    assert.equal(blobRequests.length, 1)
  }
  finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('createBashTool formats command output and non-zero exits', async () => {
  const commands: string[] = []
  const bash = {
    exec: async (command: string): Promise<BashExecResult> => {
      commands.push(command)

      return {
        stdout: '',
        stderr: 'No such file or directory',
        exitCode: 1,
        env: {},
      }
    },
  } as unknown as JustBash

  const bashTool = createBashTool(bash)
  assert.ok(bashTool.execute)

  const result = await bashTool.execute({ command: 'cat /repo/missing.md' }, createToolExecutionOptions())

  assert.deepEqual(commands, ['cat /repo/missing.md'])
  assert.match(result, /exitCode: 1/)
  assert.match(result, /No such file or directory/)
})

test('createBashTool appends Page URL for cat commands when URL mapper is provided', async () => {
  const bash = {
    exec: async (): Promise<BashExecResult> => ({
      stdout: '# Welcome\n\nHello world.\n',
      stderr: '',
      exitCode: 0,
      env: {},
    }),
  } as unknown as JustBash

  const mapper = createRepoPathToUrlMapper({
    siteUrl: 'https://example.com',
    routePrefix: '/docs/manual/en',
    gitFsRoot: 'docs/content/manual/en',
    owner: 'taowang1993',
    repo: 'tockdocs',
    ref: 'main',
  })

  const bashTool = createBashTool(bash, mapper)
  const result = await bashTool.execute({ command: 'cat /repo/guide.md' }, createToolExecutionOptions())

  assert.match(result, /Hello world/)
  assert.match(result, /Page URL: https:\/\/example\.com\/docs\/manual\/en\/guide/)
})

test('createBashTool propagates execution errors', async () => {
  const bash = {
    exec: async () => {
      throw new Error('kaboom')
    },
  } as unknown as JustBash

  const bashTool = createBashTool(bash)
  assert.ok(bashTool.execute)

  await assert.rejects(
    () => bashTool.execute({ command: 'ls /repo' }, createToolExecutionOptions()),
    /kaboom/,
  )
})

test('validateGitFsCommand rejects path traversal outside mounted roots', () => {
  assert.throws(
    () => validateGitFsCommand('cat ../secret.txt'),
    /Parent-directory traversal is blocked/,
  )

  assert.throws(
    () => validateGitFsCommand('cat /tmp/secret.txt'),
    /Commands may only access \/repo or \/workspace/,
  )

  assert.doesNotThrow(() => validateGitFsCommand('cat /repo/index.md'))
})

test('gitfs system prompt includes bash-specific guidance', () => {
  const prompt = getGitFsSystemPrompt('TockDocs', 'manual/en', {
    title: 'Manual',
    description: 'Core TockDocs guides',
    assistantName: 'Manual Assistant',
  }, 'https://example.com')

  assert.match(prompt, /bash tool/)
  assert.match(prompt, /rg "keyword" \/repo/)
  assert.match(prompt, /ALWAYS use `cat` on the full file before answering/)
  assert.match(prompt, /NEVER cite raw filesystem paths/)
  assert.match(prompt, /NEVER construct or link to github\.com/)
  assert.match(prompt, /https:\/\/example\.com/)
})

test('createRepoPathToUrlMapper maps repo paths to TockDocs URLs', () => {
  const mapper = createRepoPathToUrlMapper({
    siteUrl: 'https://example.com',
    routePrefix: '/docs/manual/en',
    gitFsRoot: 'docs/content/manual/en',
    owner: 'taowang1993',
    repo: 'tockdocs',
    ref: 'main',
  })

  assert.equal(
    mapper('/repo/guide.md'),
    'https://example.com/docs/manual/en/guide',
  )

  assert.equal(
    mapper('https://github.com/taowang1993/tockdocs/blob/main/docs/content/manual/en/guide.mdc'),
    'https://example.com/docs/manual/en/guide',
  )

  assert.equal(
    mapper('https://raw.githubusercontent.com/taowang1993/tockdocs/main/docs/content/manual/en/index.md'),
    'https://example.com/docs/manual/en/index',
  )

  // Non-matching paths return undefined
  assert.equal(mapper('/repo/not-a-file'), undefined)
  assert.equal(mapper('https://other.com/page.md'), undefined)
})

test('createRepoPathToUrlMapper strips numeric ordering prefixes from docs routes', () => {
  const mapper = createRepoPathToUrlMapper({
    siteUrl: 'https://example.com',
    routePrefix: '/docs/chemistry/zh',
    gitFsRoot: 'docs/content/chemistry/zh',
    owner: 'taowang1993',
    repo: 'tockdocs',
    ref: 'main',
  })

  assert.equal(
    mapper('/repo/01.atomic-structure/1.electron-configuration.md'),
    'https://example.com/docs/chemistry/zh/atomic-structure/electron-configuration',
  )

  assert.equal(
    mapper('https://github.com/taowang1993/tockdocs/blob/main/docs/content/chemistry/zh/06.elements-compounds/10.metallic-materials.md'),
    'https://example.com/docs/chemistry/zh/elements-compounds/metallic-materials',
  )
})

test('replaceRepoPathsInText replaces filesystem paths and GitHub URLs in text', () => {
  const mapper = createRepoPathToUrlMapper({
    siteUrl: 'https://example.com',
    routePrefix: '/docs/manual/en',
    gitFsRoot: 'docs/content/manual/en',
    owner: 'taowang1993',
    repo: 'tockdocs',
    ref: 'main',
  })

  // Backtick-wrapped path
  const result1 = replaceRepoPathsInText('See `/repo/guide.md` for details.', mapper)
  assert.match(result1, /`https:\/\/example\.com\/docs\/manual\/en\/guide`/)
  assert.ok(!result1.includes('/repo/guide.md'))

  // Markdown link with /repo/ path
  const result2 = replaceRepoPathsInText('[guide](/repo/guide.md)', mapper)
  assert.match(result2, /\(https:\/\/example\.com\/docs\/manual\/en\/guide\)/)

  // Plain /repo/ path → markdown link
  const result3 = replaceRepoPathsInText('Check /repo/guide.md first.', mapper)
  assert.match(result3, /\[guide\]\(https:\/\/example\.com\/docs\/manual\/en\/guide\)/)

  // GitHub blob URL
  const result4 = replaceRepoPathsInText('Source: https://github.com/taowang1993/tockdocs/blob/main/docs/content/manual/en/guide.md', mapper)
  assert.ok(!result4.includes('github.com'))
})

test('index system prompt references the injected index and get-page only', () => {
  const prompt = getIndexSystemPrompt('TockDocs', 'manual/en', {
    title: 'Manual',
    description: 'Core TockDocs guides',
  }, '# Knowledge Base: Manual (en)\n\n- [Assistant](https://example.com/docs/manual/en/ai/assistant.md)')

  assert.match(prompt, /Documentation index/)
  assert.match(prompt, /ONE tool: get-page/)
  assert.match(prompt, /exact URL from the index/)
  assert.doesNotMatch(prompt, /search-pages/)
  assert.doesNotMatch(prompt, /list-pages/)
})

test('mcp system prompt still references MCP tools', () => {
  const prompt = getMcpSystemPrompt('TockDocs', 'manual/en', {
    title: 'Manual',
    description: 'Core TockDocs guides',
  })

  assert.match(prompt, /search-pages/)
  assert.match(prompt, /list-pages/)
  assert.match(prompt, /get-page/)
})
