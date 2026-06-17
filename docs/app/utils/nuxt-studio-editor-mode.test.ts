import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  type EditorMode,
  computeStudioEditorAction,
} from './nuxt-studio-editor-mode'

function ctx(currentMode: EditorMode, overrideActive = false, previousMode: EditorMode | null = null) {
  return { currentMode, overrideActive, previousMode }
}

test('computeStudioEditorAction — fresh session, non-chemistry page → no-op', () => {
  assert.equal(computeStudioEditorAction('/docs/manual/en/start', ctx('tiptap')), null)
  assert.equal(computeStudioEditorAction('/', ctx('code')), null)
  assert.equal(computeStudioEditorAction('/docs/investing/zh/start', ctx('tiptap')), null)
})

test('computeStudioEditorAction — entering chemistry from tiptap → remember and force code', () => {
  const action = computeStudioEditorAction(
    '/docs/chemistry/zh/01.atomic-structure/2.aufbau-principle',
    ctx('tiptap'),
  )
  assert.deepEqual(action, {
    setOverride: true,
    setPreviousMode: 'tiptap',
    editorMode: 'code',
  })
})

test('computeStudioEditorAction — entering chemistry from code → preserve code preference', () => {
  const action = computeStudioEditorAction('/docs/chemistry/zh/foo', ctx('code'))
  assert.deepEqual(action, {
    setOverride: true,
    setPreviousMode: 'code',
    editorMode: undefined,
  })
})

test('computeStudioEditorAction — already on chemistry with active override → no-op', () => {
  assert.equal(computeStudioEditorAction('/docs/chemistry/zh/foo', ctx('code', true, 'tiptap')), null)
})

test('computeStudioEditorAction — refresh on chemistry → rehydrate override without clobbering stored mode', () => {
  const action = computeStudioEditorAction('/docs/chemistry/zh/foo', ctx('code', false, 'tiptap'))
  assert.deepEqual(action, {
    setOverride: true,
    setPreviousMode: 'tiptap',
    editorMode: undefined,
  })
})

test('computeStudioEditorAction — leaving chemistry → restore remembered tiptap mode', () => {
  const action = computeStudioEditorAction('/docs/manual/en/start', ctx('code', true, 'tiptap'))
  assert.deepEqual(action, {
    clearOverride: true,
    clearPreviousMode: true,
    editorMode: 'tiptap',
  })
})

test('computeStudioEditorAction — leaving chemistry → restore remembered code mode', () => {
  const action = computeStudioEditorAction('/docs/manual/en/start', ctx('code', true, 'code'))
  assert.deepEqual(action, {
    clearOverride: true,
    clearPreviousMode: true,
    editorMode: undefined,
  })
})

test('computeStudioEditorAction — stale chemistry override after tab reopen → restore tiptap', () => {
  const action = computeStudioEditorAction('/docs/manual/en/start', ctx('code', false, 'tiptap'))
  assert.deepEqual(action, {
    clearOverride: undefined,
    clearPreviousMode: true,
    editorMode: 'tiptap',
  })
})

test('computeStudioEditorAction — stale chemistry override with code preference → just clear metadata', () => {
  const action = computeStudioEditorAction('/docs/manual/en/start', ctx('code', false, 'code'))
  assert.deepEqual(action, {
    clearOverride: undefined,
    clearPreviousMode: true,
    editorMode: undefined,
  })
})

test('computeStudioEditorAction — chemistry prefix edge cases', () => {
  // Only exact prefix matches count.
  assert.equal(computeStudioEditorAction('/docs/chemistry-manual/en/start', ctx('tiptap')), null)

  // Trailing slash on chemistry root counts.
  const action = computeStudioEditorAction('/docs/chemistry/', ctx('tiptap'))
  assert.deepEqual(action, {
    setOverride: true,
    setPreviousMode: 'tiptap',
    editorMode: 'code',
  })

  // Without trailing slash does NOT match '/docs/chemistry/' prefix.
  assert.equal(computeStudioEditorAction('/docs/chemistry', ctx('tiptap')), null)
})

test('computeStudioEditorAction — missing previous mode falls back to tiptap', () => {
  const action = computeStudioEditorAction('/docs/manual/en/start', ctx('code', true, null))
  assert.deepEqual(action, {
    clearOverride: true,
    clearPreviousMode: undefined,
    editorMode: 'tiptap',
  })
})
