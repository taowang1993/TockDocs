const VercelNodeSharpPackages = new Set([
  'colour',
  'sharp-linux-x64',
  'sharp-libvips-linux-x64',
])

export const VercelNodeSharpPackageNames = [...VercelNodeSharpPackages]

export function getSharpOptionalPackageName(tracePath: string) {
  const normalizedPath = tracePath.replace(/\\/g, '/')
  const scopedPackageName = normalizedPath.match(/(?:^|\/)@img\/([^/]+)/)?.[1]

  if (scopedPackageName) {
    return scopedPackageName
  }

  return normalizedPath.match(/(?:^|\/)@img\+([^/@]+)@/)?.[1]
}

export function shouldIgnoreNitroSharpTrace(tracePath: string) {
  const packageName = getSharpOptionalPackageName(tracePath)

  if (!packageName) {
    return false
  }

  return !VercelNodeSharpPackages.has(packageName)
}
