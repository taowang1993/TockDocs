import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildAgentDocsDirective, buildAgentDocsDirectiveMarkdown } from './agent-docs'
import {
  buildMarkdownAliasPath,
  buildContentSourceAssetKey,
  buildContentSourceFilePath,
  buildRawContentPath,
  buildSourceContentPath,
  getRenderedPathFromMarkdownAliasPath,
  getRenderedPathFromSourceContentPath,
  getRenderedPathFromRawContentPath,
  getSourceContentPathFromRawContentPath,
  hasContentSourceExtension,
  isRawMarkdownRequestPath,
  isSourceMarkdownRequestPath,
  stripContentSourceExtension,
} from './content-source'
import { buildDocsPageUrl, getLandingCollectionName, switchKnowledgeBaseInPath } from './docs'
import { resolveKnowledgeBases } from './knowledge-bases'
import { getMarkdownRewriteLocaleCodes } from '../modules/markdown-rewrite'
import { findExistingPublicAsset } from './public-assets.server'
import { sanitizeAssistantText } from '../modules/assistant/runtime/utils/sanitize'

test('buildRawContentPath preserves non-md extensions', () => {
  assert.equal(buildRawContentPath('/docs/platform/en/getting-started', 'mdc'), '/raw/docs/platform/en/getting-started.mdc')
})

test('buildSourceContentPath preserves non-md extensions', () => {
  assert.equal(buildSourceContentPath('/docs/platform/en/getting-started', 'mdc'), '/source/docs/platform/en/getting-started.mdc')
})

test('buildMarkdownAliasPath keeps docs paths stable and maps the root path to /index.md', () => {
  assert.equal(buildMarkdownAliasPath('/docs/platform/en/getting-started'), '/docs/platform/en/getting-started.md')
  assert.equal(buildMarkdownAliasPath('/'), '/index.md')
})

test('buildAgentDocsDirective points agents to llms.txt and the markdown alias', () => {
  assert.equal(
    buildAgentDocsDirective('/docs/platform/en/getting-started.md'),
    'AI coding agents: see [/llms.txt](/llms.txt) for the full documentation index. Markdown version: [/docs/platform/en/getting-started.md](/docs/platform/en/getting-started.md).',
  )
  assert.equal(
    buildAgentDocsDirectiveMarkdown('/docs/platform/en/getting-started.md'),
    '> AI coding agents: see [/llms.txt](/llms.txt) for the full documentation index. Markdown version: [/docs/platform/en/getting-started.md](/docs/platform/en/getting-started.md).',
  )
})

test('buildDocsPageUrl keeps links on canonical page routes', () => {
  assert.equal(
    buildDocsPageUrl('https://example.com', '/docs/chemistry/zh/elements-compounds/sulfur-compounds'),
    'https://example.com/docs/chemistry/zh/elements-compounds/sulfur-compounds',
  )
})

test('buildContentSourceFilePath keeps legacy docs stems intact', () => {
  assert.equal(buildContentSourceFilePath('docs/getting-started', 'md'), 'content/docs/getting-started.md')
})

test('buildContentSourceFilePath maps knowledge-base stems back to the source directory', () => {
  assert.equal(
    buildContentSourceFilePath('docs/chemistry/zh/01.atomic-structure/1.electron-configuration', 'md', {
      knowledgeBaseSourceDirs: {
        chemistry: 'chemistry',
      },
    }),
    'content/chemistry/zh/01.atomic-structure/1.electron-configuration.md',
  )
})

test('buildContentSourceFilePath prefixes site collection paths with content/site', () => {
  assert.equal(
    buildContentSourceFilePath('index', 'md', { collectionName: 'site' }),
    'content/site/index.md',
  )
  assert.equal(
    buildContentSourceFilePath('about', 'mdc', { collectionName: 'site' }),
    'content/site/about.mdc',
  )
})

test('buildContentSourceAssetKey trims the content prefix', () => {
  assert.equal(buildContentSourceAssetKey('manual/en/4.ai/4.llms', 'md'), 'manual/en/4.ai/4.llms.md')
})

test('buildContentSourceAssetKey maps knowledge-base stems back to the source asset key', () => {
  assert.equal(
    buildContentSourceAssetKey('docs/chemistry/zh/01.atomic-structure/1.electron-configuration', 'md', {
      knowledgeBaseSourceDirs: {
        chemistry: 'chemistry',
      },
    }),
    'chemistry/zh/01.atomic-structure/1.electron-configuration.md',
  )
})

