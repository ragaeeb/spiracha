# AGENTS.md

## Purpose

This repo exports local Codex chats, Claude Code transcripts, and Cursor Agent/Composer threads to Markdown or plain text, and the UI also browses local Antigravity conversation history.

Main entrypoints:
- `bun start ...` for Codex chat export
- `bun start` for interactive export mode
- `bun run export:claude -- ...` for Claude transcript export
- `bun run ./src/export-cursor.ts ...` (or `spiracha cursor ...`) for Cursor thread export, recovery, and prune
- `bun run mcp` for the MCP server used by the local Codex plugin
- `bun run ui:dev` for the local browser UI across Codex, Cursor, and Antigravity data
- published package entrypoints:
  - `bunx spiracha`
  - `bunx spiracha ui`
  - `bunx spiracha claude ...`
  - legacy aliases retained:
    - `bunx codex-chats`
    - `bunx codex-chats-claude`

## Conventions and Rules

- Always use `bun` and `bunx`, HARD BAN on: `npm` unless absolutely necessary.
- Prefer `Bun.file()` instead of `fs` whenever possible.
- Kill any browser instance you start or stray `bun`, `node` processes after you are done. Never leave it running.
- Prefer arrow functions to classical functions, and `type` over `interface` in TS.
- Fixes are made using TDD approach.
- `bun format` and `bun typecheck` should always be ran at the end of your completion, if you introduced any warnings or errors clean them up yourself before you complete.
- NEVER disable a biome rule or TS rule without explicit permission from the user.
- If you believe the code you are changing requires some clarification for future AI agents to understand why the change was made, add a brief comment.
- Do NOT use decorative section headers made of repeated characters (e.g. `// -----`, `// =====`, etc.).
- Use `it('should...')` style tests.
- Unit-tests always live in the same folder as their implementation, never in the `test` folder.

## Working Rules

- Use `rtk` as the default wrapper for shell commands that produce meaningful stdout or stderr.
- Prefer `bun test` for verification. Run it after non-trivial changes.
- Run `bun run lint` in addition to `bun test` and `bun run typecheck` before completion.
- When changing package/distribution behavior, also run a local packed-tarball smoke test.
- When changing the interactive flow, validate it in a real TTY session; piped stdin is not a reliable substitute.
- When changing the UI package, validate it in a browser after the build or dev server is up.
- Use `apply_patch` for manual edits.
- Keep output compatibility stable. The exported transcript format is user-facing.
- Preserve the behavior of existing flags unless the task explicitly changes CLI semantics.

## Architecture

Codex exporter modules:
- `src/lib/codex-exporter.ts`
  - top-level orchestration and public barrel exports
- `src/lib/codex-exporter-cli.ts`
  - CLI parsing, help text, deeplink parsing, default output-dir resolution
- `src/lib/codex-exporter-db.ts`
  - SQLite queries, fallback session discovery, filter matching, export target construction
- `src/lib/codex-exporter-transcript.ts`
  - JSONL transcript parsing, metadata extraction, message/tool rendering
- `src/lib/codex-exporter-types.ts`
  - shared Codex exporter types and default path constants

Cursor exporter modules:
- `src/export-cursor.ts`
  - CLI runner with `list`, `export`, `recover`, and `prune` subcommands
- `src/lib/cursor-exporter.ts`
  - export orchestration, CLI parsing, and help text
- `src/lib/cursor-db.ts`
  - workspace storage bucket discovery, grouping, thread/bubble reads from the global store
- `src/lib/cursor-recovery.ts`
  - re-links lost threads into the active workspace bucket and prunes threads (destructive)
- `src/lib/cursor-transcript.ts`
  - renders Cursor bubbles (user, assistant, reasoning, tool calls) to Markdown or TXT
- `src/lib/cursor-exporter-types.ts`
  - shared Cursor types and macOS Cursor data-dir path resolution (`SPIRACHA_CURSOR_USER_DIR` override)

Antigravity browser/export modules:
- `src/lib/antigravity-db.ts`
  - Antigravity workspace discovery, summary-index parsing, transcript lookup, and Markdown rendering
- `src/lib/antigravity-exporter-types.ts`
  - shared Antigravity workspace and conversation types plus default data-dir resolution
- `src/lib/antigravity-keychain.ts`
  - macOS Keychain access and safe-storage decryption helpers for Antigravity transcript export

Other important files:
- `src/lib/claude-exporter.ts`
  - Claude transcript export pipeline
- `src/lib/codex-browser-db.ts`
  - project/thread browsing queries, delete flows, dashboard summaries, DB path resolution
