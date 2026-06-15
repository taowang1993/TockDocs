import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
export const docsContentDir = resolve(repoRoot, 'docs/content')
export const playgroundContentDir = resolve(repoRoot, 'playground/content')

export function getStarterContentDirs(rootDir = repoRoot) {
  const startersDir = resolve(rootDir, '.starters')
  if (!existsSync(startersDir)) return []
  return readdirSync(startersDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => resolve(startersDir, entry.name, 'content'))
    .filter(existsSync)
}

export function getWorkspaceMarkdownContentDirs(rootDir = repoRoot) {
  return [
    resolve(rootDir, 'docs/content'),
    resolve(rootDir, 'playground/content'),
    ...getStarterContentDirs(rootDir),
  ].filter(existsSync)
}

export const defaultMarkdownParserOptions = {
  remark: {
    plugins: {
      'remark-mdc': {
        options: {
          autoUnwrap: true,
        },
      },
    },
  },
  highlight: false,
}

const SLOT_MARKERS = ['title', 'description', 'header', 'footer', 'default', 'code', 'links', 'features']
const SLOT_MARKER_RE = new RegExp(`^#(?:${SLOT_MARKERS.join('|')})$`)
const EMPTY_HEADING_RE = /^#{1,6}\s*$/
const HEADINGIZED_COMPONENT_RE = /^#{1,6}\s+:{2,}[a-z0-9][\w-]*/i
const HEADINGIZED_SLOT_RE = new RegExp(`^#{1,6}\\s+#(?:${SLOT_MARKERS.join('|')})$`)
const HEADINGIZED_PROP_LINE_RE = /^#{1,6}\s+(?:class|label|icon|to|target|color|variant|title|description|src|alt|width|height|loading|ui|name|type|level|default-value|defaultValue):\s*/i
const ESCAPED_COMPONENT_RE = /^\\:{2,}/
const COMPONENT_FENCE_CANDIDATE_RE = /^:{2,}[a-z0-9][\w-]*/i
const COMPONENT_OPEN_PREFIX_RE = /^(:{2,})([a-z0-9][\w-]*)(?:\{[^}\n]*\})?/i
const COMPONENT_OPEN_RE = /^(:{2,})([a-z0-9][\w-]*)(?:\{[^}\n]*\})?$/i
const COMPONENT_CLOSE_RE = /^(:{2,})$/
const PROP_LIKE_RE = /^[a-z][\w-]*:\s*/i
const SUSPICIOUS_COMPONENT_PROP_KEYS = new Set(['class', 'label', 'icon', 'to', 'target', 'color', 'variant', 'src', 'alt', 'width', 'height', 'loading', 'ui', 'name', 'type', 'level', 'default-value', 'defaultvalue'])
const DESCRIPTION_MARKDOWN_PATTERNS = [
  { pattern: /!\[[^\]\n]*\]\([^)]+\)/, label: 'images' },
  { pattern: /\[[^\]\n]+\]\([^)]+\)/, label: 'links' },
  { pattern: /\*\*[^*]+\*\*/, label: 'bold markup' },
  { pattern: /`[^`]+`/, label: 'inline code' },
  { pattern: /\|/, label: 'table pipes' },
  { pattern: /^\s*[-*]\s+/, label: 'list markers' },
  { pattern: /<\/?[a-z][^>]*>/i, label: 'HTML' },
]

export function walkMarkdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(directory, entry.name)

    if (entry.isDirectory()) {
      return walkMarkdownFiles(filePath)
    }

    return /\.mdc?$/i.test(entry.name) ? [filePath] : []
  })
}

function isWithinDirectory(filePath, directory) {
  const relativePath = relative(directory, filePath)
  return relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath)
}

function isWithinAnyContentDirectory(filePath, contentDirs) {
  return contentDirs.some(directory => filePath === directory || isWithinDirectory(filePath, directory))
}

function getSuspiciousComponentPropKey(text) {
  const key = text.match(/^([a-z][\w-]*):\s*/i)?.[1]?.toLowerCase()
  return key && SUSPICIOUS_COMPONENT_PROP_KEYS.has(key) ? key : null
}

function resolveInputPath(input, rootDir) {
  if (isAbsolute(input)) {
    return input
  }

  const fromCwd = resolve(process.cwd(), input)
  if (existsSync(fromCwd)) {
    return fromCwd
  }

  return resolve(rootDir, input)
}

export function resolveMarkdownTargets(inputs = [], { rootDir = repoRoot, contentDir, contentDirs } = {}) {
  const effectiveContentDirs = (contentDirs && contentDirs.length > 0)
    ? contentDirs
    : contentDir
      ? [contentDir]
      : getWorkspaceMarkdownContentDirs(rootDir)

  if (!inputs.length) {
    return [...new Set(effectiveContentDirs.flatMap(directory => walkMarkdownFiles(directory)))].sort()
  }

  const resolvedFiles = new Set()

  for (const input of inputs) {
    const targetPath = resolveInputPath(input, rootDir)

    if (!existsSync(targetPath)) {
      continue
    }

    const stats = statSync(targetPath)
    if (stats.isDirectory()) {
      if (isWithinAnyContentDirectory(targetPath, effectiveContentDirs)) {
        for (const filePath of walkMarkdownFiles(targetPath)) {
          resolvedFiles.add(filePath)
        }
      }
      continue
    }

    if (/\.mdc?$/i.test(targetPath) && isWithinAnyContentDirectory(targetPath, effectiveContentDirs)) {
      resolvedFiles.add(targetPath)
    }
  }

  return [...resolvedFiles].sort()
}

function createIssue(filePath, ruleId, message, line = 1, column = 1) {
  return {
    filePath,
    ruleId,
    message,
    line,
    column,
  }
}

function createCodeFenceState(line) {
  const match = line.match(/^\s*(`{3,}|~{3,})/)
  return match ? match[1][0].repeat(match[1].length) : null
}

