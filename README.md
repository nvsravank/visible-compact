# visible-compact

A Claude Code mod that shows what `/compact` actually did: the conversation that was sent for compaction and the compacted result, side by side in a pane.

## What it does

- **On `/compact`** it hooks `session.compact`, records the transcript going in and the messages coming back (plus token counts and any instructions you gave), and opens the **Your last compact** pane.
- **Auto-compactions** are recorded too, but don't pop the pane open.
- **`/show-last-compact`** reopens the pane for the most recent compaction in this session.

The two sides sit next to each other when the pane is at least 80 columns wide and stack otherwise. Each message is capped at 4,000 characters. Subagent compactions and precomputed (speculative) compactions are ignored.

## Install

Point Claude Code at this folder:

```sh
claude --plugin-dir /path/to/visible-compact
```

## Develop

```sh
claude plugin validate .   # manifest + hooks check
claude plugin test .       # runs tests/*.test.ts
```

Layout:

- `.claude-plugin/plugin.json` — manifest
- `hooks/hooks.json`, `hooks/register.tsx` — the hooks module
- `types/index.d.ts` — the `$.state` contract
- `tests/` — tests for `claude plugin test`
