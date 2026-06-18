# TockDocs Architecture

## Overview

TockDocs is a pnpm workspace built around a reusable **Nuxt layer**.

- **`layer/`** is the product: the shared theme, routing model, content discovery, source-markdown pipeline, search runtime, MCP tools, and assistant runtime.
- **`docs/`** is the official site and the main real-world consumer. It extends the layer and adds `@nuxtjs/i18n`, `nuxt-skill-hub`, and `nuxt-studio`.
- **`playground/`** is a lightweight local consumer used to keep the layer's legacy, no-i18n mode exercised.
- **`cli/`** publishes `create-tockdocs`, which scaffolds projects from **`.starters/`**.

The repo supports two runtime shapes:

- **KB mode** — enabled when `content/<kb>/kb.yml` exists. Routes look like `/docs/<kb>/<locale>/...`.
- **Legacy mode** — no `kb.yml` files. With i18n enabled, routes are locale-prefixed (`/en/...`); without i18n, the site falls back to a single unprefixed docs tree.

## Software Architecture

```text
                              TockDocs Workspace
┌──────────────────────────────────────────────────────────────────────────────┐
│ Root pnpm Workspace                                                          │
│ package.json · pnpm-workspace.yaml · scripts/ · .github/workflows/ci.yml     │
└───────────────┬────────────────────────────┬─────────────────────────────────┘
                │                            │
                │ builds / publishes         │ scaffolds from
                │                            │
        ┌───────▼────────┐           ┌───────▼────────┐
        │ layer/         │           │ cli/           │
        │ Nuxt Layer     │           │ create-        │
        │ Product        │           │ tockdocs       │
        └───────┬────────┘           └───────┬────────┘
                │                            │
         extends│                            │copies
      ┌─────────┴──────────┐          ┌──────▼──────────────┐
      │                    │          │ .starters/          │
┌─────▼──────┐     ┌───────▼──────┐   │ default · i18n      │
│ docs/      │     │ playground/  │   └─────────────────────┘
│ Official   │     │ Local        │
│ Site       │     │ Consumer     │
└────────────┘     └──────────────┘

                                 Inside layer/
┌──────────────────────────────────────────────────────────────────────────────┐
│ Local Nuxt Modules                                                           │
│ config · routing · markdown-rewrite · skills · css · assistant · index-gen   │
└───────────────┬────────────────────────────┬─────────────────────────────────┘
                │                            │
                │ configures app/runtime     │ exposes server behavior
                │                            │
      ┌─────────▼──────────┐        ┌────────▼──────────────────────────────┐
      │ app/               │        │ server/                               │
      │ layouts · pages    │        │ sitemap · MCP tools · content helpers │
      │ Header/Footer      │        │ /source + /raw + .md aliases          │
      │ Navigation Shell   │        │ Docs Search + Source Serving          │
      └─────────┬──────────┘        └────────┬──────────────────────────────┘
                │                            │
                │ resolves collections       │ reads original markdown
                │                            │
      ┌─────────▼──────────┐        ┌────────▼──────────────────────────────┐
      │ content.config.ts  │        │ Nitro server assets                   │
      │ Dynamic Collections│        │ content/**/*.{md,mdc} in Production   │
      └─────────┬──────────┘        └───────────────────────────────────────┘
                │
                ▼
           Nuxt Content SQLite + Rendered Docs Pages

Assistant path

User → AssistantPanel.vue → /__tockdocs__/assistant → AI provider resolver
     → backend fork (ASSISTANT_FS_BACKEND):
       mcp   → MCP client/server → search-pages | list-pages | get-page
       index → INDEX.md in prompt → get-page only (single round-trip)
       gitfs → GitFS + bash tool → rg | find | ls | cat
     → /source markdown → streamed grounded answer
```

### KB Mode

`layer/utils/knowledge-bases.ts` scans `content/*/kb.yml` and builds `ResolvedKnowledgeBase[]` entries.

Each KB can define:

- `id` (route id; may differ from the directory name)
- `title`, `description`, `icon`
- `defaultLocale`, `locales`, `entry`
- `theme`, `searchPlaceholder`, `assistantName`
- localized `titles` / `descriptions`

Locale discovery is based on real subdirectories on disk. If `kb.yml` declares locales, TockDocs intersects that list with the locale folders that actually exist.

### Legacy Mode

When no `kb.yml` files exist, TockDocs falls back to a single docs tree:

- **with i18n** — per-locale collections under `content/<locale>/...`
- **without i18n** — one unprefixed docs collection, optionally using `content/docs/**`

## Content, Collections, and Routing

### 1. Runtime Config and i18n Shaping

`layer/modules/config.ts` is the main configuration module. It:

