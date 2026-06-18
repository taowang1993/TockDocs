type ContentBody = {
  value?: unknown
  children?: unknown
  toc?: {
    links?: TocLink[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

type ContentPage = {
  title?: unknown
  body?: ContentBody | null
  [key: string]: unknown
}

type TocLink = {
  text?: unknown
  children?: TocLink[]
  [key: string]: unknown
}

const headingTagPattern = /^h[1-6]$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHeadingTag(value: unknown): value is string {
  return typeof value === 'string' && headingTagPattern.test(value)
}

function collectText(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    if (typeof value[0] === 'string') {
      const contentStart = isRecord(value[1]) ? 2 : 1
      return value.slice(contentStart).map(collectText).join('')
    }

    return value.map(collectText).join('')
  }

  if (isRecord(value)) {
    if (typeof value.value === 'string' || typeof value.value === 'number') {
      return String(value.value)
    }

    if (typeof value.text === 'string' || typeof value.text === 'number') {
      return String(value.text)
    }

    if (Array.isArray(value.children)) {
      return value.children.map(collectText).join('')
    }
  }

  return ''
}

function normalizeTitleLikeText(value: unknown): string {
  return collectText(value)
    .normalize('NFKC')
    .trim()
    .replace(/^0*(\d+)[.)、:：．]?\s*/u, '$1 ')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase()
}

function isTitleHeading(node: unknown, normalizedTitle: string): boolean {
  if (!normalizedTitle) {
    return false
  }

  if (Array.isArray(node)) {
    return isHeadingTag(node[0]) && normalizeTitleLikeText(node) === normalizedTitle
  }

  if (!isRecord(node)) {
    return false
  }

  const tag = node.tag || node.tagName
  if (isHeadingTag(tag)) {
    return normalizeTitleLikeText(node) === normalizedTitle
  }

  if (node.type === 'heading' && typeof node.depth === 'number') {
    return node.depth >= 1 && node.depth <= 6 && normalizeTitleLikeText(node) === normalizedTitle
  }

  return false
}

function withoutFirstTitleTocLink(links: TocLink[] | undefined, normalizedTitle: string): TocLink[] | undefined {
  if (!Array.isArray(links) || !normalizedTitle) {
    return links
  }

  let removed = false

  const cloneLinks = (items: TocLink[]): TocLink[] => {
    return items.map((link) => {
      const children = Array.isArray(link.children) ? cloneLinks(link.children) : link.children
      return children === link.children ? { ...link } : { ...link, children }
    })
  }

  const visit = (items: TocLink[]): TocLink[] => {
    return items.flatMap((link) => {
      if (!removed && normalizeTitleLikeText(link.text) === normalizedTitle) {
        removed = true
        return Array.isArray(link.children) ? cloneLinks(link.children) : []
      }

      if (!Array.isArray(link.children)) {
        return [{ ...link }]
      }

      return [{ ...link, children: visit(link.children) }]
    })
  }

  return visit(links)
}

/**
 * Nuxt Content pages can carry both a frontmatter title and a leading markdown
 * title heading. TockDocs renders the frontmatter title in UPageHeader, so drop
 * only a matching first body heading to avoid showing the same page title twice.
 */
export function withoutDuplicateTitleHeading<T>(page: T): T {
  const contentPage = page as ContentPage | null | undefined

  if (!contentPage?.body) {
    return page
  }

  const normalizedTitle = normalizeTitleLikeText(contentPage.title)
  if (!normalizedTitle) {
    return page
  }

  const { body } = contentPage

  if (Array.isArray(body.value) && body.value.length > 0 && isTitleHeading(body.value[0], normalizedTitle)) {
    return {
      ...contentPage,
      body: {
        ...body,
        value: body.value.slice(1),
        toc: body.toc
          ? {
              ...body.toc,
              links: withoutFirstTitleTocLink(body.toc.links, normalizedTitle),
            }
          : body.toc,
      },
    } as T
  }

  if (Array.isArray(body.children) && body.children.length > 0 && isTitleHeading(body.children[0], normalizedTitle)) {
    return {
      ...contentPage,
      body: {
        ...body,
        children: body.children.slice(1),
        toc: body.toc
          ? {
              ...body.toc,
              links: withoutFirstTitleTocLink(body.toc.links, normalizedTitle),
            }
          : body.toc,
      },
    } as T
  }

  return page
}
