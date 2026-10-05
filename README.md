# visible-compact

A Claude Code mod that shows what a compaction actually did. The **Your last compact** pane puts the compacted result (after) next to the conversation that was sent to be compacted (before).

## What it does

- **On `/compact`** it records what went in and what came back, then opens **Your last compact** on it.
- **Auto-compactions and subagent compactions** are recorded too. They don't open the pane, but they show up in its picker.
- **`/show-last-compact`** reopens the pane on the newest compaction.

## The pane

- **Picker:** every compaction in this session, newest first, labelled with time, main or subagent, trigger, and tokens before → after.
- **View toggle (top right):** `◧` after only, `◫` both, `◨` before only (hotkeys `a`, `s`, `b`). The buttons sit in the same order as the columns: after on the left, before on the right. When the pane is narrower than 80 columns, "both" stacks after above before.
- **Summary line:** trigger, time, how long it took, tokens before → after, message counts, and the summarizer's token usage when reported.
- **Chunks:** each message is split into chunks of at most 4,000 characters. Splits fall at paragraph breaks where possible, then at line breaks, then at spaces. Each chunk is labelled with its role, message number and part. Tool calls are shown with their inputs, and tool results in full.
- **Paging:** each column shows 10 chunks per page. Use `‹ ›` to page: hotkeys `h`/`l` for after, `p`/`n` for before.

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
```

Layout:

- `.claude-plugin/plugin.json`: manifest
- `hooks/register.tsx`: hooks, storage and the pane
- `hooks/chunk.ts`: message flattening and paragraph-aware chunking
- `types/index.d.ts`: shared types and the `$.state` contract
