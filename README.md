# visible-compact

A Claude Code mod that shows what a compaction actually did. The **Your compaction history** pane puts the compacted result (after) next to the conversation that was sent to be compacted (before).

## What it does

- **On `/compact`** it records what went in and what came back, then opens **Your compaction history** on it.
- **Auto-compactions and subagent compactions** are recorded too. They don't open the pane, but they show up in its picker.
- **`/show-last-compact`** reopens the pane on the newest compaction.

## The pane

- **Picker:** every compaction in this session, newest first, labelled with time, main or subagent, and trigger.
- **View toggle (top right):** `◧ After`, `◫ Both`, `◨ Before`. The buttons sit in the same order as the columns: after on the left, before on the right. When the pane is narrower than 80 columns, "both" stacks after above before, with extra space above Before.
- **Theme (`☾`/`☀`):** plugins aren't told the app's light or dark theme, so pick it here. The choice is remembered across sessions.
- **Tokens line:** "Tokens reduced to X from Y", colored to match the After and Before headers, with how long the compaction took on the right.
- **Instructions:** the text typed after `/compact`, if any. The engine's own summary prompt isn't available to plugins.
- **Chunks:** each message is split into chunks of at most 4,000 characters. Splits fall at paragraph breaks where possible, then at line breaks, then at spaces. Each chunk is labelled with its role, message number and part. Tool calls are shown with their inputs, and tool results in full.
- **Paging:** each column shows 10 chunks per page. `‹ Previous` and `Next ›` sit in the column header and again at its bottom.

## Storage

Each compaction is saved under `<location>/visible-compact/sessions/<session id>/`. That folder holds an `index.json` plus the chunk files, at most 100 chunks per file. Because the folder is named after the session id, restarting Claude Code or using `--resume` keeps your compactions. `/clear` starts a new session id with nothing recorded.

The **Where compactions are saved** setting (`storage`) chooses the location:

- `temp` (default): the OS temp folder (`TMPDIR`, `TEMP` or `TMP`, else `/tmp`). The OS cleans it up for you. Linux usually wipes `/tmp` on reboot. macOS clears it on reboot and removes files left unused for about 3 days. Windows Storage Sense may clear it. Resuming an old session can therefore show an empty picker.
- `home`: `~/.claude/visible-compact`. Compactions are kept until you delete them, at roughly 4–5 MB for a 1M-token compaction.

Changing the setting doesn't move existing compactions. The picker lists only what's in the current location.

## Install

```sh
claude --plugin-dir /path/to/visible-compact
```

## Develop

```sh
claude plugin validate .
claude plugin test .
```

Layout:

- `.claude-plugin/plugin.json`: manifest
- `hooks/register.tsx`: hooks, storage and the pane
- `hooks/chunk.ts`: message flattening and paragraph-aware chunking
- `types/index.d.ts`: shared types and the `$.state` contract
- `tests/`: unit tests for the chunker
