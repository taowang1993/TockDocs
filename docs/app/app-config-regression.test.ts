import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'

const currentDir = dirname(fileURLToPath(import.meta.url))
const appConfigPath = resolve(currentDir, 'app.config.ts')

// These links are upstream Nuxt starter defaults. If they appear in the docs
// app config, every KB page renders them in the right-aside community block.
const forbiddenTemplateTocBottomMarkers = [
  'docs.links-ui',
  'docs.links-content',
  'docs.links-studio',
  'https://ui.nuxt.com/getting-started/installation/nuxt',
  'https://content.nuxt.com/docs/getting-started/installation/',
  'https://nuxt.studio/introduction',
]

test('docs app does not render upstream Nuxt template links in the right aside', () => {
  const source = readFileSync(appConfigPath, 'utf8')
  const found = forbiddenTemplateTocBottomMarkers.filter(marker => source.includes(marker))

  assert.deepEqual(
    found,
    [],
    `Remove upstream Nuxt template TOC-bottom link markers from docs/app/app.config.ts: ${found.join(', ')}`,
  )
})
