import type { EngineInterface } from 'claude-code'

import type { Chunk, CompactMeta, Side } from '../types'

/** Chunks per file: 100 × 4,000 chars stays well under the 4 MiB a file read or write allows. */
export const FILE_CHUNKS = 100

/** Claude Code's own default for `cleanupPeriodDays`. */
export const DEFAULT_RETENTION_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

export type Storage = 'temp' | 'home' | 'memory'
type Disk = Exclude<Storage, 'memory'>

export const parseStorage = (value: unknown): Storage =>
  value === 'home' || value === 'memory' ? value : 'temp'

// Module variables start over on a reload, and register and session.start set them again.
let configured: Storage = 'temp'
let retentionDays = DEFAULT_RETENTION_DAYS

export const configure = (storage: Storage) => {
  configured = storage
}

/**
 * Reads `cleanupPeriodDays` from Claude Code's settings, so compactions are kept
 * as long as the transcripts they came from. A missing or invalid value is 30.
 */
export async function readRetentionDays($: EngineInterface): Promise<number> {
  const value = await $.settings.read({ key: 'cleanupPeriodDays' }).catch(() => undefined)
  retentionDays =
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : DEFAULT_RETENTION_DAYS

  return retentionDays
}

/** `cleanupPeriodDays: 0` keeps no transcripts, so nothing goes to disk either. */
export const effectiveStorage = (): Storage => (retentionDays === 0 ? 'memory' : configured)

/** Compactions from before this moment have expired. */
export const cutoff = (now = Date.now()) => now - retentionDays * DAY_MS

async function diskBase($: EngineInterface, disk: Disk) {
  if (disk === 'home') {
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '.'
    return `${home.replace(/[\\/]$/, '')}/.claude/visible-compact`
  }
  const temp =
    (await $.env.get('TMPDIR')) ?? (await $.env.get('TEMP')) ?? (await $.env.get('TMP')) ?? '/tmp'
  return `${temp.replace(/[\\/]$/, '')}/visible-compact`
}

async function sessionDir($: EngineInterface, disk: Disk) {
  return `${await diskBase($, disk)}/sessions/${await $.session.id()}`
}

const chunkFile = (dir: string, id: string, side: Side, file: number) =>
  `${dir}/${id}.${side}.${file}.json`

/** A chunk file's compaction id: `<id>.<side>.<n>.json`. */
const idOfFile = (name: string) => name.split('.')[0]!

// `memory` storage: per session id, gone when Claude Code exits or the module reloads.
type Held = { index: CompactMeta[]; chunks: Record<string, Chunk[]> }
const memory = new Map<string, Held>()

async function held($: EngineInterface) {
  const id = await $.session.id()
  let entry = memory.get(id)
  if (entry === undefined) memory.set(id, (entry = { index: [], chunks: {} }))

  return entry
}

/** Drops what memory storage holds for this session (its end, or /clear). */
export async function forgetSession($: EngineInterface) {
  memory.delete(await $.session.id())
}

export async function readIndex($: EngineInterface): Promise<CompactMeta[]> {
  const since = cutoff()
  const storage = effectiveStorage()
  if (storage === 'memory') return (await held($)).index.filter(m => m.at >= since)

  const path = `${await sessionDir($, storage)}/index.json`
  if (!(await $.fs.exists(path))) return []
  try {
    const list = JSON.parse(await $.fs.read(path)) as CompactMeta[]
    return Array.isArray(list) ? list.filter(m => m.at >= since) : []
  } catch {
    return []
  }
}

export async function saveCompaction(
  $: EngineInterface,
  meta: CompactMeta,
  chunks: Record<Side, Chunk[]>,
): Promise<CompactMeta[]> {
  const storage = effectiveStorage()
  if (storage === 'memory') {
    const entry = await held($)
    entry.chunks[`${meta.id}.before`] = chunks.before
    entry.chunks[`${meta.id}.after`] = chunks.after
    entry.index = [...entry.index, meta]

    return readIndex($)
  }

  const dir = await sessionDir($, storage)
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

export async function readChunks(
  $: EngineInterface,
  id: string,
  side: Side,
  from: number,
  count: number,
): Promise<Chunk[]> {
  const storage = effectiveStorage()
  if (storage === 'memory') return ((await held($)).chunks[`${id}.${side}`] ?? []).slice(from, from + count)

  const dir = await sessionDir($, storage)
  const out: Chunk[] = []
  for (let at = from; at < from + count; ) {
    const file = Math.floor(at / FILE_CHUNKS)
    const path = chunkFile(dir, id, side, file)
    let list = cache.get(path)
    if (list === undefined) {
      if (!(await $.fs.exists(path))) break
      const text = await $.fs.read(path)
      // A cleared (expired) file is empty.
      list = text === '' ? [] : (JSON.parse(text) as Chunk[])
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

/**
 * Clears one session folder's expired compactions. The plugin API can't delete
 * files, so each expired file is overwritten with nothing: no conversation text
 * remains, only empty files under the session id.
 *
 * Expired means recorded before `since` (by the index) or a file last written
 * before it (which also catches files an interrupted save left out of the index).
 *
 * @returns how many files were cleared
 */
async function sweepSession($: EngineInterface, dir: string, since: number): Promise<number> {
  const files = await $.fs.list(dir).catch(() => [])
  let cleared = 0
  const clear = async (name: string) => {
    await $.fs.write(`${dir}/${name}`, '')
    cleared++
  }

  const expired = new Set<string>()
  const index = files.find(f => f.name === 'index.json' && f.kind === 'file')
  if (index !== undefined && index.size > 0) {
    let list: CompactMeta[] | undefined
    try {
      const parsed = JSON.parse(await $.fs.read(`${dir}/index.json`)) as unknown
      if (Array.isArray(parsed)) list = parsed as CompactMeta[]
    } catch {
      list = undefined
    }
    if (list === undefined) {
      if (index.mtimeMs < since) await clear('index.json')
    } else {
      const kept = list.filter(m => typeof m?.at === 'number' && m.at >= since)
      for (const m of list) if (!kept.includes(m)) expired.add(m.id)
      if (kept.length === 0) await clear('index.json')
      else if (kept.length < list.length) {
        await $.fs.write(`${dir}/index.json`, JSON.stringify(kept))
        cleared++
      }
    }
  }

  for (const f of files) {
    if (f.kind !== 'file' || f.size === 0 || f.name === 'index.json') continue
    if (f.mtimeMs < since || expired.has(idOfFile(f.name))) await clear(f.name)
  }

  return cleared
}

/**
 * Clears expired compactions from every session, not only this one, in both the
 * temp and home locations, so switching `storage` leaves nothing behind for good.
 *
 * @returns how many files were cleared
 */
export async function sweep($: EngineInterface, now = Date.now()): Promise<number> {
  const since = cutoff(now)
  const bases = [...new Set([await diskBase($, 'temp'), await diskBase($, 'home')])]
  let cleared = 0
  for (const base of bases) {
    const root = `${base}/sessions`
    const sessions = await $.fs.list(root).catch(() => [])
    for (const s of sessions) if (s.kind === 'dir') cleared += await sweepSession($, `${root}/${s.name}`, since)
  }
  cache.clear()

  return cleared
}
