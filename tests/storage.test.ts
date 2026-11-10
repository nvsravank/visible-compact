import type { FsEntry, On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.now()
const TEMP = '/tmp/x/visible-compact/sessions'
const HOME = '/home/u/.claude/visible-compact/sessions'

type File = { text: string; mtimeMs: number }

/** A file system in memory under the test's `on`; directories are implied by paths. */
const memoryFs = (on: On, files: Record<string, File>) => {
  on('fs.read', async (_$, e) => {
    const file = files[e.path]
    if (file === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: file.text }
  })
  on('fs.write', async (_$, e) => {
    files[e.path] = { text: e.text, mtimeMs: NOW }
    return { value: undefined }
  })
  on('fs.exists', async (_$, e) => ({
    value: Object.keys(files).some(p => p === e.path || p.startsWith(`${e.path}/`)),
  }))
  on('fs.list', async (_$, e) => {
    const prefix = `${e.path}/`
    const entries = new Map<string, FsEntry>()
    for (const [path, file] of Object.entries(files)) {
      if (!path.startsWith(prefix)) continue
      const [name, ...rest] = path.slice(prefix.length).split('/')
      entries.set(
        name!,
        rest.length > 0
          ? { name: name!, kind: 'dir', size: 0, mtimeMs: 0, isLink: false }
          : { name: name!, kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs, isLink: false },
      )
    }
    if (entries.size === 0) throw new Error(`ENOENT: ${e.path}`)
    return { value: [...entries.values()] }
  })

  return files
}

const logs: string[] = []

const setup = (on: On, cleanupPeriodDays: unknown, files: Record<string, File>) => {
  logs.length = 0
  mock.env(on, { TMPDIR: '/tmp/x/', HOME: '/home/u' })
  on('settings.read', async () => ({ value: (cleanupPeriodDays === undefined ? {} : { cleanupPeriodDays }) as never }))
  on('session.id', async () => ({ value: 'current' }))
  on('ui.log', async (_$, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  return memoryFs(on, files)
}

/** Ends the session, which runs the plugin's cleanup. */
const endSession = async ($: Engine) => {
  await $.session.end({ reason: 'other', sessionId: 'current' } as never)
  expect(logs.filter(l => l.includes('failed'))).toEqual([])
}


const meta = (id: string, at: number) => ({ id, at, durationMs: 1, trigger: 'manual', messages: {}, chunks: {} })

const secret = '[{"text":"secret"}]'

/** One compaction recorded `daysAgo`, with one chunk file. */
const oneCompaction = (session: string, id: string, daysAgo: number): Record<string, File> => {
  const at = NOW - daysAgo * DAY
  return {
    [`${TEMP}/${session}/index.json`]: { text: JSON.stringify([meta(id, at)]), mtimeMs: at },
    [`${TEMP}/${session}/${id}.before.0.json`]: { text: secret, mtimeMs: at },
  }
}

describe('retention', () => {
  test('cleanupPeriodDays unset keeps 30 days', async ($, on) => {
    const files = setup(on, undefined, { ...oneCompaction('s1', 'a', 20), ...oneCompaction('s2', 'b', 40) })
    await endSession($)
    expect(files[`${TEMP}/s1/a.before.0.json`]!.text).toBe(secret)
    expect(files[`${TEMP}/s2/b.before.0.json`]!.text).toBe('')
    expect(files[`${TEMP}/s2/index.json`]!.text).toBe('')
  })

  test('an invalid cleanupPeriodDays is treated as 30', async ($, on) => {
    const files = setup(on, 'soon', { ...oneCompaction('s1', 'a', 20), ...oneCompaction('s2', 'b', 40) })
    await endSession($)
    expect(files[`${TEMP}/s1/a.before.0.json`]!.text).toBe(secret)
    expect(files[`${TEMP}/s2/b.before.0.json`]!.text).toBe('')
  })

  test('cleanupPeriodDays from settings sets the period', async ($, on) => {
    const files = setup(on, 10, oneCompaction('s1', 'a', 20))
    await endSession($)
    expect(files[`${TEMP}/s1/a.before.0.json`]!.text).toBe('')
  })

  test('expired compactions are cleared in every session and both locations', async ($, on) => {
    const old = NOW - 40 * DAY
    const fresh = NOW - 2 * DAY
    const files = setup(on, undefined, {
      // A session with one expired and one current compaction.
      [`${TEMP}/s1/index.json`]: { text: JSON.stringify([meta('a', old), meta('b', fresh)]), mtimeMs: fresh },
      [`${TEMP}/s1/a.before.0.json`]: { text: secret, mtimeMs: old },
      // Written a little after the compaction started, but expired with it by id.
      [`${TEMP}/s1/a.after.0.json`]: { text: secret, mtimeMs: fresh },
      [`${TEMP}/s1/b.before.0.json`]: { text: '[{"text":"keep"}]', mtimeMs: fresh },
      // A whole session expired, in the home location.
      [`${HOME}/s2/index.json`]: { text: JSON.stringify([meta('c', old)]), mtimeMs: old },
      [`${HOME}/s2/c.before.0.json`]: { text: secret, mtimeMs: old },
      // An old file an interrupted save left out of the index.
      [`${TEMP}/s3/d.before.0.json`]: { text: secret, mtimeMs: old },
    })
    await endSession($)

    expect(logs).toContain('visible-compact: cleared 6 expired file(s)')
    expect(files[`${TEMP}/s1/a.before.0.json`]!.text).toBe('')
    expect(files[`${TEMP}/s1/a.after.0.json`]!.text).toBe('')
    expect(files[`${TEMP}/s1/b.before.0.json`]!.text).toBe('[{"text":"keep"}]')
    expect(JSON.parse(files[`${TEMP}/s1/index.json`]!.text).map((m: { id: string }) => m.id)).toEqual(['b'])
    expect(files[`${HOME}/s2/index.json`]!.text).toBe('')
    expect(files[`${HOME}/s2/c.before.0.json`]!.text).toBe('')
    expect(files[`${TEMP}/s3/d.before.0.json`]!.text).toBe('')

    // A second sweep finds nothing left to clear.
    logs.length = 0
    await endSession($)
    expect(logs.some(l => l.includes('cleared'))).toBe(false)
  })

  test('cleanupPeriodDays 0 clears everything on disk', async ($, on) => {
    const files = setup(on, 0, oneCompaction('s1', 'a', 0.001))
    await endSession($)
    expect(Object.values(files).every(f => f.text === '')).toBe(true)
  })

  test('nothing saved yet is not an error', async ($, on) => {
    setup(on, undefined, {})
    await endSession($)
    expect(logs).toEqual([])
  })
})
