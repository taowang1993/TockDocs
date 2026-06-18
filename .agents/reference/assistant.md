# TockDocs assistant internals

## Overview

The assistant is a docs-grounded chat system built from four layers:

1. **Route-aware layer UI** in `layer/app`
2. **Assistant runtime + shared state** in `layer/modules/assistant/runtime`
3. **Docs retrieval backend** — three options gated by `ASSISTANT_FS_BACKEND`:
   - **MCP** (`layer/server/mcp/tools`) — `search-pages`, `list-pages`, `get-page`
   - **INDEX** (`layer/server/utils/index-generator.ts`) — injects a generated `INDEX.md` into the system prompt, exposes only `get-page`
   - **GitFS** (`layer/modules/assistant/runtime/server/utils/gitfs-bash.ts`) — mounts docs at `/repo` and gives the model a `bash` tool
4. **Provider resolution + streaming** in `layer/modules/assistant/runtime/server`

Both backends scope retrieval to the current KB and locale, derived from the request referer. Answers are supposed to come from the docs, not generic model memory. The system prompt explicitly tells the model to use documentation tools for substantive questions.

## Request Flow

```text
                              Assistant Request Flow
┌──────────────────────────────────────────────────────────────────────────────┐
│ AskAiButton / FloatingInput / Explain with AI                                │
└───────────────┬──────────────────────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ useAssistant() + AssistantPanel.vue                                          │
│ @ai-sdk/vue Chat + DefaultChatTransport                                      │
└───────────────┬──────────────────────────────────────────────────────────────┘
                │ POST /__tockdocs__/assistant
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ runtime/server/api/search.ts                                                 │
│ scope from referer · provider/model resolution · backend fork                │
└───────────┬──────────────────────────────────────┬───────────────────────────┘
            │ ASSISTANT_FS_BACKEND=mcp             │ ASSISTANT_FS_BACKEND=index
            ▼                                      ▼
┌─────────────────────────────────┐  ┌─────────────────────────────────────────┐
│ MCP Client Bootstrap            │  │ Fetch INDEX.md for Scope                │
│ search-pages · list-pages       │  │ inject into system prompt               │
│ · get-page                      │  │ Expose Only get-page                    │
└───────────────┬─────────────────┘  └───────────────┬─────────────────────────┘
                │                                    │
                │ scoped to kb/locale                │ scan index in prompt
                ▼                                    ▼
┌─────────────────────────────────┐  ┌─────────────────────────────────────────┐
│ Nuxt Content + /source md       │  │ get-page (Single Call)                  │
│ + hybrid FlexSearch/Fuse        │  │ reads full markdown from /source        │
└───────────────┬─────────────────┘  └───────────────┬─────────────────────────┘
                │                                    │
                ├────────────────────────────────────┤
                │       ASSISTANT_FS_BACKEND=gitfs   │
                ▼                                    │
┌─────────────────────────────────────────┐          │
│ GitFS + just-bash Init                  │          │
│ mount docs/content/<kb>/<locale>        │          │
│ at /repo                                │          │
└───────────────┬─────────────────────────┘          │
                │ scoped by mount root               │
                ▼                                    │
┌─────────────────────────────────────────┐          │
│ bash tool: rg, find, ls, cat            │          │
│ raw filesystem exploration              │          │
└───────────────┬─────────────────────────┘          │
                │                                    │
                └──────────────┬─────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ streamText() — same model, same streaming transport, same stop logic         │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ UI stream → AssistantLoading · MDCCached · AssistantPreStream                │
└──────────────────────────────────────────────────────────────────────────────┘
```

## UI Wiring and Shared State

### Entry Points in the Layer Shell

The current layer shell uses these assistant entrypoints:

- **Header trigger** — `AskAiButton.vue`: toggles the panel without forcing a new prompt.
- **Floating prompt** — `AssistantFloatingInput.vue`: sends `open(message, true)` for a fresh question.
- **Right-sidebar action** — `DocsAsideRightBottom.vue`: opens the panel with `Explain the page <route.path>`, clearing prior chat.
- **Main chat surface** — `AssistantPanel.vue`: docked desktop panel or mobile `USlideover`.

`layer/app/app.vue` mounts `LazyAssistantPanel` and `LazyAssistantFloatingInput` inside `ClientOnly` when `useAssistant().isEnabled` is true. It also shifts the main app shell right by the docked panel width so the desktop sidebar does not overlap the page.

`AssistantChat.vue` still exists as a reusable generic trigger component, but the layer header currently uses `AskAiButton` instead.

`layer/modules/assistant/index.ts` is the module entrypoint responsible for:

- enable / disable detection
- public runtime config (`runtimeConfig.public.assistant`)
- assistant-specific component registration
- the assistant API route (`apiPath`, default `/__tockdocs__/assistant`)

