import {
  getDefaultLocale,
  getDocsMode,
  getFilteredLocaleCodes,
  getKnowledgeBases,
  resolveDocsRoute,
  resolveKnowledgeBaseLocale,
  type TockDocsPublicRuntimeConfig,
} from '../../../../../utils/docs'

export type AssistantGuardFailure = {
  ok: false
  statusCode: number
  statusMessage: string
}

export type AssistantGuardSuccess<T extends Record<string, unknown> = Record<never, never>> = { ok: true } & T

export type AssistantGuardResult<T extends Record<string, unknown> = Record<never, never>> = AssistantGuardSuccess<T> | AssistantGuardFailure

export type AssistantScope = {
  mode: 'legacy' | 'kb'
  kb?: string
  locale?: string
  scopeLabel?: string
}

export type AssistantRequestBody = {
  messages: unknown[]
}

export type AssistantRequestLimits = {
  maxBodyBytes: number
  maxMessages: number
  maxMessageTextChars: number
  maxTotalTextChars: number
}

export type AssistantRateLimitOptions = {
  maxRequests: number
  windowMs: number
}

export type AssistantRateLimitBucket = {
  windowStartedAt: number
  count: number
}

export const DEFAULT_ASSISTANT_REQUEST_LIMITS: AssistantRequestLimits = {
  maxBodyBytes: 128 * 1024,
  maxMessages: 20,
  maxMessageTextChars: 8_000,
  maxTotalTextChars: 24_000,
}

export const DEFAULT_ASSISTANT_RATE_LIMIT: AssistantRateLimitOptions = {
  maxRequests: 20,
  windowMs: 60_000,
}

const assistantRateLimitBuckets = new Map<string, AssistantRateLimitBucket>()