function hasTrailingInlineAdmonition(text) {
  if (!(text.startsWith('- ') || text.startsWith('* '))) {
    return false
  }

  return [' :tip[', ' :note[', ' :warning[', ' :caution['].some(token => text.includes(token))
}

function validateYamlBlock({ filePath, rawBlock, startLine, blockLabel, parseYamlDocument }) {
  const document = parseYamlDocument(rawBlock, { prettyErrors: true })

  return document.errors.map((error) => {
    const line = startLine + ((error.linePos?.[0]?.line || 1) - 1)
    const column = error.linePos?.[0]?.col || 1
    return createIssue(
      filePath,
      `${blockLabel}-yaml-invalid`,
      `${blockLabel} YAML is invalid: ${error.message.split('\n')[0]}`,
      line,
      column,
    )
  })
}

function findFrontmatterFieldLine(rawBlock, fieldName, startLine) {
  const lines = rawBlock.split('\n')
  const fieldPattern = new RegExp(`^${fieldName}:`)
  const lineIndex = lines.findIndex(line => fieldPattern.test(line.trimStart()))

  if (lineIndex === -1) {
    return null
  }

  return {
    line: startLine + lineIndex,
    text: lines[lineIndex],
  }
}

function lintPageFrontmatterFields(filePath, rawBlock, startLine, parseYamlDocument) {
  const issues = []
  const document = parseYamlDocument(rawBlock, { prettyErrors: true })

  if (document.errors.length > 0) {
    return issues
  }

  const frontmatter = document.toJS() || {}
  const description = frontmatter.description

  if (description === undefined || description === null) {
    return issues
  }

  const descriptionField = findFrontmatterFieldLine(rawBlock, 'description', startLine) || {
    line: startLine,
    text: '',
  }

  if (typeof description !== 'string') {
    issues.push(createIssue(filePath, 'page-description-not-string', 'page frontmatter description must be a plain text string.', descriptionField.line, 1))
    return issues
  }

  if (/^\s*description:\s*[>|]/.test(descriptionField.text) || description.includes('\n')) {
    issues.push(createIssue(filePath, 'page-description-multiline', 'page frontmatter description must be one plain-text sentence, not multiline Markdown.', descriptionField.line, 1))
  }

  const matchedPatterns = DESCRIPTION_MARKDOWN_PATTERNS
    .filter(({ pattern }) => pattern.test(description))
    .map(({ label }) => label)

  if (matchedPatterns.length > 0) {
    issues.push(createIssue(
      filePath,
      'page-description-markdown',
      `page frontmatter description must be plain text; remove Markdown ${matchedPatterns.join(', ')}.`,
      descriptionField.line,
      1,
    ))
  }

  return issues
}

