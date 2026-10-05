import { atom, read, update } from 'claude-code'
import type {
  Register,
  SessionCompactInput,
  SessionCompactResult,
  SessionMessage,
} from 'claude-code'

import type { CompactLine, CompactRecord } from '../types'

const PANE = 'visible-compact'
const TITLE = 'Compaction: before / after'
const COMMAND = 'show-last-compact'
// Below this many body columns the two sides stack instead of sitting side by side.
const SIDE_BY_SIDE_MIN = 80
// Per-message cap so a huge tool output can't swamp the pane.
const MAX_MESSAGE_CHARS = 4000

const last = atom({ plugin: 'visible-compact', key: 'last' } as const, null)

const clip = (text: string) =>
  text.length > MAX_MESSAGE_CHARS
    ? `${text.slice(0, MAX_MESSAGE_CHARS)}… (${text.length - MAX_MESSAGE_CHARS} more chars)`
    : text

export const toLines = (messages: readonly SessionMessage[]): CompactLine[] =>
  messages
    .map(m => {
      const parts: string[] = []
      if (m.text) parts.push(m.text)
      for (const use of m.toolUses) parts.push(`[tool: ${use.tool}]`)
      for (const res of m.toolResults ?? [])
        parts.push(`[result${res.isError ? ' (error)' : ''}] ${res.text}`)

      return { role: m.role, text: clip(parts.join('\n')) }
    })
    .filter(line => line.text.length > 0)

// Only the main conversation's real compactions: not subagents, not precomputes, not skips.
export const toRecord = (
  e: SessionCompactInput,
  result: SessionCompactResult,
  at: number,
): CompactRecord | null => {
  if (e.agentId !== undefined || e.trigger === 'precompute' || result.skip !== undefined) return null

  return {
    at,
    trigger: e.trigger,
    instructions: e.instructions,
    tokensBefore: result.tokensBefore,
    tokensAfter: result.tokensAfter,
    before: toLines(e.messages),
    after: toLines(result.messages),
  }
}

const tokens = (n?: number) => (n === undefined ? '?' : n.toLocaleString())

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Reopen the pane comparing the conversation before and after the last compaction',
    })

    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    const record = toRecord(e, result, Date.now())
    if (record === null) return result

    await update($, last, () => record)
    if (record.trigger === 'manual') void $.ui.open({ id: PANE, title: TITLE })

    return result
  })

  on('command.run', { command: COMMAND }, async $ => {
    if ((await read($, last)) === null)
      return { text: 'No compaction recorded in this session yet. Run /compact first.' }
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Opened the last compaction.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const record = await read($, last)
    if (record === null) return <Text dimColor>No compaction recorded yet.</Text>

    const sideBySide = e.props.bodyColumns >= SIDE_BY_SIDE_MIN
    const width = sideBySide ? Math.floor(e.props.bodyColumns / 2) : e.props.bodyColumns
    const column = (heading: string, lines: CompactLine[]) => (
      <Box flexDirection="column" width={width} paddingRight={1}>
        <Text bold underline>
          {heading}
        </Text>
        {lines.length === 0 && <Text dimColor>(empty)</Text>}
        {lines.map(line => (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color={line.role === 'user' ? 'cyan' : 'green'}>
              {line.role}
            </Text>
            <Text wrap="wrap">{line.text}</Text>
          </Box>
        ))}
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Text dimColor>
          {record.trigger} compaction at {new Date(record.at).toLocaleTimeString()} · tokens{' '}
          {tokens(record.tokensBefore)} → {tokens(record.tokensAfter)} · messages{' '}
          {record.before.length} → {record.after.length}
        </Text>
        {record.instructions && <Text dimColor>instructions: {record.instructions}</Text>}
        <Box flexDirection={sideBySide ? 'row' : 'column'} marginTop={1}>
          {column(`Sent (${record.before.length})`, record.before)}
          {column(`Compacted (${record.after.length})`, record.after)}
        </Box>
      </Box>
    )
  })
}
