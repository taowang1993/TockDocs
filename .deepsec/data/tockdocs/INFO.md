# tockdocs

## What this codebase does

TockDocs is a pnpm workspace for an AI-powered Nuxt documentation layer. `layer/` is the reusable product: routing, content collection resolution, markdown source serving, MCP tools, assistant runtime, skills catalog routes, and shared UI. `docs/` is the official KB-mode site with manual, chemistry, and investing knowledge bases. `playground/` exercises legacy mode, and `cli/` publishes `create-tockdocs` from `.starters/` templates.

## Auth shape

- There is no custom end-user session middleware for normal docs pages; documentation, markdown aliases, MCP tools, and skill manifests are intentionally public/read-only surfaces.
- Assistant availability is credential-gated by `layer/modules/assistant/index.ts` (`hasAssistantCredentials`, `NUXT_PUBLIC_ASSISTANT_ENABLED`) and runtime provider resolution in `getAssistantProviderConfig` / `createAssistantChatModel`.
- Docs retrieval scope is enforced by `getAssistantScope`, `getScopedKnowledgeBaseAndLocale`, `resolveDocsRoute`, and `isPathWithinDocsScope`; these keep assistant/MCP reads within the active KB and locale.
- GitFS assistant mode requires `GITHUB_TOKEN`; `validateGitFsCommand` restricts model bash commands to `/repo` and `/workspace` and blocks parent traversal.
- The `/admin` Studio surface is provided by `nuxt-studio` in `docs/nuxt.config.ts` and uses GitHub-backed Studio configuration, not a local auth helper.

## Threat model

A public visitor can reach rendered docs, `/source`, `/raw`, `.md` aliases, `/.well-known/skills/*`, MCP tools, and `/__tockdocs__/assistant` when the assistant is enabled. Highest-impact bugs would leak server env credentials, allow arbitrary source-file reads outside content, let a prompt/tool call cross KB or locale boundaries, enable shell access beyond GitFS' virtual roots, or let untrusted content cause XSS in rendered docs. Cost/DoS is also important: assistant requests can trigger paid provider calls, MCP index builds, GitFS prefetches, or large search workloads.

## Project-specific patterns to flag

- Any new markdown/source/raw handler must resolve through Nuxt Content (`findContentPageByPath`, `queryCollection`) before reading files; avoid direct path joins from request URLs.
- Any MCP or assistant retrieval change must preserve KB/locale scoping and reject malformed `kb`/`locale` input rather than widening to all docs by accident.
- Any GitFS/bash change must preserve `validateGitFsCommand`, command timeouts, `/repo` read-only mounting, and `/workspace` scratch isolation.
- Any new assistant provider path must keep API keys server-only and must not echo provider config, tokens, request headers, or model errors containing secrets to the browser.
- Any skill-catalog change must remember `scanSkills` exposes every non-dotfile under consumer `skills/<name>/`; validate frontmatter and do not serve arbitrary hidden/config files.

## Known false-positives

- `docs/content/**`, `playground/content/**`, and `.starters/**/content/**` are authored markdown/examples; suspicious code blocks or external URLs there are documentation, not runtime handlers.
- `/source`, `/raw`, rendered `.md` aliases, `llms.txt`, sitemap routes, MCP `search-pages`/`list-pages`/`get-page`, and `/.well-known/skills/*` are intentionally public read-only documentation endpoints.
- `.deepsec/**`, `.nuxt/**`, `.data/**`, `.vercel/**`, `dist/**`, `node_modules/**`, generated search indexes, and build output should not be treated as product source.
- `scripts/upload-assets.mjs` and `scripts/delete-blobs.mjs` are local operator scripts using `BLOB_READ_WRITE_TOKEN`; their CLI args are not web-exposed endpoints.
- `playground/`, `.starters/`, and sample docs may intentionally contain insecure-looking demo snippets, placeholder config, public blob URLs, or toy assistant/skill examples.