test('getRenderedPathFromRawContentPath strips markdown and MDC extensions', () => {
  assert.equal(getRenderedPathFromRawContentPath('/raw/docs/platform/en/ai/llms.md'), '/docs/platform/en/ai/llms')
  assert.equal(getRenderedPathFromRawContentPath('/raw/docs/platform/en/essentials/components.mdc'), '/docs/platform/en/essentials/components')
  assert.equal(getRenderedPathFromRawContentPath('/raw/index.md'), '/')
})

test('getRenderedPathFromSourceContentPath strips markdown and MDC extensions', () => {
  assert.equal(getRenderedPathFromSourceContentPath('/source/docs/platform/en/ai/llms.md'), '/docs/platform/en/ai/llms')
  assert.equal(getRenderedPathFromSourceContentPath('/source/docs/platform/en/essentials/components.mdc'), '/docs/platform/en/essentials/components')
  assert.equal(getRenderedPathFromSourceContentPath('/source/index.md'), '/')
})

test('getRenderedPathFromMarkdownAliasPath strips markdown and MDC extensions', () => {
  assert.equal(getRenderedPathFromMarkdownAliasPath('/docs/platform/en/ai/llms.md'), '/docs/platform/en/ai/llms')
  assert.equal(getRenderedPathFromMarkdownAliasPath('/docs/platform/en/essentials/components.mdc'), '/docs/platform/en/essentials/components')
  assert.equal(getRenderedPathFromMarkdownAliasPath('/index.md'), '/')
})

test('getSourceContentPathFromRawContentPath swaps only the route prefix', () => {
  assert.equal(getSourceContentPathFromRawContentPath('/raw/docs/platform/en/ai/llms.md'), '/source/docs/platform/en/ai/llms.md')
  assert.equal(getSourceContentPathFromRawContentPath('/raw/docs/platform/en/essentials/components.mdc'), '/source/docs/platform/en/essentials/components.mdc')
})

test('content source helpers detect and strip markdown aliases', () => {
  assert.equal(hasContentSourceExtension('/docs/platform/en/ai/llms.md'), true)
  assert.equal(hasContentSourceExtension('/docs/platform/en/essentials/components.mdc'), true)
  assert.equal(hasContentSourceExtension('/docs/platform/en/ai/llms'), false)
  assert.equal(stripContentSourceExtension('/docs/platform/en/ai/llms.md'), '/docs/platform/en/ai/llms')
  assert.equal(stripContentSourceExtension('/docs/platform/en/essentials/components.mdc'), '/docs/platform/en/essentials/components')
  assert.equal(isRawMarkdownRequestPath('/raw/docs/platform/en/ai/llms.md'), true)
  assert.equal(isRawMarkdownRequestPath('/raw/docs/platform/en/essentials/components.mdc'), true)
  assert.equal(isRawMarkdownRequestPath('/docs/platform/en/ai/llms.md'), false)
  assert.equal(isSourceMarkdownRequestPath('/source/docs/platform/en/ai/llms.md'), true)
  assert.equal(isSourceMarkdownRequestPath('/source/docs/platform/en/essentials/components.mdc'), true)
  assert.equal(isSourceMarkdownRequestPath('/docs/platform/en/ai/llms.md'), false)
})

test('markdown rewrite locale routes prefer filtered locales over raw i18n config', () => {
  assert.deepEqual(
    getMarkdownRewriteLocaleCodes({
      i18n: { locales: ['en', 'fr'] },
      filteredLocales: ['en'],
    }),
    ['en'],
  )
})

test('getLandingCollectionName normalizes hyphenated locale codes', () => {
  assert.equal(getLandingCollectionName('pt-BR'), 'landing_pt_BR')
})

test('switchKnowledgeBaseInPath preserves the current locale when the target knowledge base supports it', () => {
  const config = {
    tockdocs: {
      knowledgeBases: [
        {
          id: 'platform',
          title: 'Platform',
          description: '',
          icon: 'i-lucide-book-open',
          defaultLocale: 'en',
          locales: ['en', 'fr'],
          entry: 'getting-started/installation',
        },
        {
          id: 'chemistry',
          title: 'Chemistry',
          description: '',
          icon: 'i-lucide-flask-conical',
          defaultLocale: 'zh',
          locales: ['zh'],
          entry: 'atomic-structure/electron-configuration',
        },
      ],
    },
  }

  assert.equal(
    switchKnowledgeBaseInPath('/docs/platform/fr/getting-started/installation', 'platform', config),
    '/docs/platform/fr/getting-started/installation',
  )

  assert.equal(
    switchKnowledgeBaseInPath('/docs/platform/fr/getting-started/installation', 'chemistry', config),
    '/docs/chemistry/zh/atomic-structure/electron-configuration',
  )
})

