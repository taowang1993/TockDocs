import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  checkAssistantRateLimit,
  getAssistantRateLimitOptions,
  getAssistantRequestLimits,
  resolveAssistantRequestScope,
  validateAssistantContentLength,
  validateAssistantRequestBody,
  validateAssistantRequestOrigin,
} from '../runtime/server/utils/request-guards'

const kbConfig = {
  tockdocs: {
    docsMode: 'kb' as const,
    knowledgeBases: [
      {
        id: 'manual',
        title: 'Manual',
        description: 'Manual docs',
        icon: 'i-lucide-book-open',
        defaultLocale: 'en',
        locales: ['en', 'zh'],
      },
      {
        id: 'chemistry',
        title: 'Chemistry',
        description: 'Chemistry docs',
        icon: 'i-lucide-flask-conical',
        defaultLocale: 'zh',
        locales: ['zh'],
      },
    ],
    defaultKnowledgeBase: 'manual',
  },
}

const legacyConfig = {
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'zh'],
  },
  tockdocs: {
    docsMode: 'legacy' as const,
  },
}

test('resolveAssistantRequestScope rejects missing KB scope in KB mode', () => {
  const result = resolveAssistantRequestScope({
    config: kbConfig,
    requestOrigin: 'https://example.com',
  })

  assert.equal(result.ok, false)
  assert.equal(result.statusCode, 400)
})

test('resolveAssistantRequestScope prefers same-origin referer over forged headers', () => {
  const result = resolveAssistantRequestScope({
    config: kbConfig,
    requestOrigin: 'https://example.com',
    referer: 'https://example.com/docs/manual/en/getting-started',
    headerKb: 'chemistry',
    headerLocale: 'zh',
  })

  assert.deepEqual(result, {
    ok: true,
    scope: {
      mode: 'kb',
      kb: 'manual',
      locale: 'en',
      scopeLabel: 'manual/en',
    },
  })
})

test('resolveAssistantRequestScope accepts validated header scope when referer is absent', () => {
  const result = resolveAssistantRequestScope({
    config: kbConfig,
    requestOrigin: 'https://example.com',
    headerKb: 'chemistry',
    headerLocale: 'zh',
  })

  assert.deepEqual(result, {
    ok: true,
    scope: {
      mode: 'kb',
      kb: 'chemistry',
      locale: 'zh',
      scopeLabel: 'chemistry/zh',
    },
  })
})

test('resolveAssistantRequestScope validates KB header scope before retrieval', () => {
  const defaultLocale = resolveAssistantRequestScope({
    config: kbConfig,
    requestOrigin: 'https://example.com',
    headerKb: 'manual',
  })

  assert.deepEqual(defaultLocale, {
    ok: true,
    scope: {
      mode: 'kb',
      kb: 'manual',
      locale: 'en',
      scopeLabel: 'manual/en',
    },
  })

  const invalidKb = resolveAssistantRequestScope({
    config: kbConfig,
    requestOrigin: 'https://example.com',
    headerKb: 'unknown',
    headerLocale: 'en',
  })

  assert.equal(invalidKb.ok, false)
  assert.equal(!invalidKb.ok && invalidKb.statusMessage, 'Assistant knowledge base scope is invalid.')

  const missingHeaderKb = resolveAssistantRequestScope({
    config: kbConfig,
    requestOrigin: 'https://example.com',
    headerLocale: 'en',
  })

  assert.equal(missingHeaderKb.ok, false)
  assert.equal(!missingHeaderKb.ok && missingHeaderKb.statusMessage, 'Assistant knowledge base scope is invalid.')

  const invalidLocale = resolveAssistantRequestScope({
    config: kbConfig,
    requestOrigin: 'https://example.com',
    headerKb: 'manual',
    headerLocale: 'ja',
  })

  assert.equal(invalidLocale.ok, false)
  assert.equal(!invalidLocale.ok && invalidLocale.statusMessage, 'Assistant locale scope is invalid.')
})

test('resolveAssistantRequestScope ignores cross-origin and non-docs referers before fallback', () => {
  const headerFallback = resolveAssistantRequestScope({
    config: kbConfig,
    requestOrigin: 'https://example.com',
    referer: 'https://evil.example/docs/manual/en/getting-started',
    headerKb: 'manual',
    headerLocale: 'zh',
  })

  assert.deepEqual(headerFallback, {
    ok: true,
    scope: {
      mode: 'kb',
      kb: 'manual',
      locale: 'zh',
      scopeLabel: 'manual/zh',
    },
  })

  const missingKb = resolveAssistantRequestScope({
    config: kbConfig,
    requestOrigin: 'https://example.com',
    referer: 'https://example.com/not-docs',
  })

  assert.equal(missingKb.ok, false)
  assert.equal(!missingKb.ok && missingKb.statusMessage, 'Assistant knowledge base scope is required.')
})

