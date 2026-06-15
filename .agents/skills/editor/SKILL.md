---
name: editor
description: TockDocs knowledge-base editing and migration workflow. Use when porting a source KB into the docs/content tree, editing markdown/frontmatter/navigation, rewriting links or assets, or validating MDC with source-level lint to avoid malformed pages.
---

# Editor

## Goal

Create or migrate TockDocs content **without malformed MDC** while preserving source meaning, route correctness, and navigation order.

## Read first

1. Read `.agents/reference/architecture.md` from the repository root.
2. Read [`references/kb-workflow.md`](references/kb-workflow.md).
3. Read [`references/mdc-safety.md`](references/mdc-safety.md) before touching frontmatter, component fences, slots, or embedded assets.
4. Inspect at least one nearby page in the same KB section and locale before editing so you copy the local conventions instead of inventing new ones.

## Pre-flight audit

Before making substantive edits, spot-check these quality signals so you catch problems that the source linter won't:

- **Titles** should be 50–60 characters and unique across the KB.
- **Descriptions** should be 120–160 characters and descriptive, not formulaic.
- **Description frontmatter must be plain text**: no Markdown links, tables, bullets, code, bold markup, raw HTML, MDC, or copied body excerpts. The description renders directly under the page title and rich Markdown leaks into the UI as text.
- **Headings** should use a single H1, a logical H2 → H3 hierarchy, and action verbs for guide pages ("Configure X", not "Configuration").
- **Sections** should contain 2–15 pages. If a section has one page, merge it; if it has 20+, split it.
- **i18n parity** — every locale folder under the same KB must have the same directory names, the same `.navigation.yml` icons, and roughly matching file counts.

## Non-negotiable workflow

1. Work **one file at a time**.
2. Keep content **Markdown-first**. Only introduce MDC when plain Markdown cannot express the intended result.
3. **Never use raw HTML in content files.** Raw HTML (`<img>`, `<table>`, `<br>`, `<div>`, `<sub>`, `<sup>`, etc.) breaks Nuxt Studio's TipTap visual editor, leaving the editor pane blank. Use Markdown equivalents (`![]()`, Markdown tables, blank lines) or MDC components instead. See [`references/raw-html-prohibition.md`](references/raw-html-prohibition.md) for the full rule and migration guide.
4. Add **one new MDC construct at a time**: one frontmatter block, one component fence, one slot section, one nested component, or one embedded asset pattern.
5. Immediately run:

   ```bash
   pnpm run check:mdc-source <touched-file>
   ```

5. If lint fails, **stop** and repair that file before touching anything else.
6. If the change affects routing, collections, OG assets, or rendered output, also run:

   ```bash
   pnpm run check:content-integrity
   pnpm run typecheck
   ```

7. Re-read the final raw Markdown source before finishing. Do not trust the rendered preview alone.

## Porting workflow

### 1. Map the destination first

- Identify the target KB id and locale set.
- Find `docs/content/<kb>/kb.yml` and the matching `docs/content/<kb>/<locale>/` folders.
- Inspect sibling pages and `.navigation.yml` files before adding, moving, or renaming anything.
- Keep section titles, file names, and numeric ordering aligned with the destination tree.

### 2. Port one page at a time

- Preserve headings, code fences, and meaning first.
- Rewrite internal links, image paths, and cross-references to the TockDocs route structure.
- If a page moves between sections, update navigation metadata and any links that still point to the old path.
- Prefer adapting an existing valid page pattern over inventing fresh MDC syntax.

### 3. Update metadata deliberately

- Keep page frontmatter valid and minimal.
- Use `title`, `description`, `seo`, and `navigation` only when they materially improve the page.
- Write `description` as one concise plain-text sentence. Do not paste the first paragraph, list, table, linked text, or Markdown-formatted summary into frontmatter.
- Keep `navigation.position`, folder ordering, and visible sidebar order consistent.
- Update `kb.yml` when the KB id, locales, entry page, or assistant metadata changes.