function failure(statusCode: number, statusMessage: string): AssistantGuardFailure {
  return { ok: false, statusCode, statusMessage }
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function getAssistantRequestLimits(env: NodeJS.ProcessEnv = process.env): AssistantRequestLimits {
  return {
    maxBodyBytes: parsePositiveInteger(env.ASSISTANT_MAX_BODY_BYTES, DEFAULT_ASSISTANT_REQUEST_LIMITS.maxBodyBytes),
    maxMessages: parsePositiveInteger(env.ASSISTANT_MAX_MESSAGES, DEFAULT_ASSISTANT_REQUEST_LIMITS.maxMessages),
    maxMessageTextChars: parsePositiveInteger(env.ASSISTANT_MAX_MESSAGE_TEXT_CHARS, DEFAULT_ASSISTANT_REQUEST_LIMITS.maxMessageTextChars),
    maxTotalTextChars: parsePositiveInteger(env.ASSISTANT_MAX_TOTAL_TEXT_CHARS, DEFAULT_ASSISTANT_REQUEST_LIMITS.maxTotalTextChars),
  }
}

export function getAssistantRateLimitOptions(env: NodeJS.ProcessEnv = process.env): AssistantRateLimitOptions {
  return {
    maxRequests: parsePositiveInteger(env.ASSISTANT_RATE_LIMIT_MAX_REQUESTS, DEFAULT_ASSISTANT_RATE_LIMIT.maxRequests),
    windowMs: parsePositiveInteger(env.ASSISTANT_RATE_LIMIT_WINDOW_MS, DEFAULT_ASSISTANT_RATE_LIMIT.windowMs),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getUtf8ByteLength(value: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  }
  catch {
    return Number.POSITIVE_INFINITY
  }
}

function getTextFromPart(part: unknown) {
  if (!isRecord(part)) return ''

  if (typeof part.text === 'string') return part.text
  if (typeof part.content === 'string') return part.content

  return ''
}

function getMessageTextLength(message: unknown) {
  if (!isRecord(message)) return 0

  if (typeof message.content === 'string') {
    return message.content.length
  }

  if (Array.isArray(message.content)) {
    return message.content.reduce((total, part) => total + getTextFromPart(part).length, 0)
  }

  if (Array.isArray(message.parts)) {
    return message.parts.reduce((total, part) => total + getTextFromPart(part).length, 0)
  }

  return 0
}

function getMessageRole(message: unknown) {
  return isRecord(message) && typeof message.role === 'string'
    ? message.role
    : ''
}

function isAllowedMessageRole(role: string) {
  return role === 'user' || role === 'assistant' || role === 'system' || role === 'tool'
}

export function validateAssistantRequestBody(
  body: unknown,
  limits: AssistantRequestLimits = DEFAULT_ASSISTANT_REQUEST_LIMITS,
): AssistantGuardResult<{ body: AssistantRequestBody }> {
  const bodyBytes = getUtf8ByteLength(body)
  if (bodyBytes > limits.maxBodyBytes) {
    return failure(413, 'Assistant request body is too large.')
  }

  if (!isRecord(body) || !Array.isArray(body.messages)) {
    return failure(400, 'Assistant request body must include a messages array.')
  }

  if (body.messages.length === 0) {
    return failure(400, 'Assistant request must include at least one message.')
  }

  if (body.messages.length > limits.maxMessages) {
    return failure(400, 'Assistant request includes too many messages.')
  }

  let totalTextChars = 0

  for (const message of body.messages) {
    if (!isRecord(message)) {
      return failure(400, 'Assistant messages must be objects.')
    }

    const role = getMessageRole(message)
    if (!isAllowedMessageRole(role)) {
      return failure(400, 'Assistant message role is invalid.')
    }

    const messageTextChars = getMessageTextLength(message)
    if (messageTextChars > limits.maxMessageTextChars) {
      return failure(413, 'Assistant message is too large.')
    }

    totalTextChars += messageTextChars
  }

  if (totalTextChars > limits.maxTotalTextChars) {
    return failure(413, 'Assistant request text is too large.')
  }

  const lastMessage = body.messages.at(-1)
  if (getMessageRole(lastMessage) !== 'user' || getMessageTextLength(lastMessage) === 0) {
    return failure(400, 'Assistant request must end with a user text message.')
  }

  return {
    ok: true,
    body: { messages: body.messages },
  }
}

export function validateAssistantContentLength(contentLength: string | undefined, maxBodyBytes: number): AssistantGuardResult {
  if (!contentLength) return { ok: true }

  const parsed = Number.parseInt(contentLength, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return failure(400, 'Content-Length header is invalid.')
  }

  if (parsed > maxBodyBytes) {
    return failure(413, 'Assistant request body is too large.')
  }

  return { ok: true }
}

function normalizeOrigin(value: string | undefined) {
  if (!value) return undefined

  try {
    return new URL(value).origin
  }
  catch {
    return undefined
  }
}

export function validateAssistantRequestOrigin({
  requestOrigin,
  origin,
  secFetchSite,
}: {
  requestOrigin: string
  origin?: string
  secFetchSite?: string
}): AssistantGuardResult {
  const normalizedOrigin = normalizeOrigin(origin)

  if (origin && normalizedOrigin !== requestOrigin) {
    return failure(403, 'Cross-origin assistant requests are not allowed.')
  }

  if (secFetchSite?.toLowerCase() === 'cross-site') {
    return failure(403, 'Cross-origin assistant requests are not allowed.')
  }

  return { ok: true }
}

function getRefererPath(referer: string | undefined, requestOrigin: string) {
  if (!referer) return undefined

  try {
    const url = new URL(referer, requestOrigin)
    if (url.origin !== requestOrigin) {
      return undefined
    }

    return url.pathname
  }
  catch {
    return undefined
  }
}

function getValidatedKnowledgeBase(config: TockDocsPublicRuntimeConfig, kbId: string | undefined) {
  const trimmedKb = kbId?.trim()
  if (!trimmedKb) return undefined

  return getKnowledgeBases(config).find(kb => kb.id === trimmedKb)
}

function createScope(mode: 'legacy' | 'kb', kb: string | undefined, locale: string | undefined): AssistantScope {
  const scopeLabel = kb
    ? `${kb}${locale ? `/${locale}` : ''}`
    : locale

  return {
    mode,
    ...(kb ? { kb } : {}),
    ...(locale ? { locale } : {}),
    ...(scopeLabel ? { scopeLabel } : {}),
  }
}

function resolveHeaderScope({
  config,
  headerKb,
  headerLocale,
}: {
  config: TockDocsPublicRuntimeConfig
  headerKb?: string
  headerLocale?: string
}): AssistantGuardResult<{ scope: AssistantScope }> | undefined {
  const mode = getDocsMode(config)
  const locale = headerLocale?.trim() || undefined

  if (mode === 'kb') {
    if (!headerKb && !headerLocale) return undefined

    const knowledgeBase = getValidatedKnowledgeBase(config, headerKb)
    if (!knowledgeBase) {
      return failure(400, 'Assistant knowledge base scope is invalid.')
    }

    if (locale && !knowledgeBase.locales.includes(locale)) {
      return failure(400, 'Assistant locale scope is invalid.')
    }

    const resolvedLocale = locale || resolveKnowledgeBaseLocale(config, knowledgeBase.id)
    return {
      ok: true,
      scope: createScope(mode, knowledgeBase.id, resolvedLocale),
    }
  }

  if (!locale) return undefined

  const availableLocales = getFilteredLocaleCodes(config)
  if (availableLocales.length > 0 && !availableLocales.includes(locale)) {
    return failure(400, 'Assistant locale scope is invalid.')
  }

  return {
    ok: true,
    scope: createScope(mode, undefined, locale),
  }
}

function resolveRefererScope({
  config,
  referer,
  requestOrigin,
}: {
  config: TockDocsPublicRuntimeConfig
  referer?: string
  requestOrigin: string
}): AssistantScope | undefined {
  const refererPath = getRefererPath(referer, requestOrigin)
  if (!refererPath) return undefined

  const resolved = resolveDocsRoute(refererPath, config)
  if (!resolved.isDocsRoute) return undefined

  if (resolved.mode === 'kb') {
    if (!resolved.kb) return undefined

    const locale = resolved.locale || resolveKnowledgeBaseLocale(config, resolved.kb)
    return createScope(resolved.mode, resolved.kb, locale)
  }

  const locale = resolved.locale || getDefaultLocale(config)
  return createScope(resolved.mode, undefined, locale)
}

export function resolveAssistantRequestScope({
  config,
  requestOrigin,
  referer,
  headerKb,
  headerLocale,
}: {
  config: TockDocsPublicRuntimeConfig
  requestOrigin: string
  referer?: string
  headerKb?: string
  headerLocale?: string
}): AssistantGuardResult<{ scope: AssistantScope }> {
  const mode = getDocsMode(config)
  const refererScope = resolveRefererScope({ config, referer, requestOrigin })

  if (refererScope) {
    return {
      ok: true,
      scope: refererScope,
    }
  }

  const headerScope = resolveHeaderScope({ config, headerKb, headerLocale })
  if (headerScope) {
    return headerScope
  }

  if (mode === 'kb') {
    return failure(400, 'Assistant knowledge base scope is required.')
  }

  const locale = getDefaultLocale(config)
  return {
    ok: true,
    scope: createScope(mode, undefined, locale),
  }
}

export function checkAssistantRateLimit(
  key: string,
  options: AssistantRateLimitOptions = DEFAULT_ASSISTANT_RATE_LIMIT,
  now = Date.now(),
  buckets: Map<string, AssistantRateLimitBucket> = assistantRateLimitBuckets,
): AssistantGuardResult & { retryAfterSeconds?: number } {
  const bucket = buckets.get(key)
  const resetAt = bucket ? bucket.windowStartedAt + options.windowMs : now + options.windowMs

  if (!bucket || now >= resetAt) {
    buckets.set(key, { windowStartedAt: now, count: 1 })
    return { ok: true }
  }

  if (bucket.count >= options.maxRequests) {
    return {
      ...failure(429, 'Too many assistant requests.'),
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    }
  }

  bucket.count += 1
  return { ok: true }
}