test('resolveAssistantRequestScope keeps legacy mode scoped to one locale', () => {
  const result = resolveAssistantRequestScope({
    config: legacyConfig,
    requestOrigin: 'https://example.com',
    referer: 'https://example.com/zh/guide',
  })

  assert.deepEqual(result, {
    ok: true,
    scope: {
      mode: 'legacy',
      locale: 'zh',
      scopeLabel: 'zh',
    },
  })

  const headerLocale = resolveAssistantRequestScope({
    config: legacyConfig,
    requestOrigin: 'https://example.com',
    headerLocale: 'zh',
  })

  assert.deepEqual(headerLocale, {
    ok: true,
    scope: {
      mode: 'legacy',
      locale: 'zh',
      scopeLabel: 'zh',
    },
  })

  const defaultLocale = resolveAssistantRequestScope({
    config: legacyConfig,
    requestOrigin: 'https://example.com',
  })

  assert.deepEqual(defaultLocale, {
    ok: true,
    scope: {
      mode: 'legacy',
      locale: 'en',
      scopeLabel: 'en',
    },
  })

  const invalidLocale = resolveAssistantRequestScope({
    config: legacyConfig,
    requestOrigin: 'https://example.com',
    headerLocale: 'ja',
  })

  assert.equal(invalidLocale.ok, false)
  assert.equal(!invalidLocale.ok && invalidLocale.statusMessage, 'Assistant locale scope is invalid.')
})

test('validateAssistantRequestOrigin blocks cross-origin browser requests', () => {
  assert.deepEqual(validateAssistantRequestOrigin({
    requestOrigin: 'https://docs.example.com',
    origin: 'https://evil.example',
    secFetchSite: 'cross-site',
  }), {
    ok: false,
    statusCode: 403,
    statusMessage: 'Cross-origin assistant requests are not allowed.',
  })

  assert.deepEqual(validateAssistantRequestOrigin({
    requestOrigin: 'https://docs.example.com',
    origin: 'notaurl',
  }), {
    ok: false,
    statusCode: 403,
    statusMessage: 'Cross-origin assistant requests are not allowed.',
  })

  assert.deepEqual(validateAssistantRequestOrigin({
    requestOrigin: 'https://docs.example.com',
    origin: 'https://docs.example.com',
    secFetchSite: 'same-origin',
  }), { ok: true })

  assert.deepEqual(validateAssistantRequestOrigin({
    requestOrigin: 'https://docs.example.com',
  }), { ok: true })
})

test('validateAssistantContentLength rejects malformed or oversized bodies early', () => {
  assert.deepEqual(validateAssistantContentLength(undefined, 100), { ok: true })
  assert.deepEqual(validateAssistantContentLength('99', 100), { ok: true })

  assert.deepEqual(validateAssistantContentLength('-1', 100), {
    ok: false,
    statusCode: 400,
    statusMessage: 'Content-Length header is invalid.',
  })

  assert.deepEqual(validateAssistantContentLength('abc', 100), {
    ok: false,
    statusCode: 400,
    statusMessage: 'Content-Length header is invalid.',
  })

  assert.deepEqual(validateAssistantContentLength('101', 100), {
    ok: false,
    statusCode: 413,
    statusMessage: 'Assistant request body is too large.',
  })
})

test('validateAssistantRequestBody accepts supported AI SDK message shapes', () => {
  const limits = {
    maxBodyBytes: 10_000,
    maxMessages: 4,
    maxMessageTextChars: 100,
    maxTotalTextChars: 200,
  }

  const validParts = validateAssistantRequestBody({
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'How do I install TockDocs?' }] }],
  }, limits)

  assert.equal(validParts.ok, true)
  assert.equal(validParts.ok && validParts.body.messages.length, 1)

  const validContentArray = validateAssistantRequestBody({
    messages: [
      { role: 'system', content: 'Follow docs.' },
      { role: 'assistant', content: 'What would you like to know?' },
      { role: 'tool', content: [{ content: 'Search result.' }] },
      { role: 'user', content: [{ text: 'Explain setup.' }, 'ignored primitive part'] },
    ],
  }, limits)

  assert.equal(validContentArray.ok, true)
})

