import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { extendViteConfig, createResolver, useNuxt } from '@nuxt/kit'
import { resolveModulePath } from 'exsolve'
import { CONTENT_SOURCE_ASSET_BASE_NAME, CONTENT_SOURCE_ASSET_PATTERN } from './utils/content-source'
import { getKnowledgeBaseEntrySlug } from './utils/docs'
import { inferSiteURL, trimTrailingSlash } from './utils/meta'
import { getTockDocsContentConfiguration } from './utils/knowledge-bases'
import { shouldIgnoreNitroSharpTrace } from './utils/vercel-sharp'

const { resolve } = createResolver(import.meta.url)
const DevPort = 4987
const DefaultSiteUrl = trimTrailingSlash(inferSiteURL() || `http://127.0.0.1:${DevPort}`)
const MathJaxCustomElements = ['mjx-assistive-mml', 'mjx-container', 'mjx-status', 'mjx-tip', 'mjx-tool']
const iconScanPattern = '**/*.{vue,ts,js,mjs,md,yml,yaml}'
const LayerDirectOptimizeDeps = ['@vueuse/core', 'motion-v', '@ai-sdk/vue', 'ai'] as const
const LayerModuleOptimizeDeps = {
  '@barzhsieh/nuxt-content-mermaid': [
    'mermaid',
    '@braintree/sanitize-url',
    'dayjs',
    'dayjs/plugin/isoWeek.js',
    'dayjs/plugin/customParseFormat.js',
    'dayjs/plugin/advancedFormat.js',
    'dayjs/plugin/duration.js',
  ],
  '@nuxt/content': ['slugify'],
  '@nuxtjs/mdc': [
    'remark-gfm',
    'remark-emoji',
    'remark-mdc',
    'remark-rehype',
    'rehype-raw',
    'parse5',
    'unist-util-visit',
    'unified',
    'debug',
    'extend',
  ],
} as const
const layerModuleEntryPaths = Object.fromEntries(
  Object.keys(LayerModuleOptimizeDeps).map(moduleId => [moduleId, resolveModulePath(moduleId, { from: import.meta.url })]),
) as Record<keyof typeof LayerModuleOptimizeDeps, string>
const layerOptimizeDepAliasEntries = [
  ...LayerDirectOptimizeDeps.map(dep => [dep, resolveModulePath(dep, { from: import.meta.url })] as const),
  ...Object.entries(LayerModuleOptimizeDeps).flatMap(([moduleId, deps]) =>
    deps.map(dep => [dep, resolveModulePath(dep, { from: layerModuleEntryPaths[moduleId as keyof typeof LayerModuleOptimizeDeps] })] as const),
  ),
]
const layerOptimizeDepAliases = layerOptimizeDepAliasEntries.map(([id, replacement]) => ({
  find: new RegExp(`^${escapeRegExp(id)}$`),
  replacement,
}))
const layerIconScanInclude = [
  resolve('./app'),
  resolve('./modules'),
]
  .filter(target => existsSync(target))
  .map(target => join(target, iconScanPattern))

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeOptimizeDepEntry(id: string) {
  let normalized = id.trim()

  while (normalized.startsWith('tockdocs > ')) {
    normalized = normalized.slice('tockdocs > '.length)
  }

  for (const moduleId of Object.keys(LayerModuleOptimizeDeps)) {
    const prefix = `${moduleId} > `
    if (normalized.startsWith(prefix)) {
      return normalized.slice(prefix.length)
    }
  }

  return normalized
}

function normalizeOptimizeDepList(entries?: string[]) {
  return [...new Set((entries || []).map(normalizeOptimizeDepEntry))]
}

function getConfiguredAssistantProviderFromEnv() {
  const explicitProvider = process.env.AI_PROVIDER?.trim().toLowerCase()

  if (explicitProvider) {
    return explicitProvider
  }

  if (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN) return 'vercel'
  if (process.env.OPENROUTER_API_KEY) return 'openrouter'
  if (process.env.DEEPSEEK_API_KEY) return 'deepseek'
  if (process.env.NVIDIA_API_KEY) return 'nvidia'
  if (process.env.HUGGINGFACE_API_KEY) return 'huggingface'
  if (process.env.GROQ_API_KEY) return 'groq'
  if (process.env.GITHUB_TOKEN) return 'github'
  if (process.env.GEMINI_API_KEY) return 'gemini'
  if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) return 'cloudflare'

  return undefined
}