- normalizes `site.url`
- infers site metadata from `package.json` and local Git info when possible
- fills `app.config.ts` defaults for header, SEO, GitHub links, and layer locale messages
- filters i18n locales to those that have both a locale JSON file and matching content
- switches i18n strategy to:
  - `no_prefix` in KB mode
  - `prefix` in legacy i18n mode
- writes `runtimeConfig.public.tockdocs`:
  - `docsMode`
  - `knowledgeBases`
  - `knowledgeBaseSourceDirs`
  - `defaultKnowledgeBase`
  - `filteredLocales`
  - `hasSiteContent`
- writes private `runtimeConfig.tockdocs.knowledgeBases` so the server can recover original KB source directories

`layer/app/plugins/i18n.ts` then keeps the active locale synced with the current route and, in legacy i18n mode, redirects `/` to the preferred locale root.

### 2. Dynamic Content Collections

`layer/content.config.ts` builds Nuxt Content collections from the resolved mode:

- **KB mode**
  - one docs collection per KB+locale (`docs_<kb>_<locale>`)
  - optional `site` collection from `content/site/**/*`
- **Legacy mode with i18n**
  - one docs collection per locale (`docs_<locale>`)
  - optional landing collection per locale (`landing_<locale>`)
- **Legacy mode without i18n**
  - one `docs` collection
  - optional `landing` collection

When a consumer keeps docs under `content/<locale>/docs/**` or `content/docs/**`, the collection prefix stays `/docs`. Otherwise the prefix falls back to the locale root or `/`.

### 3. Route Wiring and Landing Injection

`layer/modules/routing.ts` swaps page routes based on the active mode:

- **KB mode**
  - removes the legacy catch-all page
  - replaces the generated docs page with `/docs/:kb/:locale/:slug(.*)*`
  - keeps the KB redirect pages (`/docs/[kb]` and `/docs/[kb]/[locale]`)
- **Legacy mode**
  - removes KB-specific pages

If the consumer does **not** provide `app/pages/index.vue`, routing injects `layer/app/templates/landing.vue`:

- in KB mode, it renders `content/site` when present, otherwise `KnowledgeBaseDirectory`
- in legacy mode, it renders the landing collection
- in legacy i18n mode, the injected landing route is `/:lang?`

### 4. Source Markdown Pipeline

Original markdown is a first-class runtime surface.

- `layer/nuxt.config.ts` bundles `content/**/*.{md,mdc}` into Nitro server assets in production under `assets:tockdocs-content-source`.
- `layer/server/handlers/source-markdown.ts` serves original content from `/source/**`.
- `layer/server/middleware/markdown-source-alias.ts` adds two aliases on top:
  - `/raw<path>.<ext>` → proxied `/source<path>.<ext>`
  - `<route>.md` / `<route>.mdc` → proxied `/source...`
- `layer/modules/markdown-rewrite.ts` rewrites `llms.txt` links to canonical markdown aliases and, on Vercel, injects redirect rules so requests with `Accept: text/markdown` or `curl` user agents resolve to `.md` outputs.

This pipeline is used by search, MCP tools, `DocsPageHeaderLinks`, edit/source links, and `llms.txt` generation.

## Layer Composition

### Local Module Graph

- **`config`** — Site metadata, i18n locale filtering, runtime config, landing OG prerender hints.
- **`routing`** — KB/legacy route selection, landing route injection, `useTockDocs*` imports.
- **`markdown-rewrite`** — Markdown alias handling, `llms.txt` link rewriting, Vercel markdown redirects.
- **`skills`** — Agent skill catalog scan, `/.well-known/skills/*` routes, prerendered manifests.
- **`css`** — Tailwind v4 source template for content, layer UI, and assistant runtime.
- **`assistant`** — Assistant enablement, public runtime config, component registration, assistant API route.
- **`index-generator`** — Build-time `INDEX.md` generation per KB × locale, index asset serving, on-demand dev fallback.

### App Shell

`layer/app/app.vue` is the composition root. It:

- sets HTML `lang` / `dir` and theme-aware favicons
- maps `zh` → `zh_cn` for Nuxt UI locale selection
- loads navigation and search sections for the active docs collection
- mounts the content-search overlay
- mounts the assistant panel and floating input when `useAssistant().isEnabled` is true
- shifts the page right when the desktop assistant is docked

`layer/app/layouts/docs.vue` builds the docs layout with:

- left navigation
- main page body
- right TOC / secondary actions

Both KB and legacy docs pages share the same rendering pipeline through `useDocsPage()`.

### Core Composables

