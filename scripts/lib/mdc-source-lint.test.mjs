import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  docsContentDir,
  lintMarkdownSource,
  loadMdcSourceDependencies,
  repoRoot,
  resolveMarkdownTargets,
} from './mdc-source-lint.mjs'

const dependencies = await loadMdcSourceDependencies(repoRoot)

function withTempMarkdown(source, callback) {
  const directory = mkdtempSync(join(tmpdir(), 'tockdocs-mdc-lint-'))
  const filePath = join(directory, 'page.md')
  writeFileSync(filePath, source)

  return Promise.resolve()
    .then(() => callback(filePath))
    .finally(() => {
      rmSync(directory, { recursive: true, force: true })
    })
}

test('passes valid MDC content', async () => {
  await withTempMarkdown(`---
title: Hello
---

::note
Works.
::
`, async (filePath) => {
    const issues = await lintMarkdownSource({
      filePath,
      ...dependencies,
    })

    assert.deepStrictEqual(issues, [])
  })
})

test('flags empty headings', async () => {
  await withTempMarkdown('###\n', async (filePath) => {
    const issues = await lintMarkdownSource({
      filePath,
      ...dependencies,
    })

    assert.equal(issues.some(issue => issue.ruleId === 'empty-heading'), true)
  })
})

test('flags Markdown in page descriptions', async () => {
  await withTempMarkdown(`---
title: Bad Description
description: "- [Parse](https://example.com) returns **structured** tables | forms."
---
`, async (filePath) => {
    const issues = await lintMarkdownSource({
      filePath,
      ...dependencies,
    })

    assert.equal(issues.some(issue => issue.ruleId === 'page-description-markdown'), true)
  })
})

test('flags multiline page descriptions', async () => {
  await withTempMarkdown(`---
title: Multiline Description
description: >
  This should be a short plain-text sentence.
---
`, async (filePath) => {
    const issues = await lintMarkdownSource({
      filePath,
      ...dependencies,
    })

    assert.equal(issues.some(issue => issue.ruleId === 'page-description-multiline'), true)
  })
})

test('flags component fences converted into headings', async () => {
  await withTempMarkdown('## :::note\n', async (filePath) => {
    const issues = await lintMarkdownSource({
      filePath,
      ...dependencies,
    })

    assert.equal(issues.some(issue => issue.ruleId === 'headingized-component-fence'), true)
  })
})

test('flags component property lines converted into headings', async () => {
  await withTempMarkdown('## class: "foo"\n', async (filePath) => {
    const issues = await lintMarkdownSource({
      filePath,
      ...dependencies,
    })

    assert.equal(issues.some(issue => issue.ruleId === 'headingized-component-prop'), true)
  })
})

test('flags unclosed component fences', async () => {
  await withTempMarkdown('::note\nHello\n', async (filePath) => {
    const issues = await lintMarkdownSource({
      filePath,
      ...dependencies,
    })

    assert.equal(issues.some(issue => issue.ruleId === 'component-fence-unclosed'), true)
  })
})

test('flags blank lines before component frontmatter', async () => {
  await withTempMarkdown('::::accordion-item\n\n---\nlabel: Hi\n---\nBody\n::::\n', async (filePath) => {
    const issues = await lintMarkdownSource({
      filePath,
      ...dependencies,
    })

    assert.equal(issues.some(issue => issue.ruleId === 'component-frontmatter-blank-line'), true)
  })
})

test('flags invalid component frontmatter YAML', async () => {
  await withTempMarkdown('::note\n---\nlabel: [\n---\nBody\n::\n', async (filePath) => {
    const issues = await lintMarkdownSource({
      filePath,
      ...dependencies,
    })

    assert.equal(issues.some(issue => issue.ruleId === 'component-frontmatter-yaml-invalid'), true)
  })
})

test('flags escaped _blank inside component frontmatter', async () => {
  await withTempMarkdown('::note\n---\ntarget: \\_blank\n---\nBody\n::\n', async (filePath) => {
    const issues = await lintMarkdownSource({
      filePath,
      ...dependencies,
    })

    assert.equal(issues.some(issue => issue.ruleId === 'escaped-blank-target'), true)
  })
})

test('flags slot markers outside components', async () => {
  await withTempMarkdown('#title\nHello\n', async (filePath) => {
    const issues = await lintMarkdownSource({
      filePath,
      ...dependencies,
    })

    assert.equal(issues.some(issue => issue.ruleId === 'slot-marker-outside-component'), true)
  })
})

test('flags malformed component fence syntax', async () => {
  await withTempMarkdown('::note{to="/docs"\nHello\n::\n', async (filePath) => {
    const issues = await lintMarkdownSource({
      filePath,
      ...dependencies,
    })

    assert.equal(issues.some(issue => issue.ruleId === 'component-fence-invalid'), true)
  })
})

test('flags orphan component-like property lines', async () => {
  await withTempMarkdown('class: "foo"\n', async (filePath) => {
    const issues = await lintMarkdownSource({
      filePath,
      ...dependencies,
    })

    assert.equal(issues.some(issue => issue.ruleId === 'orphan-component-prop-line'), true)
  })
})

test('resolveMarkdownTargets includes files from every workspace content root', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tockdocs-mdc-targets-'))
  const contentDirs = [
    join(directory, 'docs/content'),
    join(directory, 'playground/content'),
    join(directory, '.starters/default/content'),
  ]
  const relativeFilePaths = [
    'docs/content/new-page.mdc',
    'playground/content/example.md',
    '.starters/default/content/starter.md',
  ]
  const filePaths = relativeFilePaths.map(relativeFilePath => join(directory, relativeFilePath))

  try {
    for (const [index, contentDir] of contentDirs.entries()) {
      mkdirSync(contentDir, { recursive: true })
      writeFileSync(filePaths[index], '::note\nHello\n::\n')
    }

    const resolved = resolveMarkdownTargets(relativeFilePaths, {
      rootDir: directory,
      contentDirs,
    })

    assert.deepStrictEqual(resolved, [...filePaths].sort())
    assert.notEqual(filePaths[0].startsWith(docsContentDir), true)
  }
  finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
