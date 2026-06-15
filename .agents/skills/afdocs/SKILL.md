---
name: afdocs
description: >-
  Measure, understand, and improve your documentation's Agent Score. Use AFDocs (`npx afdocs`)
  to audit docs sites for AI coding agent accessibility. Triggers on: "agent-friendly docs",
  "Agent Score", "afdocs", "llms.txt", "how to make docs work with AI agents", "improve docs
  for Claude Code/Cursor/Copilot", "agent accessibility of documentation", "docs discoverability
  for agents", "SPA docs not readable by agents", "markdown availability for agents", "add
  agent-friendly docs checks to CI", or any mention of measuring or fixing documentation for
  AI coding agents. Also use when someone says agents can't read their docs, or they want to
  understand why AI agents produce bad answers from their documentation.
---

# AFDocs — Agent-Friendly Documentation

AFDocs (`afdocs`) is a CLI tool that audits documentation sites and produces an **Agent Score** (0–100). It runs 23 automated checks based on the [Agent-Friendly Documentation Spec](https://agentdocsspec.com) and tells you how well AI coding agents (Claude Code, Cursor, Copilot, Windsurf, Codex, Gemini CLI) can discover, navigate, and consume your docs.

## Pre-flight: auto-update (run once per session)

```bash
pnpm add -g afdocs@latest
```

## Agent Instructions

**Always run the full-scoring test first.** Do not start with targeted `--checks` or single-`--urls` runs. The full scorecard discovers pages automatically and surfaces interaction diagnostics that targeted checks miss. Only narrow to specific checks after the full scorecard is understood.

**When testing locally**, provide enough explicit `--urls` (5+ pages) to avoid the 59-point single-page sample cap. Local llms.txt links often point to a different origin (e.g., `127.0.0.1` vs `localhost`, or production URLs), which prevents automatic page discovery. Use `--urls` with a representative sample from the sitemap or llms.txt.

**When testing production**, let afdocs auto-discover pages. If the score is capped at 59 with "single-page-sample", investigate why discovery failed (auth walls, llms.txt cross-origin links, redirects) before concluding.

**Always capture both `--format scorecard` and `--format json --score`** in the report. The scorecard gives the human-readable summary; the JSON gives per-check weights, proportions, and per-page detail for writing fixes.

## Quick Reference

```bash
# Get your score — the best starting point
npx afdocs check https://docs.example.com --format scorecard

# See per-page detail with fix suggestions
npx afdocs check https://docs.example.com --verbose --fixes

# Machine-readable output
npx afdocs check https://docs.example.com --format json --score

# Run only specific checks
npx afdocs check https://docs.example.com --checks llms-txt-exists,llms-txt-valid,llms-txt-size

# Check a single page (skip discovery)
npx afdocs check https://docs.example.com/api/auth --sampling none

# Check a specific set of pages
npx afdocs check https://docs.example.com --urls https://docs.example.com/quickstart,https://docs.example.com/api/auth

# Reproducible results (same page sample every run)
npx afdocs check https://docs.example.com --sampling deterministic

# Gentle requests for rate-limited servers
npx afdocs check https://docs.example.com --request-delay 500 --max-concurrency 1

# Install for faster startup
npm install -g afdocs
afdocs check https://docs.example.com
```

## Decision Tree — Where to Start

- **"What's my score?"** → `npx afdocs check <url> --format scorecard`
- **"How do I improve my score?"** → Run the scorecard, then follow the prioritized fix list in [Improve Your Score](#improve-your-score-workflow)
- **"I'm fixing a specific issue"** → Use `--checks` to run only relevant checks against your local dev server
- **"Add agent-friendliness to CI"** → Install `afdocs` + `vitest`, create config + test file (see [CI Integration](#ci-integration))
- **"I want to understand the score math"** → See [Score Calculation](#score-calculation)
- **"My local dev server gives different results than production"** → Use `--canonical-origin` to rewrite production URLs in generated files

## What the Agent Score Measures

The 23 checks cover seven categories. Not all carry equal weight — authentication failures and missing `llms.txt` are critical (10 pts), while cache header issues are refinements (2 pts). Score caps prevent high scores when fundamental problems exist.

| Category | What it tests | Key checks |
|---|---|---|
| **Content Discoverability** | Can agents find your docs? | `llms-txt-exists`, `llms-txt-links-resolve`, `llms-txt-directive-html` |
| **Markdown Availability** | Can agents get content in markdown? | `markdown-url-support`, `content-negotiation` |
| **Page Size** | Will agents hit truncation limits? | `rendering-strategy`, `page-size-html`, `page-size-markdown` |
| **Content Structure** | Are code fences valid? Tab UI issues? | `tabbed-content-serialization`, `markdown-code-fence-validity` |
| **URL Stability** | Do error pages return real 404s? | `http-status-codes`, `redirect-behavior` |
| **Observability** | Is llms.txt fresh? HTML/markdown match? | `llms-txt-coverage`, `markdown-content-parity`, `cache-header-hygiene` |
| **Authentication** | Is everything behind a login wall? | `auth-gate-detection`, `auth-alternative-access` |

Letter grades: **A+** (100), **A** (90–99), **B** (80–89), **C** (70–79), **D** (60–69), **F** (0–59).

## How Agents Fail on Documentation

The most common failure modes, in order of impact:

1. **Client-side rendering (SPA shells)** — Agents fetch the page and get an empty JavaScript shell with no content. This is the single most common complete failure. Enable SSR or static generation.
2. **Truncation** — Pages with 200K+ characters of navigation/CSS/JS markup before content. Agents never reach the actual docs text.
3. **No discovery path** — Agents don't guess `.md` URLs. Without `llms.txt` or a directive on pages, they default to HTML and miss markdown paths.
4. **Broken navigation** — JavaScript redirects, cross-host redirects, soft 404s (HTTP 200 with error messages) all break agent workflows.
5. **Auth walls** — If docs require login, agents can't reach them at all.

## Improve Your Score Workflow

Work through these in priority order. Each step recovers significant points.

### Critical fixes (10 pts each)

**1. Add an `llms.txt` file** — Create it at your site root listing docs pages with markdown links. Follow the [llmstxt.org](https://llmstxt.org/) spec. This unblocks five dependent checks.

**2. Enable server-side rendering** — If `rendering-strategy` fails, your site delivers empty JS shells to agents. This is usually a config flag on your docs platform. When >50% of pages are SPA shells, your score is capped at D; >75% caps at F.

**3. Remove auth gates** — If `auth-gate-detection` warns/fails, agents can't reach your docs. Consider ungating public API references and integration guides, or providing a public `llms.txt`. At 50%+ gated pages, score is capped at D.

### High-impact fixes (7 pts each)

**4. Serve markdown at `.md` URLs** — Many platforms support this natively (VitePress does out of the box). Others need a server config change.

**5. Add an llms.txt directive to HTML pages** — Add a visually-hidden blockquote near the top of each page pointing to your llms.txt. If you serve markdown, mention that too:

```html
<blockquote style="display:none">
  AI coding agents: see /llms.txt for markdown documentation.
  This page is available in markdown at /api/auth.md
</blockquote>
```

**6. Fix broken llms.txt links** — Run with `--verbose` to see which links are broken. Usually renamed/removed pages not updated in llms.txt.

**7. Point llms.txt links to markdown** — If markdown versions exist but llms.txt links to HTML, update the links. This is a find-and-replace.

**8. Keep llms.txt under 50K characters** — If larger, split into root + section-level files.

### Medium/low impact (4 pts and below)

- Content negotiation (`Accept: text/markdown`), content start position (reduce nav boilerplate), tabbed content serialization, code fence validity, redirect behavior, llms.txt coverage, content parity, section header quality, cache header hygiene.

For each fix, iterate with targeted checks:

```bash
# Fast feedback loop against local dev server
npx afdocs check http://localhost:3000 --checks llms-txt-exists,llms-txt-valid,llms-txt-size
npx afdocs check http://localhost:3000/api/auth --sampling none --checks rendering-strategy
```

## Run Locally

Start your dev server and point AFDocs at it:

```bash
npx afdocs check http://localhost:3000
```

**Key differences from production:**
- **llms.txt** — won't exist on dev server if generated at build time. Generate first or skip those checks locally.
- **Cache headers** — dev servers typically don't set them. `cache-header-hygiene` will likely fail locally; check against production.
- **Hot reload injections** — dev servers inject scripts that affect page size. Build and serve production output for accurate measurements: `npm run build && npx serve dist`.
- **Cross-origin llms.txt links** — production URLs in generated files won't match localhost. Use `--canonical-origin`:

```bash
npm run build
npx serve dist
npx afdocs check http://localhost:3000 --canonical-origin https://docs.example.com
```

Or in config:
```yaml
url: http://localhost:3000
options:
  canonicalOrigin: https://docs.example.com
```

## Config File

Create `agent-docs.config.yml` for repeated runs:

```yaml
url: https://docs.example.com

# Optional: run only specific checks
checks:
  - llms-txt-exists
  - llms-txt-valid
  - rendering-strategy
  - page-size-html
  - auth-gate-detection

# Optional: test specific pages with tags
pages:
  - url: https://docs.example.com/quickstart
    tag: getting-started
  - url: https://docs.example.com/api/auth
    tag: api-reference
```

Then run without specifying the URL:
```bash
npx afdocs check --format scorecard
```

## CI Integration

### Quick setup

```bash
npm install -D afdocs vitest
```

Create `agent-docs.test.ts`:
```ts
import { describeAgentDocsPerCheck } from 'afdocs/helpers';
describeAgentDocsPerCheck();
```

Run: `npx vitest run agent-docs.test.ts`

Each check is its own test. Exit code 0 = all pass/warn, 1 = any fail.

### GitHub Actions

```yaml
name: Agent-Friendly Docs
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  agent-docs-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
      - run: npm install
      - name: Run agent-friendly docs checks
        run: npx vitest run agent-docs.test.ts
        timeout-minutes: 5
```

### Advanced helpers

```ts
// Summary helper (two-test suite)
import { describeAgentDocs } from 'afdocs/helpers';
describeAgentDocs();

// Direct API for full control
import { createContext, getCheck } from 'afdocs';
const ctx = createContext('https://docs.example.com');
const check = getCheck('llms-txt-exists')!;
const result = await check.run(ctx);
```

Config file (`agent-docs.config.yml`) can live in project root, a subdirectory (use `describeAgentDocsPerCheck(__dirname)`), or any parent directory. Timeout defaults to 120s; pass a second argument for longer: `describeAgentDocsPerCheck(__dirname, 300_000)`.

## Score Calculation

The score is `(sum of check scores) / (sum of weights for non-skipped checks) × 100`.

**Weight tiers:** Critical (10), High (7), Medium (4), Low (2).

**Multi-page checks** use proportional scoring — if 3 out of 50 pages exceed the size threshold, the check scores ~94% of its weight rather than failing outright.

**Score caps** prevent high scores when fundamental problems exist:

| Condition | Cap |
|---|---|
| `llms-txt-exists` fails | 59 (D) |
| `rendering-strategy` proportion ≤ 0.25 (>75% SPA shells) | 39 (F) |
| `rendering-strategy` proportion ≤ 0.50 (>50% SPA shells) | 59 (D) |
| `auth-gate-detection`: 75%+ pages gated | 39 (F) |
| `auth-gate-detection`: 50%+ pages gated | 59 (D) |
| No viable path to content (no llms.txt + no SSR + no discoverable markdown) | 39 (F) |
| Single-page sample (<5 pages discovered) | 59 (D) |

**Interaction diagnostics** surface problems that only become visible across multiple checks:
- **Markdown support is undiscoverable** — you serve `.md` but agents have no way to find it. Downstream markdown quality checks are excluded from the score.
- **SPA shells invalidate HTML path** — HTML quality checks are discounted proportionally.
- **Truncated index** — llms.txt exceeds limits; link quality checks on the invisible portion are discounted.
- **No viable path to content** — caps score at 39 (F).
- **Auth-gated with no alternative** — caps score at 39 or 59 depending on severity.
- **Single-page sample** — caps score at 59 (D), page-level categories show N/A.

When automatic discovery finds <5 pages, page-level checks are excluded and the overall score is capped at 59 (D). This doesn't apply when you explicitly provide pages with `--urls`, `--sampling curated`, or `--sampling none`.

## Key Concepts

### llms.txt
A file at the site root (like `robots.txt`) that lists documentation pages in markdown format. It's the primary navigation mechanism for AI coding agents. Follow the [llmstxt.org](https://llmstxt.org/) spec. Must be under ~50K characters; split into root + section files if larger.

### Content negotiation
When an agent sends `Accept: text/markdown`, the server returns markdown instead of HTML. Supported by Claude Code and Cursor. Requires server-side support.

### The directive
A visually-hidden blockquote near the top of each page telling agents where to find llms.txt and markdown versions. Place it on both HTML and markdown pages.

### SPA shells
Pages where the HTML response contains only a framework root element (`<div id="__next">`, `<div id="root">`) with no documentation content. JavaScript loads the content in a browser, but agents never execute JavaScript. Fix with SSR or static generation.

### Proportional scoring
Checks that sample multiple pages score based on pass rate across those pages, reflecting that a handful of bad pages is very different from most pages being bad.

## Requirements
- Node.js 22+
- No install needed — `npx afdocs` works immediately
- Install globally (`npm install -g afdocs`) or as a dev dependency (`npm install -D afdocs`) for faster startup