- **`useTockDocs()`** — resolves the current mode, KB, locale, collection name, home path, and path-switching helpers.
- **`useTockDocsI18n()`** — wraps Nuxt i18n plus layer fallback catalogs. In KB mode, it only exposes locales that actually exist for the active KB.
- **`useDocsPage()`** — loads the current page, surrounding navigation, breadcrumbs, source/raw paths, and GitHub edit links.

## Search and Assistant Path

Search and assistant behavior are coupled through three backends, selected with `ASSISTANT_FS_BACKEND`:

**MCP (default, `mcp`):**

- `layer/server/mcp/tools/search-pages.ts`
- `layer/server/mcp/tools/list-pages.ts`
- `layer/server/mcp/tools/get-page.ts`
- `layer/server/utils/docs-search.ts`

**INDEX (`index`):**

- `layer/server/utils/index-generator.ts` — builds per-KB-per-locale `INDEX.md` from source content at build time
- `layer/modules/index-generator.ts` — Nuxt module that hooks into the build, writes index assets, and registers the serve route
- `layer/modules/assistant/runtime/server/utils/system-prompt.ts` — injects the index into the system prompt and exposes only `get-page`

**GitFS (opt-in, `gitfs`):**

- `layer/modules/assistant/runtime/server/utils/gitfs-bash.ts` — mounts `docs/content/<kb>/<locale>` at `/repo` via `@taowang1993/gitfs` + `just-bash`
- `layer/modules/assistant/runtime/server/utils/system-prompt.ts` — per-backend system prompts
- The model explores docs with `rg`, `find`, `ls`, `cat` inside the scoped subtree

All assistant backends enforce KB/locale scope: the assistant endpoint prefers a same-origin request referer, falls back to validated `X-TockDocs-KB` / `X-TockDocs-Locale` headers, and gates retrieval to that scope before any model or tool work starts.

Search (used by MCP tools) is a hybrid pipeline:

1. **FlexSearch** primary pass
2. **Fuse.js** fallback when exact retrieval is weak
3. **Lenient Fuse** retry for zero-result natural-language queries
4. **Script-only retry** for mixed Latin + CJK-style queries

Important implementation details:

- the cache is **scope-aware** (`kb` / `locale`) instead of one giant global index
- cache TTL is **60s in prod** and **10s in dev**
- `.navigation` pseudo-pages are excluded from indexing
- search reads **original markdown** from `/source<path>.<ext>`
- tool results point users to canonical `.md` alias URLs

### Backend Selection

- **`mcp`** — search-pages + list-pages + get-page; 2+ round-trips; no prompt preload. Best for small to medium KBs needing fuzzy search.
- **`index`** — get-page only; single round-trip; preloads INDEX.md (~2K tokens). Best for KBs under ~260 pages; fastest path.
- **`gitfs`** — bash (rg/find/ls/cat); 2+ round-trips; no prompt preload. Best for auto-scaling; works without build artifacts.

The INDEX backend falls back to MCP automatically when the generated index exceeds the 8K token budget, or when no index exists for the requested scope.

The assistant runtime lives under `layer/modules/assistant/runtime/`, while the layer UI mounts the actual entrypoints from `layer/app`:

- `AskAiButton` in the header
- `AssistantFloatingInput` on docs pages
- `Explain with AI` in the right sidebar
- `AssistantPanel` as the main chat surface

See [`assistant.md`](./assistant.md) for the full request, streaming, and provider flow.

## Build and Deployment Behavior

- Nuxt Content uses SQLite via `content.experimental.sqliteConnector = 'native'`.
  - **Dev:** `.data/content/*.sqlite`
  - **Prod:** a prebuilt read-only snapshot ships with the deployment artifact
- `layer/nuxt.config.ts` prerenders:
  - `/`
  - KB entry routes or locale roots
  - `/sitemap.xml`
  - the Studio OG image route
- `layer/modules/skills` prerenders `/.well-known/skills/index.json` plus per-skill files when a consumer ships a `skills/` directory
- `nuxt-og-image` runs with `zeroRuntime: true`
- `nuxt-llms`, `robots`, `sitemap.xml`, and markdown alias behavior are generated at build/prerender time
- on Vercel, Nitro disables `node-file-trace` for externals to reduce build time

## Operational Notes

- Dev host defaults to `localhost`; dev port is fixed at **`4987`** with `strictPort: true`.
- `scripts/run-dev.mjs` loads `.env` / `.env.local`, kills stale Nuxt dev servers, and refuses to fall back to `3000` or `3001`.
- `NUXT_SITE_URL` is normalized to an origin without a trailing slash.
- `docs/` primarily exercises KB mode, while `playground/` primarily exercises legacy mode.
- Assistant UI is available in dev, or in production when credentials exist or `NUXT_PUBLIC_ASSISTANT_ENABLED=true`.
