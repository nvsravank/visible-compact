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
- **Chunks:** each message is split into chunks of at most 4,000 characters. Splits fall at paragraph breaks where possible, then at line breaks, then at spaces. Each chunk is labelled with its role, message number and part, and drawn as Markdown, the way an assistant reply is. Tool calls are shown with their inputs, and tool results in full, both as code blocks so their line breaks and indents are kept. A code block is never split across chunks unless it is longer than one chunk; then each part repeats its fence.
- **Paging:** each column shows 10 chunks per page. `‹ Previous` and `Next ›` sit in the column header and again at its bottom.

## Storage

Each compaction is saved under `<location>/visible-compact/sessions/<session id>/`. That folder holds an `index.json` plus the chunk files, at most 100 chunks per file. Because the folder is named after the session id, restarting Claude Code or using `--resume` keeps your compactions. `/clear` starts a new session id with nothing recorded.

The **Where compactions are saved** setting (`storage`) chooses the location:

- `temp` (default): the OS temp folder (`TMPDIR`, `TEMP` or `TMP`, else `/tmp`).
- `home`: `~/.claude/visible-compact`, at roughly 4–5 MB for a 1M-token compaction.
- `memory`: nothing is written to disk. Compactions are kept only while Claude Code runs, and are gone when it exits, on `/clear`, or when the plugin reloads (for example after a settings change).

Type `temp`, `home` or `memory` for this setting. Any other value is treated as `temp`. Changing it doesn't move existing compactions; the picker lists only what's in the current location.

### Retention

Compactions are kept as long as Claude Code keeps its own transcripts: the `cleanupPeriodDays` setting in your Claude Code `settings.json`, or 30 days when it isn't set.

- **When:** at every session start and session end. The sweep at start catches anything a crash or a killed process left behind.
- **What:** every session's folder, not only the current one's, in both the temp and home locations, whichever `storage` is set now. Each compaction recorded more than `cleanupPeriodDays` ago is cleared, as is any of its files last written before then.
- **How:** the plugin API can't delete files, so each expired file is overwritten with nothing. No conversation text, summary or metadata remains. Empty files and the session-id folder names stay until the OS clears the temp folder or you delete them (see below).
- **`cleanupPeriodDays: 0`:** as Claude Code keeps no transcripts then, the plugin keeps nothing on disk. It clears everything already saved and uses `memory` storage whatever `storage` says.

With `temp`, the OS may also clear the folder sooner. Linux usually wipes `/tmp` on reboot, and macOS clears it on reboot and removes files left unused for about 3 days. Resuming an old session can therefore show an empty picker.

## Install (local)

```bash
claude --plugin-dir /path/to/visible-compact
```

For the Desktop app, add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json` (separate several folders with `:`), then restart the app.

## What it runs and changes

**It sends nothing anywhere.** The mod makes no network requests and runs no programs. It reads your conversation only when it is compacted, and shows it in its own pane.

**What it reads:**

- At each compaction: the messages sent to be compacted, the summary that came back, the token counts, how long it took, and any instructions you typed after `/compact`.
- The environment variables `TMPDIR`, `TEMP`, `TMP`, `HOME` and `USERPROFILE`, only to find the folders it saves to and clears. It reads no other variables, and no credentials.
- One Claude Code setting, `cleanupPeriodDays`, to know how long to keep compactions (see [Retention](#retention)).
- The names of running subagents, to label their compactions in the picker.

**What it writes:** a copy of each compaction, as JSON, under `<location>/visible-compact/sessions/<session id>/` (see [Storage](#storage)), unless `storage` is `memory`. When a copy expires, it overwrites those same files with nothing (see [Retention](#retention)). It writes nothing else on disk. It remembers your light/dark choice in Claude Code's plugin storage.

- These files are plain data that only this mod reads back, to draw its pane. No tool runs them or reads them as settings or instructions.
- It never writes a build, start-up, settings or instructions file.
- The path is built at run time, from the temp or home folder and the session id, so it can't be written as fixed text.

**Files it ships:** the only image is `.claude-plugin/icon.png`, the icon for the plugin directory. Nothing in the mod loads or runs it.

**How it hooks into Claude Code:**

- It adds the `/show-last-compact` command and answers only that command.
- On `session.compact` it lets the compaction run unchanged, then records the result. It never changes, skips or delays a compaction.
- It hooks `session.start` and `session.end` only to load and reset its own list and clear expired compactions, and passes both through unchanged.
- It doesn't watch tool calls or prompts, and never approves, blocks or alters anything.

**To remove what it leaves behind,** delete the `visible-compact` folder in your temp folder, and `~/.claude/visible-compact` if you ever used `home`. For example, on macOS or Linux: `rm -rf "${TMPDIR:-/tmp}/visible-compact" ~/.claude/visible-compact`; on Windows, `%TEMP%\visible-compact` and `%USERPROFILE%\.claude\visible-compact`.

## Platforms

Tested on macOS, in the terminal and the Desktop app. It is written to work on Linux and Windows too, but it has not been tested on Windows yet. If you try it there, please [open an issue](https://github.com/nvsravank/visible-compact/issues/new/choose) whether it works or not.

## Feedback

Bug reports and feature requests are welcome as [issues](https://github.com/nvsravank/visible-compact/issues/new/choose). This project doesn't accept pull requests; see [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems privately, as described in [SECURITY.md](SECURITY.md).

## Develop

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

Layout:

- `.claude-plugin/plugin.json`: manifest
- `.claude-plugin/icon.png`: directory icon
- `hooks/register.tsx`: hooks and the pane
- `hooks/storage.ts`: where compactions are saved, read back and cleared
- `hooks/chunk.ts`: message flattening and paragraph-aware chunking
- `types/index.d.ts`: shared types and the `$.state` contract
- `tests/`: unit tests for the chunker and for retention

The Claude Code function-hooks API is in early access and may change between releases.

## License

MIT. See [LICENSE](LICENSE).
