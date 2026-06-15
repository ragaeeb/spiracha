# spiracha

<p align="center">
  <img src="apps/ui/public/icon.svg" alt="Spiracha icon" width="96" height="100">
</p>

[![npm version](https://img.shields.io/npm/v/spiracha?label=npm)](https://www.npmjs.com/package/spiracha)
[![downloads](https://img.shields.io/npm/dm/spiracha?label=downloads)](https://www.npmjs.com/package/spiracha)
[![license](https://img.shields.io/npm/l/spiracha)](LICENSE.md)
[![runtime](https://img.shields.io/badge/runtime-Bun-000000?logo=bun)](https://bun.sh)
[![wakatime](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/f035d5e2-fa44-4383-913b-53c2c326d8a7.svg)](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/f035d5e2-fa44-4383-913b-53c2c326d8a7)

Export local Codex, Claude Code, and Cursor transcripts to Markdown or plain text, and inspect or export Codex, Claude Code, Kiro, Cursor, Antigravity, and OpenCode history through a browser UI.

## Quick Start

For repo-local development:

```bash
rtk bun start
rtk bun run ui:dev
```

Published package usage, once the package is available on npm:

```bash
rtk bunx spiracha
rtk bunx spiracha ui
rtk bunx spiracha claude /path/to/session-export.jsonl --output-format txt
rtk bunx spiracha cursor list
```

## Features

- Export Codex session transcripts from local `.codex` history
- Export Cursor Agent/Composer threads from local Cursor storage
- Browse Codex, Claude Code, Kiro, Cursor, Antigravity, and OpenCode history in a TanStack Start UI
- Inspect Codex thread timelines, tool calls, thread metadata, and raw event context
- Inspect Claude Code project workspaces, dedicated session detail pages, reasoning/tool calls, token metadata, and export sessions directly from local `~/.claude/projects` JSONL files
- Inspect Kiro workspace inventories, dedicated session detail pages, image attachments, prompt logs, execution-derived tool calls, and export sessions
- Inspect Cursor workspace inventories, dedicated thread detail pages, recover split storage buckets, and export or delete workspace threads
- Inspect Antigravity workspaces, dedicated conversation detail pages, unlock transcript export through macOS Keychain, and export conversation transcripts or generated artifacts
- Inspect OpenCode project workspaces, dedicated session detail pages, reasoning/tool parts, MiniMax `<think>` blocks, token metadata, and export sessions
- Delete threads or derived projects from the Codex SQLite database after confirmation
- Download thread exports directly from the UI as Markdown, plain text, or optional zip archives, with optional metadata, commentary, and tool-call inclusion
- Keep source-specific assistant commentary hidden by default while still showing final answers, with matching export filtering for Claude Code, Kiro, and OpenCode
- View dashboard and analytics summaries, including token totals and tool-call frequency
- Filter Codex exports by:
  - exact `cwd`
  - project basename via `--project`
  - specific thread deeplinks like `codex://threads/<id>`
- Include command logs with `--tools`
- Write Markdown or real plain-text output with `--output-format md|txt`
- Export Claude Code transcript `.jsonl` files or export directories
- Export, recover, and prune Cursor chat history from the CLI
- Run the same export flows through an MCP server and a local Codex plugin

## Install

```bash
rtk bun install
```

For package use after publish, no local install is required:

```bash
rtk bunx spiracha --help
rtk bunx spiracha ui --help
```

## Usage

### Codex exports

Package entrypoint:

```bash
rtk bunx spiracha [options] [codex://threads/<id> ...]
rtk bunx spiracha codex [options] [codex://threads/<id> ...]
```

With no arguments, `spiracha` starts in interactive mode and asks what you want to export.

Examples:

```bash
rtk bunx spiracha
rtk bunx spiracha --interactive
rtk bunx spiracha --project summer
rtk bunx spiracha --tools --project summer
rtk bunx spiracha codex://threads/019da28f-ee5b-7881-afe0-68b3d3bd2c77
rtk bunx spiracha codex://threads/019da28f-ee5b-7881-afe0-68b3d3bd2c77 --output-format txt
rtk bunx spiracha --cwd ~/workspace/reversed/summer --flat
rtk bunx spiracha codex://threads/<thread-id> --no-metadata
```

Important flags:
- no args: start interactive mode
- `--interactive`: force the interactive prompt flow
- `--project <name>`: matches the final `cwd` path segment for both POSIX and Windows-style paths
- `--cwd <path>`: exact cwd match
- `--tools`: include `exec_command` call logs and summaries
- `--no-metadata`: omit the metadata section from the top of each export
- `--flat`: write files into a single output folder
- `--output-format md|txt`: output as Markdown or plain text

### Browser UI

```bash
rtk bunx spiracha ui
```

This launches the packaged production UI server, opens your browser by default, and keeps running in the foreground.
Large download bundles are written to a Spiracha-managed directory under your OS temp folder and served directly by the UI server, so packaged `rtk bunx spiracha ui` exports do not depend on your current working directory.

Useful flags:
- `--port <port>`: bind a specific port, default `3000`
- `--host <host>`: bind a specific host, default `127.0.0.1`
- `--db <path>`: override the Codex SQLite path used by the UI
- `--no-open`: do not open the browser automatically

The UI currently includes:
- a Codex inventory and derived-project detail flow
- a Claude Code workspace inventory, workspace-session listing, and standalone session detail flow
- a Kiro workspace inventory, workspace-session listing, and standalone session detail flow
- a Cursor workspace inventory, workspace-thread listing, and standalone thread detail flow
- an Antigravity workspace inventory, conversation listing, and standalone conversation detail flow
- an OpenCode workspace inventory, session listing, and standalone session detail flow
- a Codex dashboard, Codex thread detail view, and Codex analytics page

Transcript detail pages use the same compact controls across sources: show or hide user messages, commentary, tool calls, extra events, and raw JSON. Claude Code uses `stop_reason` to distinguish tool-use lead-ins from final answers. Kiro uses execution traces for assistant commentary/tool calls and keeps the final assistant response for each user turn visible. OpenCode strips MiniMax `<think>` blocks into commentary, preserves literal `<think>` examples inside Markdown code, and uses the final visible assistant text in each assistant run as the final answer.

Default browser UI data locations:

| Source | Default location | Primary override |
| --- | --- | --- |
| Codex | shared Codex DB probe list | `SPIRACHA_CODEX_DB` |
| Claude Code | `~/.claude/projects` | `SPIRACHA_CLAUDE_CODE_PROJECTS_DIR` |
| Kiro | `~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent/workspace-sessions` | `SPIRACHA_KIRO_WORKSPACE_SESSIONS_DIR` |
| OpenCode | `${XDG_DATA_HOME:-~/.local/share}/opencode/opencode.db` | `SPIRACHA_OPENCODE_DB` |
| Export downloads | OS temp directory under `spiracha-ui-exports` | `SPIRACHA_UI_EXPORT_DIR` |

Codex inventory search and analytics project filters are stored in route search params, so filtered views can be bookmarked or reloaded. `/projects` and `/projects/$project` use `q`, and `/analytics` uses `project`.

Analytics cache keys are derived from Codex DB row metadata instead of statting every rollout file. This avoids large per-rollout stat storms on big histories and lets cached analytics resolve without touching transcript files. The hard tradeoff is that manual JSONL edits outside Codex do not invalidate analytics unless the corresponding DB row metadata changes or the temp UI cache is cleared. Transcript analytics parsing uses a bounded worker pool; tune it with `SPIRACHA_ANALYTICS_TRANSCRIPT_CONCURRENCY` when benchmarking large datasets.

The thread detail page also supports a direct UUID shortcut route. Pasting `http://localhost:3000/<thread-id>` redirects to `/threads/<thread-id>`.

Notable UI routes:
- `/projects` and `/projects/$project` for Codex inventory and project threads
- `/threads/$threadId` for Codex thread detail
- `/claude-code` and `/claude-code/$workspaceKey` for Claude Code workspace inventory and session lists
- `/claude-code-sessions/$sessionId` for Claude Code session detail
- `/kiro` and `/kiro/$workspaceKey` for Kiro workspace inventory and session lists
- `/kiro-sessions/$sessionId` for Kiro session detail
- `/cursor` and `/cursor/$workspaceKey` for Cursor workspace inventory and thread lists
- `/cursor-threads/$composerId` for Cursor thread detail
- `/antigravity` and `/antigravity/$workspaceKey` for Antigravity workspace inventory and conversation lists
- `/antigravity-conversations/$conversationId` for Antigravity conversation detail
- `/opencode` and `/opencode/$workspaceKey` for OpenCode workspace inventory and session lists
- `/opencode-sessions/$sessionId` for OpenCode session detail

Examples:

```bash
rtk bunx spiracha ui
rtk bunx spiracha ui --port 43123 --no-open
rtk bunx spiracha ui --db ~/.codex/state_5.sqlite
```

Stop the UI with `Ctrl+C`.

### Claude exports

```bash
rtk bunx spiracha claude <input-path> [options]
```

Examples:

```bash
rtk bunx spiracha claude /path/to/session.jsonl
rtk bunx spiracha claude /path/to/export-dir --tools
rtk bunx spiracha claude /path/to/export-dir --output-format txt
```

Repo-local equivalents remain available during development:

```bash
rtk bun start
rtk bun start --interactive
rtk bun start ...
rtk bun run export:claude -- ...
```

Legacy aliases remain available for compatibility:

```bash
rtk bunx codex-chats
rtk bunx codex-chats-claude
```

### Cursor exports

```bash
rtk bunx spiracha cursor <subcommand> [options]
```

Examples:

```bash
rtk bunx spiracha cursor list
rtk bunx spiracha cursor list --query summer
rtk bunx spiracha cursor export --workspace summer --output-dir ./cursor-exports
rtk bunx spiracha cursor export --thread <composer-id> --output-format txt
rtk bunx spiracha cursor recover --workspace summer --apply
rtk bunx spiracha cursor prune --workspace summer --apply
```

Repo-local equivalent during development:

```bash
rtk bun run ./src/export-cursor.ts --help
```

Claude Code direct-history browsing, Kiro browsing/export, Antigravity, and OpenCode conversation browsing/export currently live in the browser UI rather than standalone CLI subcommands.

## MCP server

Run the MCP server with:

```bash
rtk bun run mcp
```

Exposed tools:
- `export_codex_chats`
- `export_claude_transcript`

The local plugin lives in [plugins/codex-chats-export](plugins/codex-chats-export) and is registered through [plugins/codex-chats-export/.mcp.json](plugins/codex-chats-export/.mcp.json).

## Development

Useful commands:

```bash
rtk bun test
rtk bun run lint
rtk bun run typecheck
rtk bun run build
rtk bun run coverage
rtk bun run ui:dev
rtk bun run --cwd apps/ui test
rtk bun run test:perf
rtk bun start
rtk bun start --interactive
rtk bun start -- --help
rtk bun run export:claude -- --help
rtk bun run mcp
```

Packed-tarball smoke test before publishing:

```bash
rtk bun pm pack
package_tgz="$PWD/spiracha-<version>.tgz"
tmp_dir=$(mktemp -d)
cd "$tmp_dir"
printf '{"name":"codex-chats-smoke","private":true}\n' > package.json
rtk bun add "$package_tgz"
rtk bunx --package "$package_tgz" spiracha --help
rtk bunx --package "$package_tgz" spiracha ui --help
rtk bunx --package "$package_tgz" spiracha claude --help
rtk bunx --package "$package_tgz" codex-chats --help
rtk bunx --package "$package_tgz" codex-chats-claude --help
```

For the exact packaged UI launch path, run:

```bash
rtk bun run smoke:package-ui
```

This builds the app, packs a fresh tarball in a clean temp directory, launches `rtk bunx --package <tgz> spiracha ui --no-open`, probes the running UI for real SSR HTML, rejects Bun fallback responses, and shuts it down. The same packaged-path smoke is also covered by `src/package-ui-smoke.test.ts`.

## Project Layout

- `apps/ui/`: TanStack Start browser app for Codex, Claude Code, Kiro, Cursor, Antigravity, and OpenCode browsing plus export and delete flows
- `src/export-chats.ts`: Codex CLI wrapper
- `src/export-claude.ts`: Claude CLI wrapper
- `src/export-cursor.ts`: Cursor CLI wrapper
- `src/mcp-server.ts`: MCP server entrypoint
- `src/lib/antigravity-*.ts`: Antigravity workspace discovery, transcript rendering, and Keychain helpers
- `src/lib/codex-exporter-*.ts`: Codex exporter modules
- `src/lib/codex-browser-*.ts`: shared browser/UI data, analytics, and export helpers
- `src/lib/codex-thread-*.ts`: structured transcript parsing and caching helpers
- `src/lib/concurrency.ts`: shared bounded-concurrency helper for large transcript and DB workloads
- `src/lib/claude-code-*.ts`: Claude Code local project/session discovery, assistant phase classification, and transcript rendering helpers
- `src/lib/kiro-*.ts`: Kiro workspace/session discovery, execution-trace enrichment, assistant phase classification, and transcript rendering helpers
- `src/lib/claude-exporter.ts`: Claude exporter implementation
- `src/lib/cursor-*.ts`: Cursor discovery, transcript rendering, recovery, and CLI helpers
- `src/lib/opencode-*.ts`: OpenCode project/session discovery, MiniMax think-tag handling, assistant phase classification, and transcript rendering helpers
- `src/lib/ui-export-archive.ts` and `src/lib/ui-export-files.ts`: browser download filename, MIME type, zip archive, temp file, and URL helpers
- `plugins/codex-chats-export/`: local Codex plugin bundle

## Testing

The test suite includes:
- Codex exporter end-to-end coverage
- Claude exporter end-to-end coverage
- Claude Code direct-history discovery and export coverage
- Kiro workspace session discovery and export coverage
- source-specific assistant commentary/final-answer classification and export filtering coverage
- Cursor exporter and recovery coverage
- Antigravity discovery and export coverage
- OpenCode discovery and export coverage
- OpenCode MiniMax `<think>` extraction coverage, including literal tags in Markdown code
- Codex CLI helper tests
- transcript rendering helper tests
- route search parsing and bounded concurrency tests
- MCP stdio protocol round-trip tests
- local packaging should be smoke-tested with a packed tarball before publishing
- packaged source manifests are checked for UI server helper files used at runtime

Coverage enforcement:
- `rtk bun run coverage:root` checks the root Bun unit-test surface at a minimum of 90% line coverage.
- `rtk bun run coverage:ui` checks the UI unit-test surface at a minimum of 90% line coverage.
- `rtk bun run coverage` runs both checks.

Run:

```bash
rtk bun test
```
