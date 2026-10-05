import { expect, test } from 'claude-code/testing'

import { toLines, toRecord } from '../hooks/register'

const PANE_PROPS = {
  title: 'Your last compact',
  isFocused: false,
  bodyColumns: 120,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

const BEFORE = [
  { role: 'user' as const, text: 'please refactor the parser', toolUses: [] },
  { role: 'assistant' as const, text: 'Done.', toolUses: [] },
]
const AFTER = [{ role: 'user' as const, text: 'Summary: the parser was refactored.', toolUses: [] }]

test('toLines flattens text, tool uses and tool results', async () => {
  const lines = toLines([
    { role: 'user', text: 'please refactor the parser', toolUses: [] },
    {
      role: 'assistant',
      text: 'Reading it.',
      toolUses: [{ tool_use_id: 't1', tool: 'Read', input: {} }],
    },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: 'boom', isError: true }] },
    { role: 'assistant', text: '', toolUses: [] },
  ])
  expect(lines).toEqual([
    { role: 'user', text: 'please refactor the parser' },
    { role: 'assistant', text: 'Reading it.\n[tool: Read]' },
    { role: 'user', text: '[result (error)] boom' },
  ])
})

test('toRecord keeps the messages sent and the compacted result', async () => {
  const record = toRecord(
    { trigger: 'manual', instructions: 'keep the plan', messages: BEFORE },
    { messages: AFTER, tokensBefore: 1200, tokensAfter: 80 },
    42,
  )
  expect(record).toEqual({
    at: 42,
    trigger: 'manual',
    instructions: 'keep the plan',
    tokensBefore: 1200,
    tokensAfter: 80,
    before: [
      { role: 'user', text: 'please refactor the parser' },
      { role: 'assistant', text: 'Done.' },
    ],
    after: [{ role: 'user', text: 'Summary: the parser was refactored.' }],
  })
})

test('toRecord ignores skips, precomputes and subagent compactions', async () => {
  expect(toRecord({ trigger: 'manual', messages: BEFORE }, { skip: 'blocked' }, 0)).toBeNull()
  expect(toRecord({ trigger: 'precompute', messages: BEFORE }, { messages: AFTER }, 0)).toBeNull()
  expect(toRecord({ trigger: 'auto', agentId: 'a1', messages: BEFORE }, { messages: AFTER }, 0)).toBeNull()
})

test('show-last-compact says so when nothing was compacted', async $ => {
  const ran = await $.command.run({
    command: 'show-last-compact',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  expect(JSON.stringify(ran)).toMatch(/No compaction recorded/)
})

test('the pane draws an empty state before any compaction', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'visible-compact',
      surface,
      component: 'Pane',
      requestId: 'visible-compact',
      props: PANE_PROPS,
    })
    expect(await ui.find({ type: 'Text', text: /No compaction recorded yet/ })).toBeDefined()
    await ui.unmount()
  }
})
