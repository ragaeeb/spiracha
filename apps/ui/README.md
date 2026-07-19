# Spiracha UI

The browser UI for browsing local Codex, Claude Code, Grok, Kiro, Qoder, Cursor, Antigravity, and OpenCode history, inspecting transcript details, exporting chats, and analyzing Codex usage patterns.

## Stack

- Bun
- TanStack Start
- TanStack Query
- TanStack Table
- TanStack Virtual
- Tailwind CSS v4
- shadcn/ui
- Biome

## What It Does

- lists derived Codex projects from the Codex SQLite database
- lists Codex threads within a project in chronological order
- shows Codex thread timelines, a dedicated tool activity and definition view, recorded goals, readable sandbox policy, metadata, and raw event context
- searches Codex projects from the app shell through the URL-backed `/codex?q=...` inventory filter
- exports Codex, Claude Code, Grok, Kiro, Qoder, Cursor, and OpenCode sessions or threads as Markdown, plain text, or optional zip archives with optional metadata, commentary, and tool-call inclusion; the last submitted choices persist while canceled drafts are discarded
- lists Claude Code workspaces and sessions from local `~/.claude/projects` JSONL files
- shows dedicated Claude Code session detail pages with reasoning, tool calls, token metadata, and export actions
- lists Grok workspaces and sessions from local Grok session archives
- shows dedicated Grok session detail pages with compacted-history recovery, tool calls, metadata, export, and delete actions
- lists Kiro workspaces and sessions from local Kiro workspace session files
- shows dedicated Kiro session detail pages with image attachments, prompt logs, execution-derived tool calls, metadata, and export actions
- lists Qoder workspaces and sessions from local Qoder history and checkpoint storage
- shows dedicated Qoder session detail pages with prompts, checkpoint file operations, metadata, and export actions
- lists Cursor workspaces and workspace threads with the same table-based index/detail flow as Codex
- shows dedicated Cursor thread detail pages with breadcrumbs back to the workspace and source
- recovers split Cursor storage buckets, exports Cursor threads, and deletes Cursor workspaces or threads
- lists Antigravity workspaces and conversations, including transcript/artifact availability
- shows dedicated Antigravity conversation detail pages with shared metadata and export actions
- unlocks Antigravity transcript export through macOS Keychain and exports conversations or artifacts as Markdown
- lists OpenCode workspaces and sessions from the local OpenCode SQLite database
- shows dedicated OpenCode session detail pages with reasoning, tool parts, MiniMax `<think>` blocks, token metadata, and export actions
- shows dashboard and project-scoped Codex analytics for token totals, average and median thread size, archive counts, tool usage, model tokens, client sources, and reasoning effort
- keeps Codex inventory search and analytics project filters in URL search params for reloadable and shareable views
- keeps source-specific commentary hidden by default while preserving final answers, with matching export filtering for Claude Code, Kiro, Qoder, and OpenCode

## Commands

```bash
rtk bun start
rtk bun run build
rtk bun run test:ui
rtk bun run typecheck
```

## Runtime Note

Run these commands from the repository root. The UI is part of the root package and intentionally has no nested package manifest.

Root-owned Vite commands use `apps/ui` as their internal working directory and run through `bun --bun`. That is required because TanStack Start derives part of its server plan from the application directory and the server functions use Bun-only modules such as `bun:sqlite`.

Vitest uses its normal Node runtime.

## Configuration

Runtime configuration is intentionally small:

- `SPIRACHA_CODEX_DB`
  - Optional absolute path to the Codex SQLite database.
  - If unset, Spiracha probes the default Codex locations from the shared root package.
- `SPIRACHA_UI_EXPORT_DIR`
  - Optional directory for temporary browser-download artifacts such as zipped thread exports.
  - If unset, Spiracha uses an OS temp directory under `spiracha-ui-exports`.
- `SPIRACHA_ANALYTICS_TRANSCRIPT_CONCURRENCY`
  - Optional positive integer for Codex analytics transcript parsing concurrency.
  - Defaults to `8`.
- `SPIRACHA_TRANSCRIPT_LOAD_CONCURRENCY`
  - Optional positive integer for detail-page transcript loading concurrency across sources.
  - Defaults to `3` and is capped at `16` to protect the server from excessive parallel disk and database work.