- `src/lib/codex-browser-export.ts`
  - UI-facing thread export download rendering
- `src/lib/codex-thread-parser.ts`
  - structured Codex event parsing used by analytics and the UI
- `src/lib/codex-analytics.ts`
  - token/tool analytics derived from thread rows plus parsed transcripts
- `src/lib/ui-cache.ts`
  - temporary cache under `os.tmpdir()` for transcript and analytics lookups
- `src/mcp-server.ts`
  - MCP server exposing `export_codex_chats` and `export_claude_transcript`
- `plugins/codex-chats-export/`
  - local Codex plugin manifest, skill, and MCP wiring
- `apps/ui/`
  - TanStack Start browser UI package for Codex, Cursor, and Antigravity

## Test Strategy

Current tests cover:
- exporter end-to-end behavior for Codex and Claude
- Cursor export, recovery, and pruning behavior
- Antigravity discovery, transcript parsing, and artifact export rendering
- structured Codex transcript parsing
- project/thread browsing and destructive DB flows
- analytics aggregation
- browser-export rendering helpers
- Codex CLI parsing helpers
- interactive-mode inference helpers
- transcript formatting helpers
- MCP stdio protocol round-trips using the real server process
- wrapped UI Vitest suite via `src/ui-package.test.ts`
- type-checking via `bun run typecheck`

When changing risky areas:
- CLI changes: update/add tests in `src/lib/codex-exporter-cli.test.ts`
- transcript parsing/rendering: update/add tests in `src/lib/codex-exporter-transcript.test.ts`
- structured transcript parsing/UI event extraction: update/add tests in `src/lib/codex-thread-parser.test.ts`
- DB/filter/target logic: prefer focused unit tests against `src/lib/codex-exporter-db.ts`
- project/thread browsing, delete semantics, and analytics: update/add tests in `src/lib/codex-browser-db.test.ts` and `src/lib/codex-analytics.test.ts`
- MCP contract changes: update `src/mcp-server.test.ts`
- UI component behavior: update/add Vitest files under `apps/ui/src/**/*.vitest.tsx`

## Common Commands

```bash
rtk bun test
rtk bun run lint
rtk bun run typecheck
rtk bun run build
rtk bun run coverage
rtk bun run smoke:package-ui
rtk bun run test:perf
rtk bun start
rtk bun start -- --help
rtk bun start --interactive
rtk bun run export:claude -- --help
rtk bun run ./src/export-cursor.ts -- --help
rtk bun run mcp
rtk bun run ui:dev
```

Packed tarball smoke test:

```bash
rtk bun pm pack
package_tgz="$PWD/spiracha-<version>.tgz"
tmp_dir=$(mktemp -d)
cd "$tmp_dir"
printf '{"name":"codex-chats-smoke","private":true}\n' > package.json
rtk bun add "$package_tgz"
rtk bunx spiracha --help
rtk bunx spiracha ui --help
rtk bunx spiracha claude --help
rtk bunx codex-chats --help
rtk bunx codex-chats-claude --help
rtk bun run smoke:package-ui
```

Example Codex export:

```bash
rtk bunx spiracha
rtk bunx spiracha codex://threads/<thread-id> --no-metadata
rtk bun start --tools --project summer
rtk bun start codex://threads/<thread-id> --output-format txt
```

Example Claude export:

```bash
rtk bunx spiracha claude /path/to/transcript --output-format txt
rtk bun run export:claude -- /path/to/export-dir --output-format txt
```

Example Cursor export:

```bash
rtk bunx spiracha cursor list
rtk bunx spiracha cursor export --workspace summer
rtk bunx spiracha cursor export --thread <composer-id> --output-format txt
rtk bunx spiracha cursor recover --workspace summer --apply
```

## Notes

- `--project` matches the final `cwd` path segment for both POSIX and Windows-style paths, not the full path.
- Running `codex-chats` or `bun start` with no args enters interactive mode.
- Codex MCP exports must be scoped by at least one of `deeplinks`, `project`, or `cwd`.
- Antigravity browsing/export currently ships through the browser UI rather than a standalone CLI command.
- `txt` output is intentionally real plain text, not Markdown with a `.txt` extension.
- The published package is Bun-first. `bin` entrypoints target Bun shebang execution.
- The UI package runs `vite` through `bun --bun ...` because its server functions depend on Bun-only modules like `bun:sqlite`.
- `apps/ui/src/routeTree.gen.ts` is generated and should not be manually edited or lint-formatted.
