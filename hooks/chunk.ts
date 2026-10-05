import type { SessionMessage } from 'claude-code'

import type { Chunk } from '../types'

export const CHUNK_CHARS = 4000

/** Splits one over-long piece at the last match of `at` before the limit, else hard. */
const cut = (text: string, max: number, at: RegExp): string[] => {
  const out: string[] = []
  let rest = text
  while (rest.length > max) {
    const window = rest.slice(0, max)
    let end = -1
    for (const match of window.matchAll(at)) end = match.index + match[0].length
    if (end <= 0) end = max
    out.push(rest.slice(0, end))
    rest = rest.slice(end)
  }
  if (rest.length > 0) out.push(rest)

  return out
}

/**
 * Packs paragraphs into chunks of at most `max` chars. A paragraph longer than
 * that is cut at line breaks, then at spaces, then anywhere.
 */
export const chunkText = (text: string, max = CHUNK_CHARS): string[] => {
  const pieces = text
    .split(/(?<=\n\s*\n)/)
    .flatMap(p => (p.length <= max ? [p] : cut(p, max, /\n/g)))
    .flatMap(p => (p.length <= max ? [p] : cut(p, max, / /g)))

  const chunks: string[] = []
  let current = ''
  for (const piece of pieces) {
    if (current.length + piece.length > max && current.length > 0) {
      chunks.push(current)
      current = ''
    }
    current += piece
  }
  if (current.length > 0) chunks.push(current)

  return chunks.map(c => c.replace(/\s+$/, '')).filter(c => c.length > 0)
}

/** A message flattened to text: its prose, then each tool call with its input, then each tool result. */
export const messageText = (m: SessionMessage): string => {
  const parts: string[] = []
  if (m.text) parts.push(m.text)
  for (const use of m.toolUses) parts.push(`[tool: ${use.tool}] ${JSON.stringify(use.input)}`)
  for (const res of m.toolResults ?? [])
    parts.push(`[result${res.isError ? ' (error)' : ''}]\n${res.text}`)

  return parts.join('\n\n')
}

export const chunkMessages = (messages: readonly SessionMessage[]): Chunk[] =>
  messages.flatMap((message, m) => {
    const texts = chunkText(messageText(message))

    return texts.map((text, i) => ({ m, role: message.role, i, n: texts.length, text }))
  })