function lintSourceStructure(filePath, rawSource, parseYamlDocument) {
  const issues = []
  const lines = rawSource.split('\n')

  let bodyStartIndex = 0

  if (lines[0]?.trim() === '---') {
    const pageFrontmatterEnd = lines.findIndex((line, index) => index > 0 && line.trim() === '---')

    if (pageFrontmatterEnd === -1) {
      issues.push(createIssue(filePath, 'page-frontmatter-unclosed', 'page frontmatter is missing its closing --- fence.', 1, 1))
      bodyStartIndex = lines.length
    }
    else {
      const pageFrontmatter = lines.slice(1, pageFrontmatterEnd).join('\n')
      issues.push(...validateYamlBlock({
        filePath,
        rawBlock: pageFrontmatter,
        startLine: 2,
        blockLabel: 'page-frontmatter',
        parseYamlDocument,
      }))
      issues.push(...lintPageFrontmatterFields(filePath, pageFrontmatter, 2, parseYamlDocument))
      bodyStartIndex = pageFrontmatterEnd + 1
    }
  }

  let codeFence = null
  let pendingComponentFence = null
  let componentFrontmatter = null
  const componentStack = []

  for (let index = bodyStartIndex; index < lines.length; index++) {
    const line = lines[index]
    const trimmed = line.trim()
    const lineNumber = index + 1

    if (codeFence) {
      if (trimmed.startsWith(codeFence)) {
        codeFence = null
      }
      continue
    }

    const nextCodeFence = createCodeFenceState(line)
    if (nextCodeFence) {
      codeFence = nextCodeFence
      continue
    }

    if (componentFrontmatter) {
      if (trimmed === 'target: \\_blank') {
        issues.push(createIssue(filePath, 'escaped-blank-target', 'escaped _blank leaked into component props.', lineNumber, 1))
      }

      if (/https?:\/\/[^)\s]+\/(?:_og|_ipx)\//i.test(trimmed)) {
        issues.push(createIssue(filePath, 'absolute-generated-asset-url', 'same-site generated asset URLs should use relative paths.', lineNumber, 1))
      }

      if (trimmed === '---') {
        issues.push(...validateYamlBlock({
          filePath,
          rawBlock: componentFrontmatter.lines.join('\n'),
          startLine: componentFrontmatter.startLine,
          blockLabel: 'component-frontmatter',
          parseYamlDocument,
        }))
        componentFrontmatter = null
        continue
      }

      componentFrontmatter.lines.push(line)
      continue
    }

    if (HEADINGIZED_COMPONENT_RE.test(trimmed)) {
      issues.push(createIssue(filePath, 'headingized-component-fence', 'component fence was converted into a heading.', lineNumber, 1))
    }

    if (HEADINGIZED_SLOT_RE.test(trimmed)) {
      issues.push(createIssue(filePath, 'headingized-slot-marker', 'slot marker was converted into a heading.', lineNumber, 1))
    }

    if (HEADINGIZED_PROP_LINE_RE.test(trimmed)) {
      issues.push(createIssue(filePath, 'headingized-component-prop', 'component property line was converted into a heading.', lineNumber, 1))
    }

    if (ESCAPED_COMPONENT_RE.test(trimmed)) {
      issues.push(createIssue(filePath, 'escaped-component-fence', 'escaped component fence leaked into prose.', lineNumber, 1))
    }

    if (hasTrailingInlineAdmonition(trimmed)) {
      issues.push(createIssue(filePath, 'inline-admonition-in-list', 'admonition shorthand should be on its own line, not appended to list content.', lineNumber, 1))
    }

    if (trimmed === 'target: \\_blank') {
      issues.push(createIssue(filePath, 'escaped-blank-target', 'escaped _blank leaked into component props.', lineNumber, 1))
    }

    if (/https?:\/\/[^)\s]+\/(?:_og|_ipx)\//i.test(trimmed)) {
      issues.push(createIssue(filePath, 'absolute-generated-asset-url', 'same-site generated asset URLs should use relative paths.', lineNumber, 1))
    }

    const componentFencePrefixMatch = trimmed.match(COMPONENT_OPEN_PREFIX_RE)
    if (componentFencePrefixMatch) {
      const trailingContent = trimmed.slice(componentFencePrefixMatch[0].length).trim()
      if (trailingContent) {
        issues.push(createIssue(filePath, 'component-fence-trailing-content', 'component fence has trailing content on the same line.', lineNumber, componentFencePrefixMatch[0].length + 1))
      }
    }

    if (pendingComponentFence && !trimmed) {
      pendingComponentFence.hasBlankLine = true
      continue
    }

    const isPropLikeLine = PROP_LIKE_RE.test(trimmed)

    if (pendingComponentFence && trimmed === '---') {
      if (pendingComponentFence.hasBlankLine) {
        issues.push(createIssue(filePath, 'component-frontmatter-blank-line', 'blank line between component fence and component frontmatter.', pendingComponentFence.lineNumber, 1))
      }

      componentFrontmatter = {
        startLine: lineNumber + 1,
        lines: [],
        opener: pendingComponentFence,
      }
      pendingComponentFence = null
      continue
    }

    if (pendingComponentFence && isPropLikeLine && !pendingComponentFence.hasInlineProps) {
      issues.push(createIssue(filePath, 'component-frontmatter-missing', 'component frontmatter is missing before a property-like line.', pendingComponentFence.lineNumber, 1))
      pendingComponentFence = null
      continue
    }

    if (pendingComponentFence && trimmed) {
      pendingComponentFence = null
    }

    if (!trimmed) {
      continue
    }

    if (EMPTY_HEADING_RE.test(trimmed)) {
      issues.push(createIssue(filePath, 'empty-heading', 'heading marker must include visible text.', lineNumber, 1))
      continue
    }

    if (SLOT_MARKER_RE.test(trimmed) && componentStack.length === 0) {
      issues.push(createIssue(filePath, 'slot-marker-outside-component', 'slot marker must be nested inside a component fence.', lineNumber, 1))
    }

    if (getSuspiciousComponentPropKey(trimmed) && componentStack.length === 0) {
      issues.push(createIssue(filePath, 'orphan-component-prop-line', 'component-like property line leaked outside component frontmatter.', lineNumber, 1))
    }

    if (COMPONENT_FENCE_CANDIDATE_RE.test(trimmed) && !COMPONENT_OPEN_RE.test(trimmed)) {
      issues.push(createIssue(filePath, 'component-fence-invalid', 'component fence has invalid syntax. Check inline props and closing braces.', lineNumber, 1))
      continue
    }

    const closingFenceMatch = trimmed.match(COMPONENT_CLOSE_RE)
    if (closingFenceMatch) {
      const depth = closingFenceMatch[1].length

      if (!componentStack.length) {
        issues.push(createIssue(filePath, 'unexpected-closing-fence', `unexpected closing component fence ${trimmed} without a matching opener.`, lineNumber, 1))
        continue
      }

      const top = componentStack[componentStack.length - 1]
      if (top.depth === depth) {
        componentStack.pop()
        continue
      }

      const matchingIndex = componentStack.findLastIndex(entry => entry.depth === depth)
      if (matchingIndex === -1) {
        issues.push(createIssue(filePath, 'unexpected-closing-fence', `unexpected closing component fence ${trimmed}; the current open component expects ${':'.repeat(top.depth)}.`, lineNumber, 1))
        continue
      }

      const skippedEntries = componentStack.splice(matchingIndex + 1)
      for (const entry of skippedEntries.reverse()) {
        issues.push(createIssue(
          filePath,
          'component-fence-unclosed',
          `component fence ${':'.repeat(entry.depth)}${entry.name} opened here was not closed before ${trimmed}.`,
          entry.lineNumber,
          1,
        ))
      }
      componentStack.pop()
      continue
    }

    const componentOpenMatch = trimmed.match(COMPONENT_OPEN_RE)
    if (componentOpenMatch) {
      componentStack.push({
        depth: componentOpenMatch[1].length,
        name: componentOpenMatch[2],
        lineNumber,
      })
      pendingComponentFence = {
        lineNumber,
        hasBlankLine: false,
        hasInlineProps: /\{/.test(trimmed),
      }
    }
  }

  if (componentFrontmatter) {
    issues.push(createIssue(
      filePath,
      'component-frontmatter-unclosed',
      `component frontmatter opened after line ${componentFrontmatter.opener.lineNumber} is missing its closing --- fence.`,
      componentFrontmatter.opener.lineNumber,
      1,
    ))
  }

  for (const entry of componentStack.reverse()) {
    issues.push(createIssue(
      filePath,
      'component-fence-unclosed',
      `component fence ${':'.repeat(entry.depth)}${entry.name} opened here was not closed.`,
      entry.lineNumber,
      1,
    ))
  }

  return issues
}