test('validateAssistantRequestBody rejects malformed messages and oversized content', () => {
  const limits = {
    maxBodyBytes: 10_000,
    maxMessages: 4,
    maxMessageTextChars: 100,
    maxTotalTextChars: 200,
  }

  const failures: Array<[string, unknown, number, string]> = [
    ['non-object body', null, 400, 'Assistant request body must include a messages array.'],
    ['missing messages', {}, 400, 'Assistant request body must include a messages array.'],
    ['empty messages', { messages: [] }, 400, 'Assistant request must include at least one message.'],
    ['too many messages', { messages: Array.from({ length: 5 }, () => ({ role: 'user', content: 'hello' })) }, 400, 'Assistant request includes too many messages.'],
    ['non-object message', { messages: ['hello'] }, 400, 'Assistant messages must be objects.'],
    ['invalid role', { messages: [{ role: 'developer', content: 'hello' }] }, 400, 'Assistant message role is invalid.'],
    ['single message too large', { messages: [{ role: 'user', content: 'x'.repeat(101) }] }, 413, 'Assistant message is too large.'],
    ['total text too large', { messages: [{ role: 'assistant', content: 'x'.repeat(100) }, { role: 'user', content: 'y'.repeat(101) }] }, 413, 'Assistant message is too large.'],
    ['last message is not user', { messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }] }, 400, 'Assistant request must end with a user text message.'],
    ['last user message is empty', { messages: [{ role: 'user', content: [{ type: 'text' }] }] }, 400, 'Assistant request must end with a user text message.'],
  ]

  for (const [name, body, statusCode, statusMessage] of failures) {
    const result = validateAssistantRequestBody(body, limits)
    assert.equal(result.ok, false, name)
    assert.equal(!result.ok && result.statusCode, statusCode, name)
    assert.equal(!result.ok && result.statusMessage, statusMessage, name)
  }

  const totalTooLarge = validateAssistantRequestBody({
    messages: [{ role: 'assistant', content: 'x'.repeat(100) }, { role: 'user', content: 'y'.repeat(100) }],
  }, {
    ...limits,
    maxMessageTextChars: 150,
    maxTotalTextChars: 150,
  })

  assert.equal(totalTooLarge.ok, false)
  assert.equal(!totalTooLarge.ok && totalTooLarge.statusMessage, 'Assistant request text is too large.')

  const circularBody: Record<string, unknown> = { messages: [{ role: 'user', content: 'hello' }] }
  circularBody.self = circularBody
  const circular = validateAssistantRequestBody(circularBody, limits)

  assert.equal(circular.ok, false)
  assert.equal(!circular.ok && circular.statusCode, 413)
})

test('assistant guard env parsers accept positive integers and fallback otherwise', () => {
  assert.deepEqual(getAssistantRequestLimits({
    ASSISTANT_MAX_BODY_BYTES: '512',
    ASSISTANT_MAX_MESSAGES: '3',
    ASSISTANT_MAX_MESSAGE_TEXT_CHARS: '80',
    ASSISTANT_MAX_TOTAL_TEXT_CHARS: '160',
  }), {
    maxBodyBytes: 512,
    maxMessages: 3,
    maxMessageTextChars: 80,
    maxTotalTextChars: 160,
  })

  const fallbackLimits = getAssistantRequestLimits({
    ASSISTANT_MAX_BODY_BYTES: '0',
    ASSISTANT_MAX_MESSAGES: '-1',
    ASSISTANT_MAX_MESSAGE_TEXT_CHARS: 'nope',
    ASSISTANT_MAX_TOTAL_TEXT_CHARS: '',
  })

  assert.equal(fallbackLimits.maxBodyBytes, 128 * 1024)
  assert.equal(fallbackLimits.maxMessages, 20)
  assert.equal(fallbackLimits.maxMessageTextChars, 8_000)
  assert.equal(fallbackLimits.maxTotalTextChars, 24_000)

  assert.deepEqual(getAssistantRateLimitOptions({
    ASSISTANT_RATE_LIMIT_MAX_REQUESTS: '5',
    ASSISTANT_RATE_LIMIT_WINDOW_MS: '9000',
  }), {
    maxRequests: 5,
    windowMs: 9000,
  })

  assert.deepEqual(getAssistantRateLimitOptions({
    ASSISTANT_RATE_LIMIT_MAX_REQUESTS: '0',
    ASSISTANT_RATE_LIMIT_WINDOW_MS: 'bad',
  }), {
    maxRequests: 20,
    windowMs: 60_000,
  })
})

test('checkAssistantRateLimit returns retry metadata after the bucket is exhausted', () => {
  const buckets = new Map()
  const options = { maxRequests: 2, windowMs: 60_000 }

  assert.equal(checkAssistantRateLimit('203.0.113.10', options, 1_000, buckets).ok, true)
  assert.equal(checkAssistantRateLimit('203.0.113.10', options, 2_000, buckets).ok, true)

  const limited = checkAssistantRateLimit('203.0.113.10', options, 3_000, buckets)

  assert.equal(limited.ok, false)
  assert.equal(!limited.ok && limited.statusCode, 429)
  assert.equal(!limited.ok && limited.retryAfterSeconds, 58)

  assert.equal(checkAssistantRateLimit('203.0.113.10', options, 61_000, buckets).ok, true)
  assert.equal(checkAssistantRateLimit('198.51.100.4', options, 4_000, buckets).ok, true)
})
