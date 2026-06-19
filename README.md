# spiracha

<p align="center">
  <img src="apps/ui/public/icon.svg" alt="Spiracha icon" width="96" height="100">
</p>

[![license](https://img.shields.io/npm/l/spiracha)](LICENSE.md)
[![runtime](https://img.shields.io/badge/runtime-Bun-000000?logo=bun)](https://bun.sh)

Spiracha is a local TanStack Start app for browsing and exporting agent conversation history from Codex, Claude Code, Kiro, Qoder, Cursor, Antigravity, and OpenCode.

The legacy CLI, MCP server, and Codex plugin surfaces have been removed in the 2.0 hard cut. Spiracha now exposes the UI and a stable local data API; client-specific workflows such as review collection belong in the client that calls the API.

## Quick Start

To run the packaged app:

```bash
bunx spiracha
```

Spiracha asks Vite for port 3000 and automatically uses the next available port when 3000 is occupied.

For repository development:

```bash
rtk bun install
rtk bun start
```

Open the local URL printed by Vite.

## What It Does

- Browse local conversations across Codex, Claude Code, Kiro, Qoder, Cursor, Antigravity, and OpenCode.
- Inspect source-specific detail pages with transcript, tool, reasoning, metadata, raw event, export, and delete flows where supported by the source.
- Export transcripts from the UI as Markdown, text, or zip bundles with source-specific commentary/final-answer filtering.
- Expose a stable API for local clients that need normalized conversation metadata and message payloads.
- Resolve Spiracha UI links and native source links into normalized `{ source, id }` references for cross-thread context lookup.

## Stable Data API

The API is served by the local UI server under `/api/v1`.

```bash
bunx spiracha
```

Common read endpoints:

```text
GET  /api/v1/sources
GET  /api/v1/conversations?cwd=/absolute/project&include_messages=true
POST /api/v1/conversation-query
GET  /api/v1/conversations/:source/:id
GET  /api/v1/conversations/:source/:id/export
GET  /api/v1/resolve?ref=<url-or-deeplink>
```

The default list selector is `last_final_answer`, which keeps `fgh --collect` style clients fast and small. Use `message_selector=all` when a client needs the full normalized thread.

Example:

```bash
curl 'http://localhost:3000/api/v1/conversations?cwd=/Users/me/workspace/fgh&include_messages=true'
```

Response envelope:

```json
{
  "data": [
    {
      "source": "codex",
      "id": "019ecbfc-8a84-7421-ab3b-35653feb7896",
      "title": "Review thread",
      "workspacePath": "/Users/me/workspace/fgh",
      "messages": [
        {
          "role": "assistant",
          "phase": "final_answer",
          "text": "Final review result..."
        }
      ],
      "deepLinks": {
        "ui": "/threads/019ecbfc-8a84-7421-ab3b-35653feb7896",
        "native": "codex://threads/019ecbfc-8a84-7421-ab3b-35653feb7896",
        "spiracha": "spiracha://conversation/codex/019ecbfc-8a84-7421-ab3b-35653feb7896"
      }
    }
  ],
  "meta": {
    "hasNext": false,
    "next_cursor": null
  }
}
```

For serverless access from Bun, use the public client export:

```ts
import { createConversationClient } from "spiracha/client";

const client = createConversationClient({ mode: "local" });
const page = await client.listConversations({
  cwd: process.cwd(),
  includeMessages: true,
  messageSelector: "last_final_answer",
});
```

## Source Locations

| Source | Default location | Primary override |
| --- | --- | --- |
| Codex | shared Codex DB probe list | `SPIRACHA_CODEX_DB` |
| Claude Code | `~/.claude/projects` | `SPIRACHA_CLAUDE_CODE_PROJECTS_DIR` |
| Kiro | `~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent/workspace-sessions` | `SPIRACHA_KIRO_WORKSPACE_SESSIONS_DIR` |
| Qoder | `~/Library/Application Support/Qoder/User/globalStorage/state.vscdb` and `~/Library/Application Support/Qoder/User/workspaceStorage` | `SPIRACHA_QODER_GLOBAL_STATE_DB`, `SPIRACHA_QODER_WORKSPACE_STORAGE_DIR` |
| Cursor | `~/Library/Application Support/Cursor/User` on macOS | `SPIRACHA_CURSOR_USER_DIR` |
| Antigravity | known Antigravity workspace roots | source helper defaults |
| OpenCode | `${XDG_DATA_HOME:-~/.local/share}/opencode/opencode.db` | `SPIRACHA_OPENCODE_DB` |
| UI exports | OS temp directory under `spiracha-ui-exports` | `SPIRACHA_UI_EXPORT_DIR` |

## UI Routes

- `/codex` and `/codex/$project` for Codex inventory and project threads.
- `/threads/$threadId` for Codex thread detail.
- `/claude-code`, `/kiro`, `/qoder`, `/cursor`, `/antigravity`, and `/opencode` for source inventories.
- Source detail routes include `/claude-code-sessions/$sessionId`, `/kiro-sessions/$sessionId`, `/qoder-sessions/$sessionId`, `/cursor-threads/$composerId`, `/antigravity-conversations/$conversationId`, and `/opencode-sessions/$sessionId`.
- `/analytics` for Codex token and tool-call analytics.

## Development

```bash
rtk bun test
rtk bun run lint
rtk bun run typecheck
rtk bun run build
rtk bun run coverage
rtk bun start
rtk bun run --cwd apps/ui test
```

The UI package runs Vite through `bun --bun` because server functions import Bun-only modules such as `bun:sqlite`.

## Breaking Consequences

- No `bin` entries are published.
- No `spiracha`, `codex-chats`, or `codex-chats-claude` command remains.
- No repo-local CLI export flow remains.
- No standalone Claude or Cursor export CLI remains.
- No MCP server or local Codex plugin remains.
- Programmatic consumers should call the stable local HTTP API or import `spiracha/client` from Bun.
