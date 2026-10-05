import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Chunk, CompactMeta, Side, ViewMode } from '../types'
import { chunkMessages } from './chunk'

/** Chunks per file: 100 × 4,000 chars stays well under the 4 MiB a file read or write allows. */
export const FILE_CHUNKS = 100

const sessionDir = async ($: EngineInterface) => {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '.'
  const id = await $.session.id()

  return `${home}/.claude/visible-compact/sessions/${id}`
}

const chunkFile = (dir: string, id: string, side: Side, file: number) =>
  `${dir}/${id}.${side}.${file}.json`

export const readIndex = async ($: EngineInterface): Promise<CompactMeta[]> => {
  const path = `${await sessionDir($)}/index.json`
  if (!(await $.fs.exists(path))) return []
  try {
    return JSON.parse(await $.fs.read(path)) as CompactMeta[]
  } catch {
    return []
  }
}

export const saveCompaction = async (
  $: EngineInterface,
  meta: CompactMeta,
  chunks: Record<Side, Chunk[]>,
): Promise<CompactMeta[]> => {
  const dir = await sessionDir($)
  for (const side of ['before', 'after'] as const) {
    const list = chunks[side]
    for (let file = 0; file * FILE_CHUNKS < list.length; file++)
      await $.fs.write(
        chunkFile(dir, meta.id, side, file),
        JSON.stringify(list.slice(file * FILE_CHUNKS, (file + 1) * FILE_CHUNKS)),
      )
  }
  const index = [...(await readIndex($)), meta]
  await $.fs.write(`${dir}/index.json`, JSON.stringify(index))

  return index
}

// A few files' worth of chunks, so paging back and forth doesn't re-read.
const cache = new Map<string, Chunk[]>()

export const readChunks = async (
  $: EngineInterface,
  id: string,
  side: Side,
  from: number,
  count: number,
): Promise<Chunk[]> => {
  const dir = await sessionDir($)
  const out: Chunk[] = []
  for (let at = from; at < from + count; ) {
    const file = Math.floor(at / FILE_CHUNKS)
    const path = chunkFile(dir, id, side, file)
    let list = cache.get(path)
    if (list === undefined) {
      if (!(await $.fs.exists(path))) break
      list = JSON.parse(await $.fs.read(path)) as Chunk[]
      cache.set(path, list)
      if (cache.size > 6) cache.delete(cache.keys().next().value!)
    }
    const offset = at - file * FILE_CHUNKS
    const taken = list.slice(offset, offset + (from + count - at))
    if (taken.length === 0) break
    out.push(...taken)
    at += taken.length
  }

  return out
}

const PANE = 'visible-compact'
const TITLE = 'Your last compact'
const COMMAND = 'show-last-compact'
// Below this many body columns the two sides stack instead of sitting side by side.
const SIDE_BY_SIDE_MIN = 80
// Chunks drawn per page of each column; at 4,000 chars a chunk, a page is at most 40k chars.
const PAGE_CHUNKS = 10

const index = atom({ plugin: 'visible-compact', key: 'index' } as const, [])
const selected = atom({ plugin: 'visible-compact', key: 'selected' } as const, null)
const view = atom({ plugin: 'visible-compact', key: 'view' } as const, 'both')
const pages = atom({ plugin: 'visible-compact', key: 'pages' } as const, { before: 0, after: 0 })

const tokens = (n?: number) =>
  n === undefined ? '?' : n >= 1000 ? `${Math.round(n / 1000).toLocaleString()}k` : String(n)

const clock = (at: number) => new Date(at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })

const who = (meta: CompactMeta) => (meta.agentId === undefined ? 'main' : (meta.agentLabel ?? `agent ${meta.agentId}`))

const optionLabel = (meta: CompactMeta) =>
  `${clock(meta.at)} · ${who(meta)} · ${meta.trigger} · ${tokens(meta.tokensBefore)} → ${tokens(meta.tokensAfter)}`

const agentLabel = async ($: EngineInterface, agentId: string) => {
  const agent = (await $.agent.list()).find(a => a.id === agentId)

  return agent === undefined ? undefined : `${agent.type}: ${agent.description}`
}

