#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const vercelNodeSharpPackages = [
  'colour',
  'sharp-linux-x64',
  'sharp-libvips-linux-x64',
]

const vercelNodeSharpPackageSet = new Set(vercelNodeSharpPackages)

function isImgPackageName(packageName) {
  return packageName.startsWith('@img/')
}

function getImgPackageBasename(packageName) {
  return packageName.slice('@img/'.length)
}

export function pruneVercelSharpOutput(functionDir) {
  const imgDir = join(functionDir, 'node_modules', '@img')
  const keptDirectories = []
  const removedDirectories = []

  if (existsSync(imgDir)) {
    for (const entry of readdirSync(imgDir, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue
      }

      const packageName = entry.name

      if (vercelNodeSharpPackageSet.has(packageName)) {
        keptDirectories.push(packageName)
        continue
      }

      rmSync(join(imgDir, packageName), { recursive: true, force: true })
      removedDirectories.push(packageName)
    }
  }

  const packageJsonPath = join(functionDir, 'package.json')
  const removedPackageDependencies = []

  if (existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

    for (const section of ['dependencies', 'optionalDependencies']) {
      const dependencies = packageJson[section]

      if (!dependencies) {
        continue
      }

      for (const packageName of Object.keys(dependencies)) {
        if (!isImgPackageName(packageName)) {
          continue
        }

        if (vercelNodeSharpPackageSet.has(getImgPackageBasename(packageName))) {
          continue
        }

        delete dependencies[packageName]
        removedPackageDependencies.push(packageName)
      }
    }

    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
  }

  return {
    keptDirectories,
    removedDirectories,
    removedPackageDependencies,
  }
}

function printSummary(result) {
  console.log(`[TockDocs] Kept Vercel sharp packages: ${vercelNodeSharpPackages.join(', ')}`)
  console.log(`[TockDocs] Removed ${result.removedDirectories.length} unsupported sharp package directories.`)
  console.log(`[TockDocs] Removed ${result.removedPackageDependencies.length} unsupported sharp package.json entries.`)
}

function main() {
  const functionDir = process.argv[2]

  if (!functionDir) {
    console.error('Usage: node scripts/prune-vercel-sharp-output.mjs <vercel-function-dir>')
    process.exit(1)
  }

  if (!existsSync(functionDir)) {
    console.error(`Vercel function directory not found: ${functionDir}`)
    process.exit(1)
  }

  printSummary(pruneVercelSharpOutput(functionDir))
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main()
}