test('findExistingPublicAsset resolves workspace consumer public assets', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tockdocs-public-'))

  try {
    mkdirSync(join(rootDir, 'docs', 'public'), { recursive: true })
    writeFileSync(join(rootDir, 'docs', 'public', 'favicon-dark.svg'), '<svg />')

    assert.equal(
      await findExistingPublicAsset('/favicon-dark.svg', rootDir),
      join(rootDir, 'docs', 'public', 'favicon-dark.svg'),
    )
  }
  finally {
    rmSync(rootDir, { recursive: true, force: true })
  }
})

test('sanitizeAssistantText escapes bare HTML tags followed by word characters', () => {
  assert.equal(sanitizeAssistantText('content/<kb>/<locale>/'), 'content/&lt;kb>/&lt;locale>/')
  assert.equal(sanitizeAssistantText('Use <div> for styling'), 'Use &lt;div> for styling')
  assert.equal(sanitizeAssistantText('No angle brackets here'), 'No angle brackets here')
  assert.equal(sanitizeAssistantText(''), '')
  // Does not break autolinks or XML instructions
  assert.equal(sanitizeAssistantText('<https://example.com>'), '<https://example.com>')
  assert.equal(sanitizeAssistantText('</p>'), '</p>')
})

test('resolveKnowledgeBases logs a warning on invalid kb.yml YAML', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tockdocs-kb-'))
  const warnings: string[] = []
  const originalWarn = console.warn
  console.warn = (msg: string) => warnings.push(msg)

  try {
    mkdirSync(join(rootDir, 'content', 'broken', 'en'), { recursive: true })
    writeFileSync(
      join(rootDir, 'content', 'broken', 'kb.yml'),
      'id: broken\nlocales:\n  - en\ninvalid yaml here: [',
    )

    resolveKnowledgeBases(rootDir)

    const parseWarning = warnings.find(w => w.includes('Failed to parse kb.yml'))
    assert.ok(parseWarning, 'Expected a YAML parse warning')
    assert.ok(parseWarning!.includes('kb.yml') && parseWarning!.includes('broken'))
  }
  finally {
    console.warn = originalWarn
    rmSync(rootDir, { recursive: true, force: true })
  }
})

test('resolveKnowledgeBases excludes directories starting with dot from locale discovery', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tockdocs-kb-'))

  try {
    mkdirSync(join(rootDir, 'content', 'hidden-test', 'en'), { recursive: true })
    mkdirSync(join(rootDir, 'content', 'hidden-test', '.hidden-dir'), { recursive: true })
    writeFileSync(
      join(rootDir, 'content', 'hidden-test', 'kb.yml'),
      'id: hidden-test\n',
    )

    const knowledgeBases = resolveKnowledgeBases(rootDir)

    assert.equal(knowledgeBases.length, 1)
    assert.deepEqual(knowledgeBases[0]!.locales, ['en'])
  }
  finally {
    rmSync(rootDir, { recursive: true, force: true })
  }
})

test('resolveKnowledgeBases ignores configured locales without content folders', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tockdocs-kb-'))

  try {
    mkdirSync(join(rootDir, 'content', 'platform', 'en'), { recursive: true })
    writeFileSync(
      join(rootDir, 'content', 'platform', 'kb.yml'),
      `id: platform
locales:
  - en
  - fr
`,
    )

    const knowledgeBases = resolveKnowledgeBases(rootDir)

    assert.deepEqual(knowledgeBases, [
      {
        id: 'platform',
        sourceDir: 'platform',
        title: 'Platform',
        description: '',
        icon: 'i-lucide-book-open',
        locales: ['en'],
        defaultLocale: 'en',
        entry: undefined,
        theme: undefined,
        searchPlaceholder: undefined,
        assistantName: undefined,
        titles: undefined,
        descriptions: undefined,
      },
    ])
  }
  finally {
    rmSync(rootDir, { recursive: true, force: true })
  }
})