const show = async ($: EngineInterface, id: string | null) => {
  await update($, selected, () => id)
  await update($, pages, () => ({ before: 0, after: 0 }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Reopen "Your last compact": what was compacted, side by side with what came back',
    })
    // Compactions live on disk under the session id, so a restart or --resume picks them up again.
    const saved = await readIndex($)
    await update($, index, () => saved)

    return next(e)
  })

  // /clear goes on under a new session id, with nothing compacted yet.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, index, () => [])
      await show($, null)
    }

    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const started = Date.now()
    const result = await next(e)
    if (e.trigger === 'precompute' || result.skip !== undefined) return result

    const before = chunkMessages(e.messages)
    const after = chunkMessages(result.messages)
    const meta: CompactMeta = {
      id: `${started.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      at: started,
      durationMs: Date.now() - started,
      trigger: e.trigger,
      agentId: e.agentId,
      agentLabel: e.agentId === undefined ? undefined : await agentLabel($, e.agentId),
      instructions: e.instructions,
      tokensBefore: result.tokensBefore,
      tokensAfter: result.tokensAfter,
      usage: result.usage,
      messages: { before: e.messages.length, after: result.messages.length },
      chunks: { before: before.length, after: after.length },
    }
    try {
      const saved = await saveCompaction($, meta, { before, after })
      await update($, index, () => saved)
    } catch (error) {
      $.ui.toast(`visible-compact: could not save the compaction (${String(error)})`)

      return result
    }
    // Your own /compact opens the pane on it; auto and subagent compactions just join the picker.
    if (e.trigger === 'manual' && e.agentId === undefined) {
      await show($, null)
      void $.ui.open({ id: PANE, title: TITLE })
    }

    return result
  })

  on('command.run', { command: COMMAND }, async $ => {
    if ((await read($, index)).length === 0)
      return { text: 'No compaction recorded for this session yet. Run /compact first.' }
    await show($, null)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Opened "Your last compact".' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const all = await read($, index)
    const heading = (
      <Text bold color="cyan">
        {TITLE}
      </Text>
    )
    if (all.length === 0)
      return (
        <Box flexDirection="column">
          {heading}
          <Text dimColor>No compaction recorded for this session yet.</Text>
        </Box>
      )

    const pick = await read($, selected)
    const meta = all.find(m => m.id === pick) ?? all[all.length - 1]!
    const mode = await read($, view)
    const page = await read($, pages)
    const columns = e.props.bodyColumns

    const setView = (next: ViewMode) => () => void update($, view, () => next)
    // Laid out as the columns are: after on the left, before on the right.
    const toggle = (
      <Box gap={1}>
        <Button plain hotkey="a" dimColor={mode !== 'after'} onPress={setView('after')}>
          ◧
        </Button>
        <Button plain hotkey="s" dimColor={mode !== 'both'} onPress={setView('both')}>
          ◫
        </Button>
        <Button plain hotkey="b" dimColor={mode !== 'before'} onPress={setView('before')}>
          ◨
        </Button>
      </Box>
    )

    const newestFirst = [...all].reverse()
    const options = newestFirst.map((m, i) => ({
      value: m.id,
      label: `${i === 0 ? '(latest) ' : ''}${optionLabel(m)}`,
    }))
    const pickId = (id: string) => void show($, id === newestFirst[0]?.id ? null : id)
    // Mobile draws no Select: there the latest few are buttons instead.
    const picker =
      'Select' in ui ? (
        <ui.Select key="compaction" label="Compaction: " value={meta.id} options={options} onSelect={pickId} />
      ) : (
        <Box flexDirection="column">
          {options.slice(0, 5).map(o => (
            <Button key={o.value} plain dimColor={o.value !== meta.id} onPress={() => pickId(o.value)}>
              {o.label}
            </Button>
          ))}
        </Box>
      )

    const summary = [
      `${meta.trigger}${meta.agentId === undefined ? '' : ` · ${who(meta)}`}`,
      clock(meta.at),
      `took ${(meta.durationMs / 1000).toFixed(1)}s`,
      `tokens ${tokens(meta.tokensBefore)} → ${tokens(meta.tokensAfter)}`,
      `messages ${meta.messages.before} → ${meta.messages.after}`,
      meta.usage &&
        `summarizer in ${tokens(meta.usage.input_tokens + meta.usage.cache_read_input_tokens + meta.usage.cache_creation_input_tokens)} / out ${tokens(meta.usage.output_tokens)}`,
    ]
      .filter(Boolean)
      .join(' · ')

    const column = async (side: Side, width: number, keys: { prev: string; next: string }) => {
      const total = meta.chunks[side]
      const pageCount = Math.max(1, Math.ceil(total / PAGE_CHUNKS))
      const at = Math.min(page[side], pageCount - 1)
      const chunks = await readChunks($, meta.id, side, at * PAGE_CHUNKS, PAGE_CHUNKS)
      const turn = (by: number) => () =>
        void update($, pages, p => ({ ...p, [side]: Math.max(0, Math.min(pageCount - 1, at + by)) }))

      return (
        <Box flexDirection="column" width={width} paddingRight={1}>
          <Box justifyContent="space-between">
            <Text bold underline>
              {side === 'after' ? 'After' : 'Before'} ({meta.messages[side]} msgs, {total} chunks)
            </Text>
            {pageCount > 1 && (
              <Box gap={1}>
                <Button plain hotkey={keys.prev} dimColor={at === 0} onPress={turn(-1)}>
                  ‹
                </Button>
                <Text dimColor>
                  {at + 1}/{pageCount}
                </Text>
                <Button plain hotkey={keys.next} dimColor={at === pageCount - 1} onPress={turn(1)}>
                  ›
                </Button>
              </Box>
            )}
          </Box>
          {chunks.length === 0 && <Text dimColor>(empty)</Text>}
          {chunks.map((chunk: Chunk) => (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>
                <Text bold color={chunk.role === 'user' ? 'cyan' : 'green'}>
                  {chunk.role}
                </Text>{' '}
                · msg {chunk.m + 1}
                {chunk.n > 1 ? ` · part ${chunk.i + 1}/${chunk.n}` : ''}
              </Text>
              <Text wrap="wrap">{chunk.text}</Text>
            </Box>
          ))}
        </Box>
      )
    }

    const isSideBySide = mode === 'both' && columns >= SIDE_BY_SIDE_MIN
    const half = isSideBySide ? Math.floor(columns / 2) : columns
    const body =
      mode === 'after' ? (
        await column('after', columns, { prev: 'h', next: 'l' })
      ) : mode === 'before' ? (
        await column('before', columns, { prev: 'p', next: 'n' })
      ) : (
        <Box flexDirection={isSideBySide ? 'row' : 'column'}>
          {await column('after', half, { prev: 'h', next: 'l' })}
          {await column('before', half, { prev: 'p', next: 'n' })}
        </Box>
      )

    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          {heading}
          {toggle}
        </Box>
        {picker}
        <Text dimColor>{summary}</Text>
        {meta.instructions && <Text dimColor>instructions: {meta.instructions}</Text>}
        <Box marginTop={1}>{body}</Box>
      </Box>
    )
  })
}