When the assistant is disabled, registered assistant components resolve to `AssistantChatDisabled.vue`, and the layer shell also avoids mounting the panel / floating input.

### `useAssistant()`

`layer/modules/assistant/runtime/composables/useAssistant.ts` holds shared assistant state with `useState()`:

- `isOpen`
- `isResizing`
- `desktopWidth`
- `messages`
- `pendingMessage`
- `faqQuestions`
- `isHydrated`

Important behavior:

- chat state survives navigation **within the same KB / locale**
- chat is cleared automatically when the active KB or locale changes
- `shouldPushContent` tells the app shell to shift the page right when the desktop assistant is docked
- `toggleExpanded()` switches the desktop width between compact (`352px`) and expanded (`520px`)
- desktop width is clamped between `320px` and `520px`

## Server Request Handling and Streaming

### End-to-End Request Handling

`layer/modules/assistant/runtime/server/api/search.ts` handles the assistant endpoint.

For each request it:

1. rejects non-`POST` requests
2. rejects cross-origin browser requests from the `Origin` / `Sec-Fetch-Site` headers
3. enforces request-size and message-shape limits before provider or retrieval work starts
4. rate-limits requests by client IP and returns `Retry-After` on `429`
5. resolves KB / locale scope from a same-origin `referer`, falling back to validated `X-TockDocs-KB` / `X-TockDocs-Locale` headers
6. resolves the provider + model via `getAssistantProviderConfig()`
7. determines the active backend from `ASSISTANT_FS_BACKEND` (default `mcp`)
8. **INDEX path:** fetches `INDEX.md` for the scoped KB/locale, estimates tokens, injects it into the system prompt. Falls back to MCP when the index is missing, fails to load, or exceeds the 8K token budget.
9. **MCP path:** appends `kb` / `locale` query params to the MCP transport URL and loads tools with a `30s` connect timeout
10. **GitFS path:** initializes GitFS + just-bash, mounts the scoped docs root at `/repo`, and exposes a single `bash` tool
11. runs `streamText()` with the backend-specific tool set and system prompt, returns `createUIMessageStreamResponse()`
12. cleans up resources (MCP client close or workspace directory removal) and logs duration / tool counts on finish

Scope fallback behavior:

- KB mode requires a valid KB scope from either the same-origin referer or validated headers; missing or invalid KB scope returns `400` before retrieval.
- Legacy mode falls back to the default locale when no usable referer or locale header exists.
- GitFS in KB mode requires both KB and locale scope and mounts only `docs/content/<kb>/<locale>`.

### System Prompt

Three KB-aware prompts live in `layer/modules/assistant/runtime/server/utils/system-prompt.ts`:

- `getMcpSystemPrompt()` — instructions for `search-pages`, `list-pages`, `get-page`
- `getIndexSystemPrompt()` — injects the `INDEX.md` content and instructs the model to scan it and call `get-page` with matching URLs
- `getGitFsSystemPrompt()` — instructions for the `bash` tool (`rg`, `find`, `ls`, `cat`)

All three share the same identity, formatting, and response-style rules from `getIdentitySection()` and `getSharedPromptTail()`.

Shared rules:

- identity comes from `assistantName`, then `kb.title`, then the fallback name `${siteName} Assistant`
- never use first person (`I`, `me`, `my`)
- use a documentation tool before answering substantive docs questions
- never use markdown headings
- simple greetings or UI/meta questions can be answered without tools

MCP-specific:

- use `search-pages` first, retry with shorter keywords
- use `list-pages` for browsing, `get-page` for full context
- prefer URLs returned by tools

GitFS-specific:

- start with `rg "keyword" /repo`
- always `cat` the full file before answering
- cite filesystem paths (not public URLs)
- `/repo` is read-only

## Retrieval Backends

### MCP (default)

`layer/server/mcp/tools/` exposes three read-only tools, each cached for **1 hour**:

- **`search-pages`** — Searches titles, descriptions, headings, path tokens, and body text.
- **`list-pages`** — Returns a flat list of page metadata (`title`, `path`, `description`, `url`) across scoped collections.
- **`get-page`** — Returns full original markdown + metadata for an exact routed path.

**Scope enforcement:**

- `getScopedKnowledgeBaseAndLocale()` normalizes explicit tool args, transport query params, and malformed model input
- `isPathWithinDocsScope()` (in `layer/server/utils/content.ts`) prevents `get-page` from fetching paths outside the active KB/locale
- Scope is logged through `[tockdocs-mcp-scope]`

### INDEX (Opt-In)

When `ASSISTANT_FS_BACKEND=index`, the assistant:

1. Resolves the scoped KB/locale from the request
2. Fetches a pre-built `INDEX.md` (or generates it on demand in dev) via `GET /__tockdocs__/index/<kb>/<locale>.md`
3. Estimates the token count; if over 8K tokens, falls back to MCP
4. Connects to the MCP server and filters tools to **only `get-page`**
5. Injects the `INDEX.md` into the system prompt via `getIndexSystemPrompt()`

