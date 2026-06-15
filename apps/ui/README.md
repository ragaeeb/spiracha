# Spiracha UI

The browser UI for browsing local Codex, Claude Code, Kiro, Cursor, Antigravity, and OpenCode history, inspecting transcript details, exporting chats, and analyzing Codex usage patterns.

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
- shows Codex thread timelines, tool calls, metadata, and raw event context
- exports Codex, Claude Code, Kiro, Cursor, and OpenCode sessions or threads as Markdown, plain text, or optional zip archives with optional metadata, commentary, and tool-call inclusion
- lists Claude Code workspaces and sessions from local `~/.claude/projects` JSONL files
- shows dedicated Claude Code session detail pages with reasoning, tool calls, token metadata, and export actions
- lists Kiro workspaces and sessions from local Kiro workspace session files
- shows dedicated Kiro session detail pages with image attachments, prompt logs, execution-derived tool calls, metadata, and export actions
- lists Cursor workspaces and workspace threads with the same table-based index/detail flow as Codex
- shows dedicated Cursor thread detail pages with breadcrumbs back to the workspace and source
- recovers split Cursor storage buckets, exports Cursor threads, and deletes Cursor workspaces or threads
- lists Antigravity workspaces and conversations, including transcript/artifact availability
- shows dedicated Antigravity conversation detail pages with shared metadata and export actions
- unlocks Antigravity transcript export through macOS Keychain and exports conversations or artifacts as Markdown
- lists OpenCode workspaces and sessions from the local OpenCode SQLite database
- shows dedicated OpenCode session detail pages with reasoning, tool parts, MiniMax `<think>` blocks, token metadata, and export actions
- shows dashboard and analytics summaries, including Codex token totals and tool-call frequency
- keeps Codex inventory search and analytics project filters in URL search params for reloadable and shareable views
- keeps source-specific commentary hidden by default while preserving final answers, with matching export filtering for Claude Code, Kiro, and OpenCode

## Commands

```bash
rtk bun run dev
rtk bun run build
rtk bun run test
rtk bun run typecheck
```

## Runtime Note

This package runs `vite` through `bun --bun ...`.

That is required because the TanStack Start server functions import shared root-package modules that use Bun-only features such as `bun:sqlite`.

If you change the scripts back to plain `vite` or a Node execution path, the UI server functions will fail at runtime.

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
- `SPIRACHA_CLAUDE_CODE_PROJECTS_DIR`
  - Optional absolute path to the Claude Code projects directory.
  - If unset, Spiracha reads `${SPIRACHA_CLAUDE_CODE_DATA_DIR:-~/.claude}/projects`. `SPIRACHA_CLAUDE_CODE_DIR` and `SPIRACHA_CLAUDE_HOME` are also accepted aliases for the Claude Code data directory.
- `SPIRACHA_KIRO_WORKSPACE_SESSIONS_DIR`
  - Optional absolute path to the Kiro workspace sessions directory.
  - If unset, Spiracha reads `${SPIRACHA_KIRO_DATA_DIR:-~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent}/workspace-sessions`. `SPIRACHA_KIRO_AGENT_DIR` and `SPIRACHA_KIRO_DIR` are also accepted aliases for the Kiro data directory.
- `SPIRACHA_OPENCODE_DB`
  - Optional absolute path to the OpenCode SQLite database.
  - If unset, Spiracha reads `${SPIRACHA_OPENCODE_DATA_DIR:-${XDG_DATA_HOME:-~/.local/share}/opencode}/opencode.db`. `SPIRACHA_OPENCODE_DIR` is also accepted as an OpenCode data-directory alias.

Export artifacts are served through the UI as attachment downloads from `/__exports/*`. The packaged `spiracha ui` launcher and the local dev server both use the same export-directory contract.

Default source locations:

| Source | Default location | Primary override |
| --- | --- | --- |
| Codex | shared Codex DB probe list | `SPIRACHA_CODEX_DB` |
| Claude Code | `~/.claude/projects` | `SPIRACHA_CLAUDE_CODE_PROJECTS_DIR` |
| Kiro | `~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent/workspace-sessions` | `SPIRACHA_KIRO_WORKSPACE_SESSIONS_DIR` |
| OpenCode | `${XDG_DATA_HOME:-~/.local/share}/opencode/opencode.db` | `SPIRACHA_OPENCODE_DB` |
| Export downloads | OS temp directory under `spiracha-ui-exports` | `SPIRACHA_UI_EXPORT_DIR` |

Codex analytics cache keys are based on Codex DB row metadata instead of statting every rollout file before cache hits. That keeps large histories responsive. The tradeoff is that manual JSONL edits outside Codex do not invalidate analytics unless DB row metadata changes or the temporary UI cache is cleared.

Transcript detail pages expose the same display controls across sources: user messages, commentary, tool calls, extra events, and raw JSON. Claude Code assistant lead-ins are classified from `stop_reason`, Kiro assistant phases are classified per user turn from session and execution files, and OpenCode assistant phases are classified per assistant run after stripping MiniMax `<think>` blocks into commentary. OpenCode think-tag extraction preserves literal `<think>` examples inside Markdown code spans and fenced code blocks.

## Routes

- `/`
  - dashboard
- `/projects`
  - Codex inventory and search, with `q` as the route search param
- `/projects/$project`
  - Codex project thread listing, with `q` as the route search param
- `/claude-code`
  - Claude Code workspace inventory and search
- `/claude-code/$workspaceKey`
  - Claude Code workspace session listing
- `/claude-code-sessions/$sessionId`
  - Claude Code session detail and export
- `/kiro`
  - Kiro workspace inventory and search
- `/kiro/$workspaceKey`
  - Kiro workspace session listing
- `/kiro-sessions/$sessionId`
  - Kiro session detail and export
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
  - Codex token and tool-call analytics, with `project` as the route search param

## Testing

- UI component tests live under `src/**/*.vitest.tsx`.
- Source-specific transcript event adapter tests live under `src/lib/*.vitest.ts`.
- Route search parsing tests live in `src/lib/route-search.vitest.ts`.
- The repo root wraps this Vitest suite from `src/ui-package.test.ts`, so `rtk bun test` at the root covers both the Bun tests and the UI tests.
