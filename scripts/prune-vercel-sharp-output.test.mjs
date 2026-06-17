import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pruneVercelSharpOutput, vercelNodeSharpPackages } from './prune-vercel-sharp-output.mjs'
import { VercelNodeSharpPackageNames } from '../layer/utils/vercel-sharp'

test('deploy prune script uses the same sharp package allowlist as Nitro tracing', () => {
  assert.deepEqual(vercelNodeSharpPackages, VercelNodeSharpPackageNames)
})

test('prunes unsupported sharp binaries from prebuilt Vercel function output', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tockdocs-sharp-prune-'))

  try {
    const functionDir = join(rootDir, '__fallback.func')
    const imgDir = join(functionDir, 'node_modules', '@img')

    mkdirSync(imgDir, { recursive: true })

    for (const packageName of [
      'colour',
      'sharp-linux-x64',
      'sharp-libvips-linux-x64',
      'sharp-darwin-arm64',
      'sharp-win32-x64',
      'sharp-libvips-linux-arm64',
    ]) {
      mkdirSync(join(imgDir, packageName), { recursive: true })
      writeFileSync(join(imgDir, packageName, 'package.json'), '{}\n')
    }

    writeFileSync(join(functionDir, 'package.json'), JSON.stringify({
      type: 'module',
      dependencies: {
        '@img/colour': '1.1.0',
        '@img/sharp-linux-x64': '0.34.5',
        '@img/sharp-libvips-linux-x64': '1.2.4',
        '@img/sharp-darwin-arm64': '0.34.5',
        '@img/sharp-win32-x64': '0.34.5',
        'sharp': '0.34.5',
      },
      optionalDependencies: {
        '@img/sharp-libvips-linux-arm64': '1.2.4',
      },
    }, null, 2))

    const result = pruneVercelSharpOutput(functionDir)

    assert.deepEqual(result.keptDirectories.sort(), [
      'colour',
      'sharp-libvips-linux-x64',
      'sharp-linux-x64',
    ])
    assert.deepEqual(result.removedDirectories.sort(), [
      'sharp-darwin-arm64',
      'sharp-libvips-linux-arm64',
      'sharp-win32-x64',
    ])

    assert.equal(existsSync(join(imgDir, 'sharp-linux-x64')), true)
    assert.equal(existsSync(join(imgDir, 'sharp-libvips-linux-x64')), true)
    assert.equal(existsSync(join(imgDir, 'sharp-darwin-arm64')), false)
    assert.equal(existsSync(join(imgDir, 'sharp-win32-x64')), false)

    const prunedPackageJson = JSON.parse(readFileSync(join(functionDir, 'package.json'), 'utf8'))

    assert.deepEqual(Object.keys(prunedPackageJson.dependencies).sort(), [
      '@img/colour',
      '@img/sharp-libvips-linux-x64',
      '@img/sharp-linux-x64',
      'sharp',
    ])
    assert.deepEqual(prunedPackageJson.optionalDependencies, {})
  }
  finally {
    rmSync(rootDir, { recursive: true, force: true })
  }
})