const configuredAssistantProvider = getConfiguredAssistantProviderFromEnv()

function resolveIconScanInclude(rootDir: string, srcDir: string) {
  return [...new Set([
    join(rootDir, 'app'),
    join(rootDir, 'content'),
    join(srcDir, 'app'),
    join(srcDir, 'content'),
    resolve('./app'),
    resolve('./modules'),
  ]
    .filter(target => existsSync(target))
    .map(target => join(target, iconScanPattern)))]
}

type TockDocsI18nOptions = { locales?: Array<string | { code: string }> }

export default defineNuxtConfig({
  modules: [
    resolve('./modules/config'),
    resolve('./modules/index-generator'),
    resolve('./modules/routing'),
    resolve('./modules/markdown-rewrite'),
    resolve('./modules/skills'),
    resolve('./modules/css'),
    () => {
      const nuxt = useNuxt()
      nuxt.options.icon ||= {}
      nuxt.options.icon.customCollections ||= []
      nuxt.options.icon.clientBundle ||= {}

      const existingScan = typeof nuxt.options.icon.clientBundle.scan === 'object' && nuxt.options.icon.clientBundle.scan
        ? nuxt.options.icon.clientBundle.scan
        : {}
      const existingGlobInclude = Array.isArray(existingScan.globInclude)
        ? existingScan.globInclude
        : []

      nuxt.options.icon.customCollections.push({
        prefix: 'custom',
        dir: join(nuxt.options.srcDir, 'assets/icons'),
      })

      nuxt.options.icon.clientBundle.scan = {
        ...existingScan,
        globInclude: [...new Set([
          ...existingGlobInclude,
          ...resolveIconScanInclude(nuxt.options.rootDir, nuxt.options.srcDir),
        ])],
      }
    },
    '@nuxt/ui',
    '@barzhsieh/nuxt-content-mermaid',
    '@nuxt/content',
    '@nuxt/image',
    '@nuxtjs/robots',
    '@nuxtjs/mcp-toolkit',
    'nuxt-og-image',
    'nuxt-llms',
    () => {
      // Update @nuxt/content optimizeDeps options
      extendViteConfig((config) => {
        config.optimizeDeps ||= {}
        config.optimizeDeps.include ||= []
        config.optimizeDeps.include.push('slugify')

        // Fix @vercel/oidc ESM export issue (transitive dep of @ai-sdk/gateway)
        // Only needed when the active assistant provider actually uses Vercel.
        if (configuredAssistantProvider === 'vercel') {
          config.optimizeDeps.include.push('@vercel/oidc')
        }
      })
    },
  ],
  devtools: {
    enabled: true,
  },
  css: [resolve('./app/assets/css/main.css')],
  vue: {
    compilerOptions: {
      isCustomElement: tag => tag.startsWith('mjx-'),
    },
  },
  content: {
    experimental: { sqliteConnector: 'native' },
    build: {
      markdown: {
        highlight: {
          langs: ['bash', 'diff', 'json', 'js', 'ts', 'html', 'css', 'vue', 'shell', 'mdc', 'md', 'yaml'],
        },
        remarkPlugins: {
          'remark-math': {
            options: {
              singleDollarTextMath: true,
            },
          },
          'remark-mdc': {
            options: {
              autoUnwrap: true,
            },
          },
        },
        rehypePlugins: {
          // Render math as SVG. MathJax's injected <style> block is stripped
          // from the rendered markdown AST before SSR so the first server render
          // and client hydration see identical markup. The shared base stylesheet
          // lives in layer/app/assets/css/main.css, and the Nitro middleware
          // still acts as a fallback for any HTML that slips through.
          'rehype-mathjax': {
            options: {
              svg: {
                fontCache: 'none',
              },
              tex: {
                inlineMath: [['$', '$'], ['\\(', '\\)']],
                displayMath: [['$$', '$$'], ['\\[', '\\]']],
                packages: {
                  '[+]': ['ams', 'mhchem', 'extpfeil'],
                },
              },
            },
          },
          [resolve('./utils/rehype-mathjax-strip-styles.mjs')]: {},
        },
      },
    },
  },
  mdc: {
    components: {
      customElements: MathJaxCustomElements,
    },
    highlight: {
      shikiEngine: 'javascript',
    },
  },
  runtimeConfig: {
    assistant: {
      provider: process.env.AI_PROVIDER || '',
      model: process.env.AI_MODEL || '',
      apiPath: '',
      mcpServer: '',
      assistantFsBackend: process.env.ASSISTANT_FS_BACKEND || 'mcp',
      aiGatewayApiKey: process.env.AI_GATEWAY_API_KEY || '',
      openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
      openrouterModel: process.env.OPENROUTER_MODEL || 'minimax/minimax-m2.5:free',
      deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
      deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
      nvidiaApiKey: process.env.NVIDIA_API_KEY || '',
      nvidiaModel: process.env.NVIDIA_MODEL || 'minimaxai/minimax-m2.7',
      huggingfaceApiKey: process.env.HUGGINGFACE_API_KEY || '',
      huggingfaceModel: process.env.HUGGINGFACE_MODEL || 'deepseek-ai/DeepSeek-V4-Pro:together',
      groqApiKey: process.env.GROQ_API_KEY || '',
      groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      githubToken: process.env.GITHUB_TOKEN || '',
      githubModel: process.env.GITHUB_MODEL || 'openai/gpt-5',
      geminiApiKey: process.env.GEMINI_API_KEY || '',
      geminiModel: process.env.GEMINI_MODEL || 'gemini-3.1-flash-live-preview',
      cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN || '',
      cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
      cloudflareModel: process.env.CLOUDFLARE_MODEL || '@cf/google/gemma-4-26b-a4b-it',
    },
  },
  routeRules: {
    '/docs/**': {
      headers: {
        'cache-control': 'public, max-age=3600, must-revalidate',
      },
    },
    '/llms.txt': {
      headers: {
        'cache-control': 'public, max-age=3600',
      },
    },
    '/llms-full.txt': {
      headers: {
        'cache-control': 'public, max-age=3600',
      },
    },
    '/sitemap.xml': {
      headers: {
        'cache-control': 'public, max-age=3600',
      },
    },
    '/.well-known/skills/**': {
      headers: {
        'cache-control': 'public, max-age=3600',
      },
    },
  },
  devServer: {
    host: process.env.NUXT_HOST || 'localhost',
    port: DevPort,
  },
  experimental: {
    asyncContext: true,
  },
  compatibilityDate: '2025-07-22',
  nitro: {
    prerender: {
      crawlLinks: true,
      failOnError: false,
      autoSubfolderIndex: false,
    },
    compatibilityDate: {
      // Don't generate observability routes for now
      vercel: '2025-07-14',
    },
    externals: {
      traceOptions: {
        ignore: shouldIgnoreNitroSharpTrace,
      },
    },
  },
  vite: {
    build: {
      // Suppress the default 500 kB chunk-size warning for client bundles.
      // Nuxt+Tailwind v4 can produce single-style chunks above the threshold
      // without indicating a real optimization problem.
      chunkSizeWarningLimit: 4096,
    },
    resolve: {
      alias: layerOptimizeDepAliases,
    },
    // The Mermaid Nuxt module injects optimizeDeps entries rooted at its own package
    // graph, and the assistant panel is lazy-loaded. Expose their actual resolved
    // package paths to the consumer app and pre-bundle the direct dependency ids so
    // Vite doesn't warn about unresolved layer-owned transitive deps or reload when
    // the assistant is opened for the first time.
    optimizeDeps: {
      include: [
        ...LayerDirectOptimizeDeps,
        ...LayerModuleOptimizeDeps['@barzhsieh/nuxt-content-mermaid'],
      ],
      needsInterop: [
        '@braintree/sanitize-url',
        'dayjs',
      ],
    },
    server: {
      strictPort: true,
    },
  },
  hooks: {
    'vite:extendConfig'(config) {
      if (!config.optimizeDeps) {
        return
      }

      if (Array.isArray(config.optimizeDeps.include)) {
        config.optimizeDeps.include = normalizeOptimizeDepList(config.optimizeDeps.include)
      }

      if (Array.isArray(config.optimizeDeps.needsInterop)) {
        config.optimizeDeps.needsInterop = normalizeOptimizeDepList(config.optimizeDeps.needsInterop)
      }
    },
    'nitro:config'(nitroConfig) {
      const nuxt = useNuxt()
      const contentDir = join(nuxt.options.rootDir, 'content')

      if (existsSync(contentDir)) {
        nitroConfig.serverAssets ||= []

        if (!nitroConfig.serverAssets.some(asset => asset?.baseName === CONTENT_SOURCE_ASSET_BASE_NAME)) {
          nitroConfig.serverAssets.push({
            baseName: CONTENT_SOURCE_ASSET_BASE_NAME,
            dir: contentDir,
            pattern: CONTENT_SOURCE_ASSET_PATTERN,
          })
        }
      }

      if (nuxt.options.dev) {
        return
      }

      const contentConfiguration = getTockDocsContentConfiguration(nuxt.options.rootDir)
      const i18nOptions = (nuxt.options as typeof nuxt.options & { i18n?: TockDocsI18nOptions }).i18n

      const routes: string[] = []

      if (contentConfiguration.mode === 'kb') {
        routes.push('/')
        for (const knowledgeBase of contentConfiguration.knowledgeBases) {
          const slug = getKnowledgeBaseEntrySlug(knowledgeBase)
          for (const locale of knowledgeBase.locales) {
            routes.push(
              slug.length > 0
                ? `/docs/${knowledgeBase.id}/${locale}/${slug.join('/')}`
                : `/docs/${knowledgeBase.id}/${locale}`,
            )
          }
        }
      }
      else if (!i18nOptions) {
        routes.push('/')
      }
      else {
        routes.push(...(i18nOptions.locales?.map((locale: string | { code: string }) => typeof locale === 'string' ? `/${locale}` : `/${locale.code}`) || []))
      }

      nitroConfig.prerender = nitroConfig.prerender || {}
      nitroConfig.prerender.routes = nitroConfig.prerender.routes || []
      nitroConfig.prerender.routes.push(...routes)
      nitroConfig.prerender.routes.push('/sitemap.xml')
      nitroConfig.prerender.routes.push('/_og/s/c_Studio.png')

      // On Vercel, skip node-file-trace for externals entirely — the deployment
      // runtime installs node_modules from package.json, so tracing 460+ trees
      // is wasted work that adds ~2 minutes per build.
      if (process.env.VERCEL) {
        nitroConfig.externals = nitroConfig.externals || {}
        nitroConfig.externals.trace = false
      }
    },
  },
  i18n: {
    defaultLocale: 'en',
  },
  icon: {
    customCollections: [
      {
        prefix: 'custom',
        dir: resolve('./app/assets/icons'),
      },
    ],
    clientBundle: {
      icons: [
        'lucide:arrow-left',
        'lucide:arrow-up',
        'lucide:copy',
        'lucide:hash',
        'lucide:info',
        'lucide:lightbulb',
        'lucide:monitor',
        'lucide:moon',
        'lucide:sparkles',
        'lucide:sun',
        'lucide:terminal',
        'lucide:trash-2',
        'simple-icons:github',
        'vscode-icons:file-type-bun',
        'vscode-icons:file-type-css',
        'vscode-icons:file-type-dotenv',
        'vscode-icons:file-type-js',
        'vscode-icons:file-type-json',
        'vscode-icons:file-type-markdown',
        'vscode-icons:file-type-node',
        'vscode-icons:file-type-npm',
        'vscode-icons:file-type-nuxt',
        'vscode-icons:file-type-pnpm',
        'vscode-icons:file-type-typescript',
        'vscode-icons:file-type-vue',
        'vscode-icons:file-type-yaml',
        'vscode-icons:file-type-yarn',
      ],
      scan: {
        globInclude: layerIconScanInclude,
      },
      includeCustomCollections: true,
    },
    provider: 'iconify',
  },
  image: {
    format: [],
  },
  llms: {
    domain: DefaultSiteUrl,
  },
  ogImage: {
    zeroRuntime: true,
  },
  robots: {
    groups: [
      {
        userAgent: '*',
        allow: '/',
      },
    ],
    sitemap: '/sitemap.xml',
  },
})
