# AGENTS.md

## Overview

TockDocs is an AI-powered Knowledge Management System.

- `layer/` is the main product: the TockDocs theme, layouts, routing, knowledge-base/content resolution, server utilities, AI assistant, MCP tools, and shared runtime assets.
- `docs/` is the official documentation site (`tockdocs.dev`) and a real consumer of the layer.
- `playground/` is a lightweight local consumer used to validate the layer in isolation.
- `cli/` publishes `create-tockdocs`, which scaffolds new projects from the starter templates.
- `.starters/` contains the `default` and `i18n` templates consumed by the CLI.

CI (`.github/workflows/ci.yml`) installs dependencies, prepares Nuxt types, lints, checks i18n and MDC source integrity, typechecks, builds the CLI, and validates package publishability.

The repo’s core architecture is: **build TockDocs once as an AI-powered Nuxt layer, then reuse it across the docs site, playground, and generated starter projects**.

## Tech Stack

| Tech                                  | Use Case      |
| ------------------------------------- | ------------- |
| pnpm, Node.js, TypeScript, release-it | Workspace     |
| Nuxt 4 + Vue 3                        | App Framework |
| Nuxt Content, MDC, Shiki, Nuxt Image  | Content       |
| Nuxt UI, Tailwind CSS 4, Iconify      | UI            |
| Nuxt i18n                             | Localization  |
| AI SDK                                | Assistant     |
| FlexSearch, Fuse.js, MCP toolkit      | Search        |
| Nuxt OG Image, Nuxt LLMs, Robots      | Metadata      |
| npm packages                          | Publishing    |

## Project Structure

Use `tree -L2` or `tree -L3` to maintain this section.

```text
.
├── .agents/                 # Agent progress, reference docs, and local skills
├── .github/                 # CI and PR-related repo automation
├── .starters/               # CLI starter templates (default, i18n)
├── cli/                     # create-tockdocs package
│   ├── cli.ts               # CLI command definition
│   └── main.ts              # CLI entrypoint
├── docs/                    # Official docs app extending the TockDocs layer
│   ├── app/                 # Docs-site-specific app config/plugins
│   ├── content/             # Documentation content
│   ├── public/              # Site assets shipped by the docs consumer
│   └── nuxt.config.ts       # Docs-site config
├── layer/                   # Reusable TockDocs Nuxt layer
│   ├── app/                 # Layouts, pages, components, composables
│   ├── i18n/                # Locale message files
│   ├── modules/             # TockDocs Nuxt modules
│   ├── server/              # MCP tools, search, sitemap, content helpers
│   ├── shared/              # Shared type declarations
│   ├── utils/               # Mode, content, and metadata helpers
│   └── nuxt.config.ts       # Layer composition root
├── playground/              # Minimal local consumer for manual testing
│   ├── content/             # Legacy-mode sample docs
│   └── skills/              # Sample consumer-owned agent skills
├── scripts/                 # Env/bootstrap helper scripts
├── package.json             # Workspace scripts
└── pnpm-workspace.yaml      # Workspace package definitions
```

## Reference (`.agents/reference/`)

| File              | Purpose                              |
| ----------------- | ------------------------------------ |
| `architecture.md` | Architecture, routing, dual backend  |
| `assistant.md`    | Assistant flow, MCP/GitFS, debugging |
| `review.md`       | Review checklist                     |
| `plan.md`         | Development Plan                     |

## Deployment

### Docs Site

The official docs app lives in `docs/`, extends `tockdocs` from `layer/`, and is deployed directly from `docs/` (template-style Vercel setup).

Important deployment facts:

