# AGENTS.md

## Purpose

This repo exports local Codex chats and Claude Code transcripts to Markdown or plain text.

Main entrypoints:
- `bun start ...` for Codex chat export
- `bun start` for interactive export mode
- `bun run export:claude -- ...` for Claude transcript export
- `bun run mcp` for the MCP server used by the local Codex plugin
- published package goal:
  - `bunx codex-chats`
  - `bunx codex-chats ...`
  - `bunx codex-chats-claude ...`

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
- When changing package/distribution behavior, also run a local packed-tarball smoke test.
- When changing the interactive flow, validate it in a real TTY session; piped stdin is not a reliable substitute.
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

Other important files:
- `src/lib/claude-exporter.ts`
  - Claude transcript export pipeline
- `src/mcp-server.ts`
  - MCP server exposing `export_codex_chats` and `export_claude_transcript`
- `plugins/codex-chats-export/`
  - local Codex plugin manifest, skill, and MCP wiring

## Test Strategy

Current tests cover:
- exporter end-to-end behavior for Codex and Claude
- Codex CLI parsing helpers
- interactive-mode inference helpers
- transcript formatting helpers
- MCP stdio protocol round-trips using the real server process
- type-checking via `bun run typecheck`

When changing risky areas:
- CLI changes: update/add tests in `src/lib/codex-exporter-cli.test.ts`
- transcript parsing/rendering: update/add tests in `src/lib/codex-exporter-transcript.test.ts`
- DB/filter/target logic: prefer focused unit tests against `src/lib/codex-exporter-db.ts`
- MCP contract changes: update `src/mcp-server.test.ts`

## Common Commands

```bash
rtk bun test
rtk bun run typecheck
rtk bun run build
rtk bun run test:perf
rtk bun start
rtk bun start -- --help
rtk bun start --interactive
rtk bun run export:claude -- --help
rtk bun run mcp
```

Packed tarball smoke test:

```bash
rtk bun pm pack
package_tgz="$PWD/codex-chats-<version>.tgz"
tmp_dir=$(mktemp -d)
cd "$tmp_dir"
printf '{"name":"codex-chats-smoke","private":true}\n' > package.json
rtk bun add "$package_tgz"
rtk bunx codex-chats --help
rtk bunx codex-chats-claude --help
```

Example Codex export:

```bash
rtk bunx codex-chats
rtk bunx codex-chats codex://threads/<thread-id> --optimized
rtk bun start --tools --project summer
rtk bun start codex://threads/<thread-id> --output-format txt
```

Example Claude export:

```bash
rtk bunx codex-chats-claude /path/to/transcript --output-format txt
rtk bun run export:claude -- /path/to/export-dir --output-format txt
```

## Notes

- `--project` matches the final `cwd` path segment for both POSIX and Windows-style paths, not the full path.
- Running `codex-chats` or `bun start` with no args enters interactive mode.
- Codex MCP exports must be scoped by at least one of `deeplinks`, `project`, or `cwd`.
- `txt` output is intentionally real plain text, not Markdown with a `.txt` extension.
- The published package is Bun-first. `bin` entrypoints target Bun shebang execution.