function normalizeParserError(filePath, error) {
  const line = error?.line || error?.position?.start?.line || error?.loc?.start?.line || 1
  const column = error?.column || error?.position?.start?.column || error?.loc?.start?.column || 1
  return createIssue(filePath, 'mdc-parse-error', error?.message || 'Unable to parse MDC source.', line, column)
}

export async function lintMarkdownSource({
  filePath,
  parseMarkdown,
  parseYamlDocument,
  markdownParserOptions = defaultMarkdownParserOptions,
}) {
  const rawSource = readFileSync(filePath, 'utf8').replace(/\r/g, '')
  const issues = lintSourceStructure(filePath, rawSource, parseYamlDocument)

  try {
    await parseMarkdown(rawSource, markdownParserOptions, {
      fileOptions: {
        path: filePath,
      },
    })
  }
  catch (error) {
    issues.push(normalizeParserError(filePath, error))
  }

  return issues.sort((left, right) => left.line - right.line || left.column - right.column || left.ruleId.localeCompare(right.ruleId))
}

export async function loadMdcSourceDependencies(rootDir = repoRoot) {
  const layerPackagePath = resolve(rootDir, 'layer/package.json')
  assert.ok(existsSync(layerPackagePath), `Missing layer package.json: ${layerPackagePath}`)

  const layerRequire = createRequire(layerPackagePath)
  const mdcModuleEntryPath = layerRequire.resolve('@nuxtjs/mdc')
  const runtimeEntryPath = resolve(dirname(mdcModuleEntryPath), 'runtime/index.js')
  const { parseMarkdown } = await import(pathToFileURL(runtimeEntryPath).href)
  const { parseDocument } = layerRequire('yaml')

  return {
    parseMarkdown,
    parseYamlDocument: parseDocument,
  }
}

export async function lintMarkdownFiles(filePaths, { rootDir = repoRoot } = {}) {
  const { parseMarkdown, parseYamlDocument } = await loadMdcSourceDependencies(rootDir)
  const results = []

  for (const filePath of filePaths) {
    const issues = await lintMarkdownSource({
      filePath,
      parseMarkdown,
      parseYamlDocument,
    })

    results.push({
      filePath,
      issues,
    })
  }

  return results
}
