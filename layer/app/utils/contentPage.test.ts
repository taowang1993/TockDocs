import assert from 'node:assert/strict'
import { test } from 'node:test'

import { withoutDuplicateTitleHeading } from './contentPage'

test('withoutDuplicateTitleHeading removes a duplicate leading minimark heading and matching toc entry', () => {
  const page = {
    title: '12 你作为一个普通人你究竟有什么样的极端优势',
    body: {
      type: 'minimark',
      value: [
        ['h2', { id: '_12-title' }, '12. 你作为一个普通人你究竟有什么样的极端优势'],
        ['p', {}, '再说一遍：'],
      ],
      toc: {
        links: [
          { id: '_12-title', depth: 2, text: '12. 你作为一个普通人你究竟有什么样的极端优势' },
        ],
      },
    },
    stem: 'docs/investing/zh/1.book/13.chapter-12',
    extension: 'md',
  }

  const result = withoutDuplicateTitleHeading(page)

  assert.notEqual(result, page)
  assert.deepEqual(result.body?.value, [['p', {}, '再说一遍：']])
  assert.deepEqual(result.body?.toc?.links, [])
  assert.deepEqual(page.body.value[0], ['h2', { id: '_12-title' }, '12. 你作为一个普通人你究竟有什么样的极端优势'])
})

test('withoutDuplicateTitleHeading treats leading zero and number punctuation as equivalent', () => {
  const page = {
    title: '04 究竟有没有只涨不跌的投资标的',
    body: {
      type: 'minimark',
      value: [
        ['h2', { id: '_4-title' }, '4. 究竟有没有只涨不跌的投资标的'],
        ['p', {}, '正文。'],
      ],
      toc: {
        links: [
          { id: '_4-title', depth: 2, text: '4. 究竟有没有只涨不跌的投资标的' },
        ],
      },
    },
    stem: 'docs/investing/zh/1.book/05.chapter-04',
    extension: 'md',
  }

  const result = withoutDuplicateTitleHeading(page)

  assert.deepEqual(result.body?.value, [['p', {}, '正文。']])
  assert.deepEqual(result.body?.toc?.links, [])
})

test('withoutDuplicateTitleHeading leaves non-duplicate leading headings untouched', () => {
  const page = {
    title: 'Install TockDocs',
    body: {
      type: 'minimark',
      value: [
        ['h2', { id: 'requirements' }, 'Requirements'],
        ['p', {}, 'Install the package.'],
      ],
      toc: {
        links: [
          { id: 'requirements', depth: 2, text: 'Requirements' },
        ],
      },
    },
    stem: 'docs/manual/en/install',
    extension: 'md',
  }

  const result = withoutDuplicateTitleHeading(page)

  assert.equal(result, page)
  assert.deepEqual(result.body?.toc?.links, [{ id: 'requirements', depth: 2, text: 'Requirements' }])
})

test('withoutDuplicateTitleHeading does not ignore meaningful punctuation', () => {
  const page = {
    title: 'C++ Reference',
    body: {
      type: 'minimark',
      value: [
        ['h2', { id: 'c-reference' }, 'C Reference'],
        ['p', {}, 'Different topic.'],
      ],
      toc: {
        links: [
          { id: 'c-reference', depth: 2, text: 'C Reference' },
        ],
      },
    },
    stem: 'docs/manual/en/cpp-reference',
    extension: 'md',
  }

  const result = withoutDuplicateTitleHeading(page)

  assert.equal(result, page)
})