- For Vercel deployments, point the project at `docs/`; `docs/package.json` prepares the layer before `nuxt build`, so no `vercel.json` is needed in that setup
- Verification command: `pnpm run verify`
- Site config is defined in `docs/nuxt.config.ts`
- Nitro prerendering, sitemap generation, robots output, OG image generation, `llms.txt`, source-markdown serving (`/source`, `/raw`, and `.md` aliases), and skill manifests are configured through the layer
- Set `NUXT_SITE_URL` to the public deployment origin for the site (for example `https://tockdocs-pi-nine.vercel.app`) and do not include a trailing slash; `nuxt-llms` concatenates `/llms-full.txt` directly from this value
- Keep `NUXT_APP_BASE_URL=/` for the site root unless the site is hosted under a subpath

### Nuxt Studio

- The Studio admin route is `/admin`
- Add `STUDIO_GITHUB_CLIENT_ID` and `STUDIO_GITHUB_CLIENT_SECRET` to the deployment environment
- Optionally set `STUDIO_GITHUB_MODERATORS` to restrict access to specific GitHub emails
- Configure the GitHub OAuth callback URL to `https://<your-domain>/__nuxt_studio/auth/github`
- Open Studio after deployment at `https://<your-domain>/admin`

### Environment Variables

The repo loads `.env` / `.env.local` through `scripts/run-dev.mjs` and `scripts/with-env.mjs`.

| Env Var                       | Use Case                               |
| ----------------------------- | -------------------------------------- |
| NUXT_HOST                     | Local Dev Host                         |
| NUXT_PORT                     | Local Dev Port                         |
| NUXT_APP_BASE_URL             | Deployment Base Path                   |
| NUXT_SITE_URL                 | Canonical Site URL (no trailing slash) |
| AI_PROVIDER                   | Assistant Provider                     |
| AI_MODEL                      | Model Override                         |
| AI_GATEWAY_API_KEY            | Vercel AI Gateway                      |
| VERCEL_OIDC_TOKEN             | AI Gateway OIDC auth                   |
| OPENROUTER_API_KEY            | OpenRouter Access                      |
| OPENROUTER_MODEL              | OpenRouter Model                       |
| DEEPSEEK_API_KEY              | DeepSeek Access                        |
| DEEPSEEK_MODEL                | DeepSeek Model                         |
| NVIDIA_API_KEY                | NVIDIA Access                          |
| NVIDIA_MODEL                  | NVIDIA Model                           |
| HUGGINGFACE_API_KEY           | Hugging Face Access                    |
| HUGGINGFACE_MODEL             | Hugging Face Model                     |
| GROQ_API_KEY                  | Groq Access                            |
| GROQ_MODEL                    | Groq Model                             |
| GITHUB_TOKEN                  | GitHub Models Access                   |
| GITHUB_MODEL                  | GitHub Model                           |
| GEMINI_API_KEY                | Gemini Access                          |
| GEMINI_MODEL                  | Gemini Model                           |
| CLOUDFLARE_ACCOUNT_ID         | Cloudflare Account                     |
| CLOUDFLARE_API_TOKEN          | Cloudflare API Token                   |
| CLOUDFLARE_MODEL              | Cloudflare Model                       |
| BLOB_READ_WRITE_TOKEN         | Vercel Blob Token                      |
| STUDIO_GITHUB_CLIENT_ID       | NS GitHub Client                       |
| STUDIO_GITHUB_CLIENT_SECRET   | NS GitHub Secret                       |
| STUDIO_GITHUB_MODERATORS      | NS Access Allowlist                    |
| NUXT_PUBLIC_ASSISTANT_ENABLED | Force Enable Assistant                 |
| ASSISTANT_FS_BACKEND          | Retrieval backend: `mcp` or `gitfs`    |
| GITFS_GITHUB_OWNER            | GitFS source repo owner                |
| GITFS_GITHUB_REPO             | GitFS source repo name                 |
| GITFS_REF                     | GitFS source repo ref                  |

The local dev launcher uses port **4987** with `strictPort: true`; it does not fall back to `3000` or `3001`.

## Development Guidelines

- Do not run `pnpm dev`, `nuxt dev`, or other long-running app processes without user's permission.
- Read `architecture.md` and `assistant.md` before reading anything else or writng any code.
- Read `deploy.md`, before deploying to Vercel.
