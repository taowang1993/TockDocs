import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getSharpOptionalPackageName, shouldIgnoreNitroSharpTrace, VercelNodeSharpPackageNames } from './vercel-sharp'

test('keeps only sharp packages needed by the Vercel Node runtime', () => {
  assert.deepEqual(VercelNodeSharpPackageNames, [
    'colour',
    'sharp-linux-x64',
    'sharp-libvips-linux-x64',
  ])
})

test('matches direct and pnpm store sharp optional package paths', () => {
  assert.equal(getSharpOptionalPackageName('node_modules/@img/sharp-win32-x64/lib/libvips-42.dll'), 'sharp-win32-x64')
  assert.equal(
    getSharpOptionalPackageName('node_modules/.pnpm/@img+sharp-libvips-darwin-arm64@1.2.4/node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.dylib'),
    'sharp-libvips-darwin-arm64',
  )
  assert.equal(getSharpOptionalPackageName('node_modules/.pnpm/@img+sharp-wasm32@0.34.5/node_modules/@img/sharp-wasm32/sharp.node'), 'sharp-wasm32')
  assert.equal(getSharpOptionalPackageName('node_modules/sharp/package.json'), undefined)
})

test('ignores non-Vercel sharp optional platform packages from Nitro tracing', () => {
  assert.equal(shouldIgnoreNitroSharpTrace('node_modules/@img/colour/package.json'), false)
  assert.equal(shouldIgnoreNitroSharpTrace('node_modules/@img/sharp-linux-x64/sharp.node'), false)
  assert.equal(shouldIgnoreNitroSharpTrace('node_modules/@img/sharp-libvips-linux-x64/lib/libvips-cpp.so.8.17.3'), false)

  assert.equal(shouldIgnoreNitroSharpTrace('node_modules/@img/sharp-darwin-arm64/sharp.node'), true)
  assert.equal(shouldIgnoreNitroSharpTrace('node_modules/@img/sharp-win32-x64/lib/libvips-42.dll'), true)
  assert.equal(shouldIgnoreNitroSharpTrace('node_modules/@img/sharp-libvips-linux-arm64/lib/libvips-cpp.so.8.17.3'), true)
  assert.equal(shouldIgnoreNitroSharpTrace('node_modules/@img/sharp-wasm32/sharp.node'), true)
  assert.equal(shouldIgnoreNitroSharpTrace('node_modules/@img/sharp-libvips-dev/include/vips/vips.h'), true)

  assert.equal(shouldIgnoreNitroSharpTrace('node_modules/ipx/dist/index.mjs'), false)
})
