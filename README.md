# spiracha

<p align="center">
  <img src="public/icon.svg" alt="Spiracha icon" width="96" height="100">
</p>

[![license](https://img.shields.io/npm/l/spiracha)](LICENSE.md)
[![runtime](https://img.shields.io/badge/runtime-Bun-000000?logo=bun)](https://bun.sh)

Spiracha is a Bun package with a local TanStack Start UI, a small CLI, and a direct data client for browsing and exporting agent conversation history from Codex, Claude Code, Grok, Kiro, Qoder, Cursor, Antigravity, FX, MiniMax Code, and OpenCode.

The legacy exporter, MCP server, and Codex plugin surfaces were removed in the 2.0 hard cut. Spiracha now exposes the UI, a stable local data API, and the API-driven CLI below; client-specific workflows such as review collection belong in the client that calls the API.

## Quick Start

To run the packaged app:

```bash
bunx spiracha serve
```

The production command serves the bundled UI and API on `127.0.0.1:3000` (or the `PORT` you set).

For repository development:

```bash
bun install
bun start
```

Open the local URL printed by Vite.

Spiracha requires Bun 1.4.0 or newer. Set `PORT` to choose a different port, for example `PORT=4100 bunx spiracha serve`.

## CLI

The packaged CLI is a thin client over Spiracha's normalized conversation API. With no arguments, it prints help:

```bash
spiracha
```

Use these commands:

```bash
spiracha serve
spiracha list --cwd <path>
spiracha get <ref>
spiracha export <ref> [--raw] [--output <path>]
spiracha evidence <ref> --lens <file> [--output <path>]
```

`<ref>` may be a Spiracha or native source link. `spiracha/client` is the public Bun SDK for scripts and applications; import it instead of shelling out to the CLI when integrating Spiracha.

Install the SDK in another Bun application with `bun add spiracha`. `list` and `get` write JSON; `export` and `evidence` write Markdown to stdout unless `--output` is provided. `export --raw` writes the original source JSON/JSONL bytes and does not accept message selection. Run `spiracha --help` for filtering and pagination options.

## What It Does

- Browse local conversations across Codex, Claude Code, Grok, Kiro, Qoder, Cursor, Antigravity, FX, MiniMax Code, and OpenCode.
- Import exported ChatGPT, Claude, Gemini, Grok, Qwen, GLM, Amazon Nova, DeepSeek, Mistral, Perplexity, and compatible web conversations by dropping JSON files onto the Web page.
- Group each integration into workspace inventories with local search and source-specific export/delete actions where supported.
- Search Codex projects from the app shell, with results delegated to the shareable `/codex?q=...` inventory filter.
- Inspect source-specific detail pages with transcript, tool, reasoning, metadata, raw event, export, and delete flows where supported by the source. Transcript controls can filter user messages, commentary, tools, extra events, raw JSON, and text matches. Codex thread detail includes optional live updates isolated from page-loading connections, a tool-focused activity view, recorded goals, and sandbox policy.
- Export transcripts from the UI as Markdown, text, or zip bundles with source-specific commentary/final-answer filtering. The last submitted export choices persist across dialog openings; canceled drafts do not.
- Export source-independent focused evidence: bounded failure/retry/tool episodes selected by a reusable JSON lens, with trace IDs and an omission ledger.
- Review project-scoped Codex analytics, including token and tool distributions plus deterministic optimization findings for context leakage, repeated work, broad reads, timed-out waits, and delegation patterns.
- Adjust transcript path conversion and username redaction from Settings; the app shell also provides light/dark theme controls.
- Expose a stable API for local clients that need normalized conversation metadata and message payloads.
- Resolve Spiracha UI links and native source links into normalized `{ source, id }` references for cross-thread context lookup.

Large bodies are loaded behind the lightweight metadata path where needed. Cursor and Antigravity detail routes fetch transcript/artifact documents after browser hydration; imported Web detail routes fetch normalized transcript events after hydration; and oversized Codex rollouts expose a deferred preview/full-load choice instead of inflating the initial route payload.

### Web chat imports

Open `/web` and drop one or more JSON exports. Spiracha parses mapping-based ChatGPT-style envelopes, native Claude and Grok exports, and ordinary role/content message arrays at runtime. Provider detection uses content and model metadata before the file name, and recognizes ChatGPT, Claude, Gemini, Grok, Qwen, GLM, Amazon Nova, DeepSeek, Mistral, and Perplexity hints. Assistant reasoning remains separate from the answer, and embedded research/tool activity becomes normalized tool events where the source exposes enough structure. A single parsed conversation opens directly; multiple conversations remain in a searchable, paginated list and link to `/web-chats/:conversationId`.

Unsupported or malformed files return per-file errors while valid files in the same import remain available. Web conversation detail pages expose the normalized transcript, metadata, transcript controls, and Parsed JSON; they do not export or delete the original source file.

Each file is limited to 25 MB, with at most 20 files and 100 MB per import. Spiracha retains up to 128 MB of the most recent normalized conversations in server memory and evicts the oldest entries first; imports disappear when evicted or when the Spiracha server stops. Each detail route uses a generated opaque ID and keeps the original provider conversation ID separately when one is present. Web imports are a UI workflow and are not added to the stable data API, CLI, or stable source registry.

## Stable Data API

The API is served by the local UI server under `/api/v1`. Start the packaged server with `spiracha serve`.

```bash
spiracha serve
```

Common read endpoints:

```text
GET  /api/v1/sources
GET  /api/v1/conversations?cwd=/absolute/project&include_messages=true
POST /api/v1/conversation-query
GET  /api/v1/conversations/:source/:id
GET  /api/v1/conversations/:source/:id/export
GET  /api/v1/conversations/:source/:id/raw
POST /api/v1/conversations/:source/:id/evidence
DELETE /api/v1/conversations/:source/:id
POST /api/v1/conversations/delete
POST /api/v1/conversations/export
GET  /api/v1/resolve?ref=<url-or-deeplink>
```

The default list selector is `last_final_answer`, which keeps `fgh --collect` style clients fast and small. Use `message_selector=all` when a client needs the full normalized thread. Claude Code and Kiro lists coalesce recognized compacted continuations under the parent conversation ID. Reading, exporting, generating focused evidence for, or deleting that parent operates on the complete lineage. A direct child-segment ID remains available as a physical-session lookup and affects only that segment.

Conversation lists use opaque keyset cursors ordered by update time, source, and conversation ID. Pass `meta.next_cursor` unchanged with the same filters to request the next page. The 2.0 offset cursor format is intentionally unsupported; clients must begin a fresh traversal after upgrading.

List requests accept a positive `limit` up to 200, optional `updated_after_ms` and `updated_before_ms` windows, `source` filters, and `include_messages`. Message bodies are omitted unless `include_messages=true`; the list default remains `last_final_answer` when bodies are requested.

Workspace matching is lexical and performs no filesystem reads, so missing and network-mounted transcript paths cannot delay collection. Symlink aliases are intentionally not resolved; callers that require alias equivalence should pass the canonical workspace path recorded by the source.

Batch delete requires an explicit source and ID list. It returns `deletedIds`, `missingIds`, and a result for each requested ID, so partial success is represented in a `200` response body. Batch export also requires an explicit source and ID list, but is atomic: any missing ID returns an error instead of a partial archive. Cursor deletes accept `delete_session_files=false` on the single-delete query string or batch-delete JSON body. This removes Cursor database records while preserving its transcript directories; preserved source files can make the conversation discoverable again. The Cursor UI exposes the same choice and keeps transcript deletion selected by default. Cursor must be closed before a write; workspace cleanup failures can return a bounded, single-use retry token while filesystem paths remain server-side.

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

For direct access from Bun scripts and CLIs, use the public `spiracha/client` Bun SDK rather than shelling out. Local mode reads the source data without starting the UI server:

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
Malformed local records emit aggregated or first-sample warnings rather than one warning per record, so repeated list/detail loads do not flood stderr. Incompatible OpenCode table or column layouts fail with `OPENCODE_DB_INCOMPATIBLE` instead of appearing as empty history.

The public client exposes the same operations in local and HTTP modes: source listing, path-scoped listing, detail reads, raw/Markdown/evidence/zip exports, source-owned deletes, and reference resolution.

`client.exportConversationRaw({ source, id })` returns the original source JSON/JSONL file as a `Blob`, with its native filename and MIME type. The `/raw` endpoint serves the same bytes directly with download headers. Raw exports never parse, filter, normalize, or reserialize the source file. Sources whose conversation exists only inside a shared database, or which have no standalone JSON transcript, return `null` from the client and `404` from HTTP rather than synthesizing a replacement.

Focused evidence is a deterministic, lossy Markdown export for qualitative DX analysis. It does not change full-transcript exports. See [Focused evidence lenses](docs/focused-evidence.md) for the complete lens schema, bounds, local and HTTP examples, UI workflow, privacy behavior, omission accounting, and performance limits.

### Codex analytics

The `/analytics` view can scope results to one project or all projects. It reports thread and token totals, average and median thread size, archive and web-search counts, model/client/reasoning distributions, tool usage, retained tool-output bytes, full-context forks, and timed-out waits. Optimization findings are deterministic signals from local rollout records; they describe retained context and workflow patterns, not provider billing or automatic recommendations to apply.

## Source Locations

| Source | Default location | Primary override |
| --- | --- | --- |
| Codex | shared Codex DB probe list | `SPIRACHA_CODEX_DB` |
| Claude Code | `~/.claude/projects` | `SPIRACHA_CLAUDE_CODE_DATA_DIR`, `SPIRACHA_CLAUDE_CODE_PROJECTS_DIR` |
| Cline | `~/.cline/data` (sessions below this directory) | `SPIRACHA_CLINE_DATA_DIR` |
| Grok | `~/.grok/sessions` | `SPIRACHA_GROK_HOME`, `SPIRACHA_GROK_SESSIONS_DIR` |
| Kiro | `~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent/workspace-sessions` | `SPIRACHA_KIRO_DATA_DIR`, `SPIRACHA_KIRO_WORKSPACE_SESSIONS_DIR` |
| Qoder | `~/Library/Application Support/Qoder/User/globalStorage/state.vscdb`, `~/Library/Application Support/Qoder/User/workspaceStorage`, and `~/Library/Application Support/Qoder/SharedClientCache/cli/projects` | `SPIRACHA_QODER_USER_DIR`, `SPIRACHA_QODER_GLOBAL_STATE_DB`, `SPIRACHA_QODER_WORKSPACE_STORAGE_DIR`, `SPIRACHA_QODER_CLI_PROJECTS_DIR` |
| Cursor | `~/Library/Application Support/Cursor/User` on macOS | `SPIRACHA_CURSOR_USER_DIR`, `SPIRACHA_CURSOR_PROJECTS_DIR` |
| Antigravity | `~/.gemini/antigravity-ide`, `~/.gemini/antigravity-cli`, and `~/.gemini/antigravity` | `SPIRACHA_ANTIGRAVITY_DIRS`, `SPIRACHA_ANTIGRAVITY_DIR` |
| FX | `~/.fx` | `SPIRACHA_FX_DATA_DIR` |
| MiniMax Code | `~/.minimax/v2/sessions` and `~/.minimax/v2/sqlite/runtime-state.sqlite` | `SPIRACHA_MINIMAX_CODE_DATA_DIR`, `SPIRACHA_MINIMAX_CODE_SESSIONS_DIR`, `SPIRACHA_MINIMAX_CODE_RUNTIME_DB_PATH` |
| OpenCode | `${XDG_DATA_HOME:-~/.local/share}/opencode/opencode.db` | `SPIRACHA_OPENCODE_DATA_DIR`, `SPIRACHA_OPENCODE_DB` |
| UI exports | OS temp directory under `spiracha-ui-exports` | `SPIRACHA_UI_EXPORT_DIR` |

### Cache and export lifecycle

Spiracha bounds temporary disk use by age and total retained bytes. Values are non-negative integer byte or millisecond counts; invalid values fail startup/request handling instead of silently falling back.

| Variable | Default | Purpose |
| --- | ---: | --- |
| `SPIRACHA_UI_CACHE_BYPASS` | `0` | Set to `1` to bypass UI JSON cache reads and writes during development. |
| `SPIRACHA_UI_CACHE_MAX_AGE_MS` | `86400000` | Maximum age of UI JSON cache entries. |
| `SPIRACHA_UI_CACHE_MAX_BYTES` | `268435456` | Total UI JSON cache ceiling; oldest entries are pruned first. |
| `SPIRACHA_UI_EXPORT_MAX_AGE_MS` | `86400000` | Maximum age of temporary downloadable exports. |
| `SPIRACHA_UI_EXPORT_MAX_BYTES` | `1073741824` | Total temporary export ceiling; oldest exports are pruned first. |
| `SPIRACHA_UI_LARGE_EXPORT_THRESHOLD_BYTES` | `134217728` | Size above which a single transcript export switches to a temporary zipped download. |

Claude Code, Kiro, and Cursor discovery use short-lived, bounded indexes with in-flight request coalescing and mutation invalidation. Kiro builds one validated session-ID index across execution storage, including nested layouts, instead of rescanning per session. Cursor indexes direct composer-id lookups instead of rescanning every workspace group. File identity metadata invalidates changed transcripts, source mutations invalidate affected entries immediately, and no raw source payload is persisted by these caches.

Cursor and Antigravity detail pages split metadata from large transcript/artifact documents. Codex thread metadata records whether a rollout is available, missing, or deferred; the UI can load a bounded preview, request the full transcript, or export directly. Temporary JSON cache and download files are created with private permissions and pruned by age and total bytes.

### Qoder live ACP hydration

Qoder detail/export reads first use persisted state and CLI transcript files. When those do not contain assistant messages and Qoder is running, Spiracha can connect to Qoder's local JSON-RPC ACP Unix socket, issue `initialize` and `session/load`, and collect the streamed session updates. The default socket is the Qoder `SharedClientCache/qoder.sock`; override it with `SPIRACHA_QODER_SOCKET_PATH` (or the legacy environment spelling `SPIRACHA_QODER_SOCKET`). Connection failures and timeouts fall back to the persisted transcript rather than preventing the session from loading.

### Antigravity transcript contract

When an Antigravity conversation has a live trajectory database, Spiracha treats it as the authoritative transcript and merges any generated JSONL-only events by step index. This preserves early reasoning plus paired command inputs, call IDs, working directories, exit codes, and complete outputs that may be absent from generated logs. The same merged data powers the detail page, stable API, and Markdown/text exports.

Markdown transcript exports identify this parser contract with `transcript_schema: antigravity-transcript/v2`. The UI parser retains complete tool output in its event data and export, but bounds the rendered preview to 20,000 characters so a single large operation result cannot dominate the detail page.

Encrypted Antigravity transcripts use the macOS Keychain item `Antigravity Safe Storage` / `Antigravity Key` and the Electron-compatible `saltysalt` PBKDF2 derivation. Keychain access is reacquired for each protected server request; the raw secret is not stored in process-global state or returned to the browser. Non-encrypted transcripts do not require Keychain access, and other platforms report decryption as unsupported.

### Codex browser database compatibility

Codex browser reads target the `codex-state-5-thread-browse-v1` compatibility profile. The `threads` table and its browse columns are required; missing tables, missing columns, or invalid decoded row values produce an actionable compatibility error instead of a guessed result. The `thread_dynamic_tools`, `thread_goals`, and `thread_spawn_edges` tables are optional and are read when present, so older databases without those tables remain browseable.

Multi-table thread browse reads run inside one SQLite deferred read transaction. This gives each browse result a consistent database snapshot while allowing Codex's normal writers to continue; it does not claim crash-level atomicity across the main database, attached history databases, rollout files, or the session index. Destructive DB changes commit before optional session-file cleanup and synchronized session-index/Codex Desktop global-state cleanup. Global-state cleanup removes structural Recent/sidebar references, preserves unrelated prompt text, sets Codex's deleted-thread write-block flags, and reports what changed.

UI batch Codex exports use one batch browse pass and include a versioned `spiracha-manifest.json` in every successful archive. The manifest preserves requested ID order and records exported, missing, unreadable, and unstable entries. A batch succeeds when at least one selected thread is exportable; a single-thread export remains fail-fast. Active rollout files are copied to an attempt-local snapshot, checked by size, inode, and high-resolution timestamps, and retried once when they mutate during the copy.

### Cursor SQLite access

Cursor reads use a retry-aware synchronous callback that opens a fresh read handle for each attempt and closes it before retrying. Cursor mutations use a same-database `BEGIN IMMEDIATE` transaction with the shared bounded SQLite retry policy and no stacked long `busy_timeout`. Missing writable databases fail closed instead of being created. Discovery is cached per user directory, coalesces concurrent scans, and maintains a composer-id index for direct detail lookup. Recovery and deletion keep cross-database compensation and filesystem cleanup outside retry callbacks; destructive discovery uses strict readers so exhausted locks cannot be mistaken for empty data. UI mutation entrypoints still require Cursor to be closed before writing because Cursor can rewrite its history on exit. Workspace cleanup can be retried with a short-lived opaque token after the database mutation has committed.

## UI Routes

- `/` for the Codex dashboard, `/codex` and `/codex/$project` for Codex inventory and project threads.
- `/threads/$threadId` for Codex thread detail.
- `/claude-code`, `/cline`, `/grok`, `/kiro`, `/qoder`, `/cursor`, `/antigravity`, `/fx`, `/minimax-code`, and `/opencode` for source inventories.
- Source detail routes include `/claude-code-sessions/$sessionId`, `/cline-tasks/$taskId`, `/grok-sessions/$sessionId`, `/kiro-sessions/$sessionId`, `/qoder-sessions/$sessionId`, `/cursor-threads/$composerId`, `/antigravity-conversations/$conversationId`, `/fx-sessions/$sessionId`, `/minimax-code-sessions/$sessionId`, and `/opencode-sessions/$sessionId`.
- `/web` for JSON imports and a searchable in-memory list of imported conversations; `/web-chats/$conversationId` for parsed transcript, metadata, and normalized JSON.
- FX workspace and detail pages support single, selected, and workspace-wide deletion. Deletion removes the session directory plus its session-index and latest-pointer entries while preserving workspace files and global FX command history.
- MiniMax Code workspace and detail pages support single, selected, and workspace-wide deletion. Deletion removes finalized session directories and authoritative runtime database rows while preserving generated workspace files and append-only observability logs.
- `/analytics` for project-scoped Codex token totals, average and median thread size, archive counts, tool usage, model tokens, client sources, reasoning-effort breakdowns, and deterministic optimization findings.
- `/settings` for transcript path conversion and username redaction. Export dialogs remember their own last submitted options, and focused-evidence lenses stay in the dialog rather than cookies.

Codex Live mode opens an SSE connection from the thread page. While connected, the server shares one bounded rollout-file monitor across every tab viewing that thread and releases it after the final client disconnects. The browser does not poll.

## Development

```bash
bun test
bun run lint
bun run typecheck
bun run build
bun run coverage
bun run test:package
bun start
bun run test:ui
```

`bun run coverage` enforces at least 90% line coverage independently for the root Bun suite and the UI Vitest suite, and reports function coverage and per-file hotspots for follow-up.

Run one root test file with `bun test src/lib/shared.test.ts`. Run one UI test file with `bun run test:ui --run src/ui/components/export-dialog.vitest.tsx`.

`bun run test:package` launches the packaged `bin/spiracha.ts` entrypoint against an isolated fixture and checks the published UI boundary. `bun run format` applies the repository's Biome formatting and lint fixes when intentionally reformatting source.

`bun start` runs the UI development server. `bun run build` emits bundled client assets and a bundled server entrypoint; `spiracha serve` runs that built output. The published package ships the built client/server output and the Bun SDK sources, not the UI source tree or Vite toolchain. Only `fflate` is a runtime dependency; the UI and build/test toolchain stays in `devDependencies`.

Spiracha has one application boundary: the stable API, server functions, browser route tree, and UI all resolve through one manifest and one dependency graph. Vite is a development/build tool; Vitest uses its normal Node runtime.

Package metadata is imported through the root `#package-metadata` package import alias and validated at module load. Server functions retain focused dynamic imports at the Bun-only boundary so database modules cannot leak into browser bundles; broad dynamic-import conversion is intentionally avoided.

Shared DTO, path, configuration, and error rules are documented in [Data and runtime conventions](docs/data-conventions.md).

TanStack Router generates `src/ui/routeTree.gen.ts` during development/build. Do not edit it manually; after adding or renaming route files, run `bun run build` (or start the dev server) and include the generated update.

## Markdown and packaging

Spiracha's Markdown is deterministic generation and domain parsing. Bun 1.4's `Bun.markdown` was evaluated, but it is currently unstable for this contract, so Spiracha does not depend on it.

The hard-cut package keeps one `spiracha` bin, the stable `spiracha/client` and `spiracha/types` exports, and the bundled UI/server runtime. It does not restore legacy CLI aliases, an MCP server, a Codex plugin, or a separate exporter package.

## Breaking Consequences

- The only published `bin` entry is `spiracha`; no arguments show help, `serve` launches the bundled local UI server, and the remaining commands call the stable local data client.
- No `codex-chats`, `codex-chats-claude`, or legacy export command remains.
- CLI export/evidence flows use the stable normalized client and do not reintroduce source-specific exporter entrypoints.
- No MCP server or local Codex plugin remains.
- Programmatic consumers should call the stable local HTTP API or import `spiracha/client` from Bun rather than shelling out.
- Normalized conversation messages now always include `toolEvidence` (`null` for non-tool messages); consumers that construct these DTOs must provide that explicit field.