### 4. Keep locales in sync

- When you add, rename, or remove a page in one locale, mirror the change in every other locale folder under the same KB.
- If a page is not yet translated, create a stub with matching frontmatter and a note that translation is pending — mismatched directory structures break navigation and cause 404s.
- Check that every `.navigation.yml` across locales has the same `title` (in the appropriate language) and the same `icon`.
- When adding a new locale, update `nuxt.config.ts` i18n.locales, `kb.yml` locales, and `docs/app/app.config.ts` locale-aware configs (e.g., `faqQuestions`). Then run `pnpm run check:i18n` to verify coverage.

### 5. Optimize assets for serverless deployment

Before finalizing a KB port, read `.agents/reference/deploy.md` and apply the relevant guidelines to the KB's assets:

- **Convert raster images to WebP** at build time with `cwebp -q 90`. Remove source PNG/JPG files after conversion. Update all `.md` references from `.png`/`.jpg` → `.webp`.
- **Keep SVGs as-is** — they are already small and compression-friendly.
- **Flag images >300KB** before conversion. If a single image exceeds 200KB after WebP conversion, warn the user and suggest splitting or further compression.
- **No images in prerendered OG routes** — use `defineOgImage` with the built-in templates, not raster screenshots.
- **Do not use `<NuxtImg>` or `<NuxtPicture>` for KB content images** — plain `<img>` tags avoid per-image billing on image optimization services.
- If the KB has many images (>50), recommend hosting them on object storage instead of `public/` to keep CDN bandwidth costs predictable.

## MDC authoring guardrails

- All Nuxt UI components in MDC **must** use the `u-` prefix. Write `::u-page-hero`, `:::u-button`, `::::u-page-card` — never `::page-hero`, `:::button`, `::::page-card`. Without the `u-` prefix, Vue fails to resolve the component and the page renders silently broken.
- Keep page frontmatter balanced and only at the top of the file.
- Keep component fence depth matched (`::`, `:::`, `::::`, etc.).
- Do **not** insert a blank line between a component opener and its component frontmatter.
- Keep slot markers like `#title`, `#description`, `#header`, `#footer`, `#default`, and `#code` **inside** a component fence.
- Never prefix component fences or slot markers with heading markers like `#`, `##`, or `###`.
- Never leave empty headings like `###` behind after editing.
- Never leave escaped component fences (`\::`) or escaped `_blank` targets in prose.
- Nuxt Content components (`::code-group`, `::steps`, `::note`, `::tip`, `::warning`, `::caution`) do **not** need the `u-` prefix. Only Nuxt UI components (`u-page-hero`, `u-button`, `u-badge`, `u-color-mode-image`, etc.) require it.
- Do not append admonition shorthand to list items.
- When showing MDC syntax as source, use fenced code blocks. Do **not** paste live `::component` syntax into prose unless you want it rendered.
- When a literal example itself contains fenced code or component syntax, wrap it in an outer ````mdc fence (or longer) so the example stays literal.
- Keep Mermaid as a top-level fenced block unless a specific component is explicitly required.
- For generated OG routes like `/_og/...`, use `:site-image` or plain `<img>`, not `NuxtImg`.

## Finish checklist

- Re-read the changed pages in raw source.
- Re-run targeted MDC source lint.
- Fix every lint failure before moving on.
- Run `pnpm run check:i18n` — verify no locale keys are missing, especially after adding/changing locales or locale-aware configs.
- Run `pnpm run check:translation-parity` — verify heading hierarchy, component order, and code block counts match the reference locale (en).
- Verify SEO metadata: titles ≤60 chars, descriptions 120–160 chars, unique across the KB.
- Verify heading quality: single H1, action-based H2s on guide pages, no skipped levels.
- Confirm `kb.yml`, localized paths, navigation metadata, and links still match the public `/docs/<kb>/<locale>/...` routes.
- Prefer small, reviewable batches over large mixed edits.
