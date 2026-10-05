import type { SessionMessage } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { chunkMessages, chunkText, messageText } from '../hooks/chunk'

const squash = (s: string) => s.replace(/\s+/g, '')

const message = (m: Partial<SessionMessage> & Pick<SessionMessage, 'role'>): SessionMessage =>
  ({ text: '', toolUses: [], ...m }) as SessionMessage

describe('chunkText', () => {
  test('short text is one chunk', () => {
    expect(chunkText('hello world', 100)).toEqual(['hello world'])
  })

  test('empty or blank text gives no chunks', () => {
    expect(chunkText('', 100)).toEqual([])
    expect(chunkText('  \n\n  ', 100)).toEqual([])
  })

  test('paragraphs pack together up to the limit', () => {
    const text = 'aaaa\n\nbbbb\n\ncccc\n\ndddd'
    expect(chunkText(text, 14)).toEqual(['aaaa\n\nbbbb', 'cccc\n\ndddd'])
  })

  test('a long paragraph is cut at a line break first', () => {
    const text = `${'a'.repeat(6)}\n${'b'.repeat(6)}`
    expect(chunkText(text, 10)).toEqual(['a'.repeat(6), 'b'.repeat(6)])
  })

  test('a long line is cut at a space before cutting a word', () => {
    expect(chunkText('alpha beta gamma', 11)).toEqual(['alpha beta', 'gamma'])
  })

  test('a word longer than the limit is cut hard', () => {
    expect(chunkText('x'.repeat(25), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)])
  })

  test('no chunk is over the limit, and nothing but whitespace is lost', () => {
    const para = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')
    const text = [para(3), para(80), `${para(20)}\n${para(30)}`, 'z'.repeat(300), para(5)].join('\n\n')
    for (const max of [20, 64, 150, 1000]) {
      const chunks = chunkText(text, max)
      for (const c of chunks) expect(c.length).toBeLessThanOrEqual(max)
      expect(squash(chunks.join(''))).toBe(squash(text))
    }
  })

  test('chunks have no trailing whitespace', () => {
    for (const c of chunkText('one\n\n\ntwo  \n\nthree\n', 8)) expect(c).toBe(c.trimEnd())
  })
})

describe('messageText', () => {
  test('prose alone', () => {
    expect(messageText(message({ role: 'user', text: 'hi' }))).toBe('hi')
  })

  test('prose, then tool calls with their input', () => {
    const m = message({
      role: 'assistant',
      text: 'Reading it.',
      toolUses: [{ tool: 'Read', input: { file_path: '/a.ts' } }] as SessionMessage['toolUses'],
    })
    expect(messageText(m)).toBe('Reading it.\n\n[tool: Read] {"file_path":"/a.ts"}')
  })

  test('tool results, with errors marked', () => {
    const m = message({
      role: 'user',
      toolResults: [
        { text: 'ok', isError: false },
        { text: 'boom', isError: true },
      ] as SessionMessage['toolResults'],
    })
    expect(messageText(m)).toBe('[result]\nok\n\n[result (error)]\nboom')
  })
})

describe('chunkMessages', () => {
  test('numbers each chunk within its message and keeps the role', () => {
    const long = Array.from({ length: 3 }, (_, i) => String(i).repeat(3000)).join('\n\n')
    const chunks = chunkMessages([
      message({ role: 'user', text: 'question' }),
      message({ role: 'assistant', text: long }),
    ])
    expect(chunks.map(({ m, role, i, n }) => ({ m, role, i, n }))).toEqual([
      { m: 0, role: 'user', i: 0, n: 1 },
      { m: 1, role: 'assistant', i: 0, n: 3 },
      { m: 1, role: 'assistant', i: 1, n: 3 },
      { m: 1, role: 'assistant', i: 2, n: 3 },
    ])
  })

  test('a message with no text yields no chunks but keeps later indexes', () => {
    const chunks = chunkMessages([message({ role: 'assistant' }), message({ role: 'user', text: 'x' })])
    expect(chunks).toEqual([{ m: 1, role: 'user', i: 0, n: 1, text: 'x' }])
  })
})