**Index format:**

```markdown
# Knowledge Base: Chemistry (zh)

- [Page Title](/docs/chemistry/zh/topic/page.md)
  Summary: One-paragraph description of what this page covers.
```

The index is generated per KB × locale at build time by `layer/modules/index-generator.ts`. Each entry includes the page title, a `.md` alias URL, and the `description` frontmatter field as a summary. Pages without a `description` show only the title and URL.

**Key properties:**

- Uses existing `description` frontmatter — no new fields needed
- Indexed in Nuxt Content collection order
- `.navigation` pseudo-pages are excluded
- Dev mode: generated on first request, cached in memory (10s TTL dev, 60s prod)
- Production: pre-built assets in `.data/index/` shipped as Nitro server assets

### GitFS (Opt-In)

When `ASSISTANT_FS_BACKEND=gitfs`, the assistant mounts `docs/content/<kb>/<locale>` at `/repo` via `@taowang1993/gitfs` + `just-bash` and exposes a single `bash` tool:

- `rg`, `find`, `ls` — discover pages
- `cat` — read full content
- `grep -r` — recursive search

**Scope enforcement and resource bounds:**

- the mount root is the KB/locale subtree, so the model cannot `ls` or `cat` outside it
- parent-directory traversal and absolute paths outside `/repo` or `/workspace` are blocked in `validateGitFsCommand()`
- eager blob prefetch is capped to 80 files and 8 concurrent reads by default
- a `PersistentGitFsCache` in `/tmp/gitfs-cache` keeps warm invocations fast

### Source Markdown Pipeline

The assistant retrieves **original markdown**, not rendered HTML.

- `search-pages` and `get-page` fetch source content through `/source<path>.<ext>`
- `/raw<path>.<ext>` remains available as a proxy alias to `/source...`
- user-facing tool results point to canonical `.md` alias URLs such as `/docs/manual/en/getting-started.md`

That means the model reads the real authoring source while users receive stable, markdown-friendly links.

### Search Pipeline (MCP)

`layer/server/utils/docs-search.ts` builds an in-memory search index from Nuxt Content pages plus original markdown fetched through `/source<path>.<extension>`.

Retrieval pipeline:

1. **FlexSearch** primary pass
2. **Fuse.js** fallback when FlexSearch is weak
3. **Lenient Fuse** retry when zero results remain
4. **Script-only retry** for mixed Latin + CJK-style queries

Other important details:

- the cache is **scope-aware** (KB / locale) rather than one giant global index
- cache TTL is **60s in prod** and **10s in dev**
- `.navigation` pseudo-pages are excluded from indexing
- scoring heavily favors `title` and `headings` over body text
- excerpts are generated from raw markdown, centered around the first matched query term

## Provider Resolution

Supported providers:

- `vercel`
- `openrouter`
- `deepseek`
- `nvidia`
- `huggingface`
- `groq`
- `github`
- `gemini`
- `cloudflare`

Each provider maps to a default model — see `.env.example` for the current list.

### Auto-Detection Order

When `AI_PROVIDER` is unset, the server picks the first configured provider in this order:

1. Vercel
2. OpenRouter
3. DeepSeek
4. NVIDIA
5. Hugging Face
6. Groq
7. GitHub
8. Gemini
9. Cloudflare

Overrides:

- `AI_PROVIDER` forces the provider
- `AI_MODEL` or `tockdocs.assistant.model` forces the model

Backend mapping:

- **Vercel** → `@ai-sdk/gateway`
- **Gemini** → `@ai-sdk/google`
- **All others** → `@ai-sdk/openai-compatible`

OpenRouter adds `HTTP-Referer` and `X-Title` headers when the configured site URL is HTTPS.

## Operational Notes

- Assistant UI is always enabled in dev. In production, it requires credentials or `NUXT_PUBLIC_ASSISTANT_ENABLED=true`. Without a configured provider, the endpoint returns `503`.
- Assistant state is scoped to the active KB/locale, not shared globally.
- Request guardrails are configured with `ASSISTANT_RATE_LIMIT_MAX_REQUESTS`, `ASSISTANT_RATE_LIMIT_WINDOW_MS`, `ASSISTANT_MAX_BODY_BYTES`, `ASSISTANT_MAX_MESSAGES`, `ASSISTANT_MAX_MESSAGE_TEXT_CHARS`, and `ASSISTANT_MAX_TOTAL_TEXT_CHARS`.
- The `toolCallCount` in logs reveals the retrieval path: `0` = greeting/meta, `1` = index scan or MCP excerpt answer, `2` = MCP search + fetch, `3+` = retries.
- Log prefixes: `[tockdocs-assistant]` (request lifecycle), `[tockdocs-docs-search]` (search), `[tockdocs-mcp-scope]` (scope resolution).
