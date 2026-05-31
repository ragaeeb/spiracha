# spiracha

[![npm version](https://img.shields.io/npm/v/spiracha?label=npm)](https://www.npmjs.com/package/spiracha)
[![downloads](https://img.shields.io/npm/dm/spiracha?label=downloads)](https://www.npmjs.com/package/spiracha)
[![license](https://img.shields.io/npm/l/spiracha)](LICENSE.md)
[![runtime](https://img.shields.io/badge/runtime-Bun-000000?logo=bun)](https://bun.sh)
[![wakatime](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/f035d5e2-fa44-4383-913b-53c2c326d8a7.svg)](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/f035d5e2-fa44-4383-913b-53c2c326d8a7)

Export local Codex, Claude Code, and Cursor transcripts to Markdown or plain text, and inspect Codex, Cursor, and Antigravity history through a browser UI.

## Quick Start

For repo-local development:

```bash
bun start
bun run ui:dev
```

Published package usage, once the package is available on npm:

```bash
bunx spiracha
bunx spiracha ui
bunx spiracha claude /path/to/session-export.jsonl --output-format txt
bunx spiracha cursor list
```

## Features

- Export Codex session transcripts from local `.codex` history
- Export Cursor Agent/Composer threads from local Cursor storage
- Browse Codex, Cursor, and Antigravity history in a TanStack Start UI
- Inspect Codex thread timelines, tool calls, thread metadata, and raw event context
- Inspect Cursor workspace inventories, recover split storage buckets, and export or delete workspace threads
- Inspect Antigravity workspaces, unlock transcript export through macOS Keychain, and export conversation transcripts or generated artifacts
- Delete threads or derived projects from the Codex SQLite database after confirmation
- Download thread exports directly from the UI as Markdown or plain text, with optional metadata, commentary, and tool-call inclusion
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
bun install
```

For package use after publish, no local install is required:

```bash
bunx spiracha --help
bunx spiracha ui --help
```

## Usage

### Codex exports

Package entrypoint:

```bash
bunx spiracha [options] [codex://threads/<id> ...]
bunx spiracha codex [options] [codex://threads/<id> ...]
```

With no arguments, `spiracha` starts in interactive mode and asks what you want to export.

Examples:

```bash
bunx spiracha
bunx spiracha --interactive
bunx spiracha --project summer
bunx spiracha --tools --project summer
bunx spiracha codex://threads/019da28f-ee5b-7881-afe0-68b3d3bd2c77
bunx spiracha codex://threads/019da28f-ee5b-7881-afe0-68b3d3bd2c77 --output-format txt
bunx spiracha --cwd ~/workspace/reversed/summer --flat
bunx spiracha codex://threads/<thread-id> --no-metadata
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
bunx spiracha ui
```

This launches the packaged production UI server, opens your browser by default, and keeps running in the foreground.
Large download bundles are written to a Spiracha-managed directory under your OS temp folder and served directly by the UI server, so packaged `bunx spiracha ui` exports do not depend on your current working directory.

Useful flags:
- `--port <port>`: bind a specific port, default `3000`
- `--host <host>`: bind a specific host, default `127.0.0.1`
- `--db <path>`: override the Codex SQLite path used by the UI
- `--no-open`: do not open the browser automatically

The UI currently includes:
- a Codex inventory and derived-project detail flow
- a Cursor workspace inventory and workspace-thread detail flow
- an Antigravity workspace inventory and conversation detail flow
- a Codex dashboard, Codex thread detail view, and Codex analytics page

The thread detail page also supports a direct UUID shortcut route. Pasting `http://localhost:3000/<thread-id>` redirects to `/threads/<thread-id>`.

Examples:

```bash
bunx spiracha ui
bunx spiracha ui --port 43123 --no-open
bunx spiracha ui --db ~/.codex/state_5.sqlite
```

Stop the UI with `Ctrl+C`.

### Claude exports

```bash
bunx spiracha claude <input-path> [options]
```

Examples:

```bash
bunx spiracha claude /path/to/session.jsonl
bunx spiracha claude /path/to/export-dir --tools
bunx spiracha claude /path/to/export-dir --output-format txt
```

Repo-local equivalents remain available during development:

```bash
bun start
bun start --interactive
bun start ...
bun run export:claude -- ...
```

Legacy aliases remain available for compatibility:

```bash
bunx codex-chats
bunx codex-chats-claude
```

### Cursor exports

```bash
bunx spiracha cursor <subcommand> [options]
```

Examples:

```bash
bunx spiracha cursor list
bunx spiracha cursor list --query summer
bunx spiracha cursor export --workspace summer --output-dir ./cursor-exports
bunx spiracha cursor export --thread <composer-id> --output-format txt
bunx spiracha cursor recover --workspace summer --apply
bunx spiracha cursor prune --workspace summer --apply
```

Repo-local equivalent during development:

```bash
bun run ./src/export-cursor.ts --help
```

Antigravity conversation browsing and export currently live in the browser UI rather than a standalone CLI subcommand.

## MCP server

Run the MCP server with:

```bash
bun run mcp
```

Exposed tools:
- `export_codex_chats`
- `export_claude_transcript`

The local plugin lives in [plugins/codex-chats-export](plugins/codex-chats-export) and is registered through [plugins/codex-chats-export/.mcp.json](plugins/codex-chats-export/.mcp.json).

## Development

Useful commands:

```bash
bun test
bun run lint
bun run typecheck
bun run build
bun run coverage
bun run ui:dev
cd apps/ui && bun run test
bun run test:perf
bun start
bun start --interactive
bun start -- --help
bun run export:claude -- --help
bun run mcp
```

Packed-tarball smoke test before publishing:

```bash
bun pm pack
package_tgz="$PWD/spiracha-<version>.tgz"
tmp_dir=$(mktemp -d)
cd "$tmp_dir"
printf '{"name":"codex-chats-smoke","private":true}\n' > package.json
bun add "$package_tgz"
bunx --package "$package_tgz" spiracha --help
bunx --package "$package_tgz" spiracha ui --help
bunx --package "$package_tgz" spiracha claude --help
bunx --package "$package_tgz" codex-chats --help
bunx --package "$package_tgz" codex-chats-claude --help
```

For the exact packaged UI launch path, run:

```bash
bun run smoke:package-ui
```

This builds the app, packs the tarball, launches `bunx --package <tgz> spiracha ui --no-open` from a clean temp directory, probes the running UI over HTTP, and shuts it down.

## Project Layout

- `apps/ui/`: TanStack Start browser app for Codex, Cursor, and Antigravity browsing plus export and delete flows
- `src/export-chats.ts`: Codex CLI wrapper
- `src/export-claude.ts`: Claude CLI wrapper
- `src/export-cursor.ts`: Cursor CLI wrapper
- `src/mcp-server.ts`: MCP server entrypoint
- `src/lib/antigravity-*.ts`: Antigravity workspace discovery, transcript rendering, and Keychain helpers
- `src/lib/codex-exporter-*.ts`: Codex exporter modules
- `src/lib/codex-browser-*.ts`: shared browser/UI data, analytics, and export helpers
- `src/lib/codex-thread-*.ts`: structured transcript parsing and caching helpers
- `src/lib/claude-exporter.ts`: Claude exporter implementation
- `src/lib/cursor-*.ts`: Cursor discovery, transcript rendering, recovery, and CLI helpers
- `plugins/codex-chats-export/`: local Codex plugin bundle

## Testing

The test suite includes:
- Codex exporter end-to-end coverage
- Claude exporter end-to-end coverage
- Cursor exporter and recovery coverage
- Antigravity discovery and export coverage
- Codex CLI helper tests
- transcript rendering helper tests
- MCP stdio protocol round-trip tests
- local packaging should be smoke-tested with a packed tarball before publishing

Coverage enforcement:
- `bun run coverage:root` checks the root Bun unit-test surface at a minimum of 90% line coverage.
- `bun run coverage:ui` checks the UI unit-test surface at a minimum of 90% line coverage.
- `bun run coverage` runs both checks.

Run:

```bash
bun test
```