- `SPIRACHA_TRANSCRIPT_LOAD_LOGS`
  - Set to `1` to log transcript-loader queue and timing diagnostics. Disabled by default so library and CLI consumers stay quiet.
- `SPIRACHA_CLAUDE_CODE_PROJECTS_DIR`
  - Optional absolute path to the Claude Code projects directory.
  - If unset, Spiracha reads `${SPIRACHA_CLAUDE_CODE_DATA_DIR:-~/.claude}/projects`. `SPIRACHA_CLAUDE_CODE_DIR` and `SPIRACHA_CLAUDE_HOME` are also accepted aliases for the Claude Code data directory.
- `SPIRACHA_GROK_SESSIONS_DIR`
  - Optional path to the Grok sessions directory.
  - If unset, Spiracha reads `${SPIRACHA_GROK_HOME:-~/.grok}/sessions`. `SPIRACHA_GROK_DIR` is accepted as a Grok home-directory alias.
- `SPIRACHA_KIRO_WORKSPACE_SESSIONS_DIR`
  - Optional absolute path to the Kiro workspace sessions directory.
  - If unset, Spiracha reads `${SPIRACHA_KIRO_DATA_DIR:-~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent}/workspace-sessions`. `SPIRACHA_KIRO_AGENT_DIR` and `SPIRACHA_KIRO_DIR` are also accepted aliases for the Kiro data directory.
- `SPIRACHA_QODER_GLOBAL_STATE_DB`
  - Optional absolute path to Qoder's global `state.vscdb`.
  - If unset, Spiracha reads `${SPIRACHA_QODER_USER_DIR:-~/Library/Application Support/Qoder/User}/globalStorage/state.vscdb`. `SPIRACHA_QODER_DATA_DIR` and `SPIRACHA_QODER_DIR` are also accepted aliases for the Qoder user directory.
- `SPIRACHA_QODER_WORKSPACE_STORAGE_DIR`
  - Optional absolute path to Qoder's `workspaceStorage` directory.
  - If unset, Spiracha reads `${SPIRACHA_QODER_USER_DIR:-~/Library/Application Support/Qoder/User}/workspaceStorage`.
- `SPIRACHA_OPENCODE_DB`
  - Optional absolute path to the OpenCode SQLite database.
  - If unset, Spiracha reads `${SPIRACHA_OPENCODE_DATA_DIR:-${XDG_DATA_HOME:-~/.local/share}/opencode}/opencode.db`. `SPIRACHA_OPENCODE_DIR` is also accepted as an OpenCode data-directory alias.
- `SPIRACHA_OPENCODE_DB_CONCURRENCY`
  - Optional positive integer for concurrent OpenCode database reads.
  - Defaults to `2`.
- `SPIRACHA_OPENCODE_DB_LOGS`
  - Set to `1` to log OpenCode database queue and timing diagnostics. Disabled by default.
- `SPIRACHA_CURSOR_USER_DIR`
  - Optional absolute path to Cursor's `User` directory.
  - If unset, Spiracha reads the platform default Cursor user-data directory.
- `SPIRACHA_CURSOR_PROJECTS_DIR`
  - Optional absolute path to Cursor's project transcript directory.
  - If unset, Spiracha infers `.cursor/projects` from the Cursor user directory when possible.
- `SPIRACHA_ANTIGRAVITY_DIRS`
  - Optional path-list of Antigravity roots.
  - If unset, Spiracha reads `~/.gemini/antigravity-ide` and `~/.gemini/antigravity`. `SPIRACHA_ANTIGRAVITY_DIR` is accepted as a single-root alias.

Export artifacts are served through the UI as attachment downloads from `/__exports/*`. The local dev and preview servers use the same export-directory contract.

Default source locations:

| Source | Default location | Primary override |
| --- | --- | --- |
| Codex | shared Codex DB probe list | `SPIRACHA_CODEX_DB` |
| Claude Code | `~/.claude/projects` | `SPIRACHA_CLAUDE_CODE_PROJECTS_DIR` |
| Grok | `~/.grok/sessions` | `SPIRACHA_GROK_SESSIONS_DIR`, `SPIRACHA_GROK_HOME` |
| Kiro | `~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent/workspace-sessions` | `SPIRACHA_KIRO_WORKSPACE_SESSIONS_DIR` |
| Qoder | `~/Library/Application Support/Qoder/User/globalStorage/state.vscdb` + `~/Library/Application Support/Qoder/User/workspaceStorage` | `SPIRACHA_QODER_GLOBAL_STATE_DB`, `SPIRACHA_QODER_WORKSPACE_STORAGE_DIR` |
| Cursor | `~/Library/Application Support/Cursor/User` on macOS | `SPIRACHA_CURSOR_USER_DIR`, `SPIRACHA_CURSOR_PROJECTS_DIR` |
| Antigravity | `~/.gemini/antigravity-ide` + `~/.gemini/antigravity` | `SPIRACHA_ANTIGRAVITY_DIRS`, `SPIRACHA_ANTIGRAVITY_DIR` |
| OpenCode | `${XDG_DATA_HOME:-~/.local/share}/opencode/opencode.db` | `SPIRACHA_OPENCODE_DB` |
| Export downloads | OS temp directory under `spiracha-ui-exports` | `SPIRACHA_UI_EXPORT_DIR` |

Codex analytics cache keys are based on Codex DB row metadata instead of statting every rollout file before cache hits. That keeps large histories responsive. The tradeoff is that manual JSONL edits outside Codex do not invalidate analytics unless DB row metadata changes or the temporary UI cache is cleared.

The temporary UI cache is pruned opportunistically at read/write boundaries, with cleanup scans throttled to once per minute. Entries expire after 24 hours and the retained cache is capped at 256 MiB; recently accessed entries refresh their age so hot data survives eviction.

Transcript detail pages expose the same display controls across sources: user messages, commentary, tool calls, extra events, and raw JSON. Claude Code assistant lead-ins are classified from `stop_reason`, Kiro assistant phases are classified per user turn from session and execution files, Qoder shows local prompt history plus checkpoint file operations, and OpenCode assistant phases are classified per assistant run after stripping MiniMax `<think>` blocks into commentary. OpenCode think-tag extraction preserves literal `<think>` examples inside Markdown code spans and fenced code blocks.

## Routes

- `/`
  - dashboard
- `/codex`
  - Codex inventory and search, with `q` as the route search param
- `/codex/$project`
  - Codex project thread listing, with `q` as the route search param
- `/claude-code`
  - Claude Code workspace inventory and search
- `/claude-code/$workspaceKey`
  - Claude Code workspace session listing
- `/claude-code-sessions/$sessionId`
  - Claude Code session detail and export
- `/grok`
  - Grok workspace inventory and search
- `/grok/$workspaceKey`
  - Grok workspace session listing
- `/grok-sessions/$sessionId`
  - Grok session detail, export, and delete
- `/kiro`
  - Kiro workspace inventory and search
- `/kiro/$workspaceKey`
  - Kiro workspace session listing
- `/kiro-sessions/$sessionId`
  - Kiro session detail and export
- `/qoder`
  - Qoder workspace inventory and search
- `/qoder/$workspaceKey`
  - Qoder workspace session listing
- `/qoder-sessions/$sessionId`
  - Qoder session detail and export
- `/cursor`
  - Cursor workspace inventory and search
- `/cursor/$workspaceKey`
  - Cursor workspace thread listing
- `/cursor-threads/$composerId`
  - Cursor thread detail, export, and delete
- `/antigravity`
  - Antigravity workspace inventory and search
- `/antigravity/$workspaceKey`
  - Antigravity workspace conversation listing
- `/antigravity-conversations/$conversationId`
  - Antigravity conversation detail, export, and artifact inspection
- `/opencode`
  - OpenCode workspace inventory and search
- `/opencode/$workspaceKey`
  - OpenCode workspace session listing
- `/opencode-sessions/$sessionId`
  - OpenCode session detail and export
- `/threads/$threadId`
  - Codex thread detail, transcript, export, and delete
- `/$threadId`
  - shortcut redirect to the thread detail page for pasted Codex thread UUIDs
- `/analytics`
  - project-scoped Codex token, archive, tool, model, client-source, and reasoning-effort analytics, with `project` as the route search param

## Testing

- UI component tests live under `src/**/*.vitest.tsx`.
- Source-specific transcript event adapter tests live under `src/lib/*.vitest.ts`.
- Route search parsing tests live in `src/lib/route-search.vitest.ts`.
- The repo root wraps this Vitest suite from `src/ui-suite.test.ts`, so `rtk bun test` at the root covers both the Bun tests and the UI tests.
