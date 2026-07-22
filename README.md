# spiracha

<p align="center">
  <img src="apps/ui/public/icon.svg" alt="Spiracha icon" width="96" height="100">
</p>

[![license](https://img.shields.io/npm/l/spiracha)](LICENSE.md)
[![runtime](https://img.shields.io/badge/runtime-Bun-000000?logo=bun)](https://bun.sh)

Spiracha is a Bun package with a local TanStack Start UI and a direct data client for browsing and exporting agent conversation history from Codex, Claude Code, Grok, Kiro, Qoder, Cursor, Antigravity, and OpenCode.

The legacy CLI, MCP server, and Codex plugin surfaces have been removed in the 2.0 hard cut. Spiracha now exposes the UI and a stable local data API; client-specific workflows such as review collection belong in the client that calls the API.

## Quick Start

To run the packaged app:

```bash
bunx spiracha
```

Spiracha asks Vite for port 3000 and automatically uses the next available port when 3000 is occupied.

For repository development:

```bash
bun install
bun start
```

Open the local URL printed by Vite.

Spiracha requires Bun 1.3.14 or newer. Set `PORT` to request a different starting port, for example `PORT=4100 bunx spiracha`; the launcher uses the next available port if that one is occupied.

## What It Does

- Browse local conversations across Codex, Claude Code, Grok, Kiro, Qoder, Cursor, Antigravity, and OpenCode.
- Search Codex projects from the app shell, with results delegated to the shareable `/codex?q=...` inventory filter.
- Inspect source-specific detail pages with transcript, tool, reasoning, metadata, raw event, export, and delete flows where supported by the source. Codex thread detail includes optional live updates isolated from page-loading connections, a tool-focused activity view, recorded goals, and sandbox policy.
- Export transcripts from the UI as Markdown, text, or zip bundles with source-specific commentary/final-answer filtering. The last submitted export choices persist across dialog openings; canceled drafts do not.
- Export source-independent focused evidence: bounded failure/retry/tool episodes selected by a reusable JSON lens, with trace IDs and an omission ledger.
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
POST /api/v1/conversations/:source/:id/evidence
DELETE /api/v1/conversations/:source/:id
POST /api/v1/conversations/delete
POST /api/v1/conversations/export
GET  /api/v1/resolve?ref=<url-or-deeplink>
```

The default list selector is `last_final_answer`, which keeps `fgh --collect` style clients fast and small. Use `message_selector=all` when a client needs the full normalized thread.

Conversation lists use opaque keyset cursors ordered by update time, source, and conversation ID. Pass `meta.next_cursor` unchanged with the same filters to request the next page. The 2.0 offset cursor format is intentionally unsupported; clients must begin a fresh traversal after upgrading.

Workspace matching is lexical and performs no filesystem reads, so missing and network-mounted transcript paths cannot delay collection. Symlink aliases are intentionally not resolved; callers that require alias equivalence should pass the canonical workspace path recorded by the source.

Batch delete requires an explicit source and ID list. It returns `deletedIds`, `missingIds`, and a result for each requested ID, so partial success is represented in a `200` response body. Batch export also requires an explicit source and ID list, but is atomic: any missing ID returns an error instead of a partial archive.

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
    "has_next": false,
    "next_cursor": null
  }
}
```

For direct access from Bun scripts and CLIs, use the public client export. Local mode reads the source data without starting the TanStack server:

```ts
import { createConversationClient } from "spiracha/client";

const client = createConversationClient({ mode: "local" });
const page = await client.listConversations({
  cwd: process.cwd(),
  includeMessages: true,
  messageSelector: "last_final_answer",
});
```

Library and CLI use is quiet by default. Set `SPIRACHA_TRANSCRIPT_LOAD_LOGS=1` or
`SPIRACHA_OPENCODE_DB_LOGS=1` only when diagnosing loader or OpenCode database timing.

Focused evidence is a deterministic, lossy Markdown export for qualitative DX analysis. It does not change full-transcript exports. See [Focused evidence lenses](docs/focused-evidence.md) for the complete lens schema, bounds, local and HTTP examples, UI workflow, privacy behavior, omission accounting, and performance limits.

## Source Locations

| Source | Default location | Primary override |
| --- | --- | --- |
| Codex | shared Codex DB probe list | `SPIRACHA_CODEX_DB` |
| Claude Code | `~/.claude/projects` | `SPIRACHA_CLAUDE_CODE_PROJECTS_DIR` |
| Grok | `~/.grok/sessions` | `SPIRACHA_GROK_SESSIONS_DIR` |
| Kiro | `~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent/workspace-sessions` | `SPIRACHA_KIRO_WORKSPACE_SESSIONS_DIR` |
| Qoder | `~/Library/Application Support/Qoder/User/globalStorage/state.vscdb` and `~/Library/Application Support/Qoder/User/workspaceStorage` | `SPIRACHA_QODER_GLOBAL_STATE_DB`, `SPIRACHA_QODER_WORKSPACE_STORAGE_DIR` |
| Cursor | `~/Library/Application Support/Cursor/User` on macOS | `SPIRACHA_CURSOR_USER_DIR`, `SPIRACHA_CURSOR_PROJECTS_DIR` |
| Antigravity | `~/.gemini/antigravity-ide` and `~/.gemini/antigravity` | `SPIRACHA_ANTIGRAVITY_DIRS`, `SPIRACHA_ANTIGRAVITY_DIR` |
| OpenCode | `${XDG_DATA_HOME:-~/.local/share}/opencode/opencode.db` | `SPIRACHA_OPENCODE_DB` |
| UI exports | OS temp directory under `spiracha-ui-exports` | `SPIRACHA_UI_EXPORT_DIR` |

### Qoder live ACP hydration

Qoder detail/export reads first use persisted state and CLI transcript files. When those do not contain assistant messages and Qoder is running, Spiracha can connect to Qoder's local JSON-RPC ACP Unix socket, issue `initialize` and `session/load`, and collect the streamed session updates. The default socket is the Qoder `SharedClientCache/qoder.sock`; override it with `SPIRACHA_QODER_SOCKET_PATH` (or the legacy environment spelling `SPIRACHA_QODER_SOCKET`). Connection failures and timeouts fall back to the persisted transcript rather than preventing the session from loading.

### Antigravity transcript contract

Markdown transcript exports identify their parser contract with `transcript_schema: antigravity-transcript/v1`. The UI parser retains complete tool output in its event data and export, but bounds the rendered preview to 20,000 characters so a single large operation result cannot dominate the detail page.

## UI Routes

- `/codex` and `/codex/$project` for Codex inventory and project threads.
- `/threads/$threadId` for Codex thread detail.
- `/claude-code`, `/grok`, `/kiro`, `/qoder`, `/cursor`, `/antigravity`, and `/opencode` for source inventories.
- Source detail routes include `/claude-code-sessions/$sessionId`, `/grok-sessions/$sessionId`, `/kiro-sessions/$sessionId`, `/qoder-sessions/$sessionId`, `/cursor-threads/$composerId`, `/antigravity-conversations/$conversationId`, and `/opencode-sessions/$sessionId`.
- `/analytics` for project-scoped Codex token totals, average and median thread size, archive counts, tool usage, model tokens, client sources, and reasoning-effort breakdowns.
- `/settings` for transcript path conversion and username redaction. Export dialogs remember their own last submitted options.

Codex Live mode opens an SSE connection from the thread page. While connected, the server shares one bounded rollout-file monitor across every tab viewing that thread and releases it after the final client disconnects. The browser does not poll.

## Development

```bash
bun test
bun run lint
bun run typecheck
bun run build
bun run coverage
bun start
bun run test:ui
```

`bun run coverage` enforces at least 90% line coverage independently for the root Bun suite and the UI Vitest suite, and reports function coverage and per-file hotspots for follow-up.

Run one root test file with `bun test src/lib/shared.test.ts`. Run one UI test file with `bun run test:ui --run apps/ui/src/components/export-dialog.vitest.tsx`.

Spiracha has one package manifest. The `apps/ui` directory remains a source boundary, but all UI and direct-client commands and dependencies are owned at the repository root. Root-owned Vite commands use `apps/ui` as their internal working directory and run through `bun --bun` because TanStack server functions import Bun-only modules such as `bun:sqlite`; Vitest uses its normal Node runtime.

TanStack Router generates `apps/ui/src/routeTree.gen.ts` during development/build. Do not edit it manually; after adding or renaming route files, run `bun run build` (or start the dev server) and include the generated update.

## Breaking Consequences

- The only published `bin` entry is `spiracha`, and it only launches the local UI server.
- No `codex-chats`, `codex-chats-claude`, or legacy export command remains.
- No repo-local CLI export flow remains.
- No standalone Claude or Cursor export CLI remains.
- No MCP server or local Codex plugin remains.
- Programmatic consumers should call the stable local HTTP API or import `spiracha/client` from Bun.
- Normalized conversation messages now always include `toolEvidence` (`null` for non-tool messages); consumers that construct these DTOs must provide that explicit field.
