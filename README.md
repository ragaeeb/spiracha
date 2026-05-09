# spiracha

[![npm version](https://img.shields.io/npm/v/spiracha?label=npm)](https://www.npmjs.com/package/spiracha)
[![downloads](https://img.shields.io/npm/dm/spiracha?label=downloads)](https://www.npmjs.com/package/spiracha)
[![license](https://img.shields.io/npm/l/spiracha)](LICENSE.md)
[![runtime](https://img.shields.io/badge/runtime-Bun-000000?logo=bun)](https://bun.sh)

Export local Codex chats and Claude Code transcripts to Markdown or plain text.

## Quick Start

For repo-local development:

```bash
bun start
```

Published package usage, once the package is available on npm:

```bash
bunx spiracha
bunx spiracha claude /path/to/session-export.jsonl --output-format txt
```

## Features

- Export Codex session transcripts from local `.codex` history
- Filter Codex exports by:
  - exact `cwd`
  - project basename via `--project`
  - specific thread deeplinks like `codex://threads/<id>`
- Include command logs with `--tools`
- Write Markdown or real plain-text output with `--output-format md|txt`
- Export Claude Code transcript `.jsonl` files or export directories
- Run the same export flows through an MCP server and a local Codex plugin

## Install

```bash
bun install
```

For package use after publish, no local install is required:

```bash
bunx spiracha --help
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
```

Important flags:
- no args: start interactive mode
- `--interactive`: force the interactive prompt flow
- `--project <name>`: matches the final `cwd` path segment for both POSIX and Windows-style paths
- `--cwd <path>`: exact cwd match
- `--tools`: include `exec_command` call logs and summaries
- `--optimized`: compact transcript output
- `--flat`: write files into a single output folder
- `--output-format md|txt`: output as Markdown or plain text

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

## MCP server

Run the MCP server with:

```bash
bun run mcp
```

Exposed tools:
- `export_codex_chats`
- `export_claude_transcript`

The local plugin lives in [plugins/codex-chats-export](~/workspace/codex-chats/plugins/codex-chats-export) and is registered through [plugins/codex-chats-export/.mcp.json](~/workspace/codex-chats/plugins/codex-chats-export/.mcp.json).

## Development

Useful commands:

```bash
bun test
bun run typecheck
bun run build
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
package_tgz="$PWD/codex-chats-<version>.tgz"
tmp_dir=$(mktemp -d)
cd "$tmp_dir"
printf '{"name":"codex-chats-smoke","private":true}\n' > package.json
bun add "$package_tgz"
bunx spiracha --help
bunx spiracha claude --help
bunx codex-chats --help
bunx codex-chats-claude --help
```

## Project Layout

- `src/export-chats.ts`: Codex CLI wrapper
- `src/export-claude.ts`: Claude CLI wrapper
- `src/mcp-server.ts`: MCP server entrypoint
- `src/lib/codex-exporter-*.ts`: Codex exporter modules
- `src/lib/claude-exporter.ts`: Claude exporter implementation
- `plugins/codex-chats-export/`: local Codex plugin bundle

## Testing

The test suite includes:
- Codex exporter end-to-end coverage
- Claude exporter end-to-end coverage
- Codex CLI helper tests
- transcript rendering helper tests
- MCP stdio protocol round-trip tests
- local packaging should be smoke-tested with a packed tarball before publishing

Run:

```bash
bun test
```
