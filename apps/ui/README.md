# Spiracha UI

The browser UI for browsing local Codex, Cursor, and Antigravity history, inspecting transcript details, exporting chats, and analyzing Codex usage patterns.

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
- exports Codex threads as Markdown or plain text with optional metadata, commentary, and tool-call inclusion
- lists Cursor workspaces and workspace threads with the same table-based index/detail flow as Codex
- recovers split Cursor storage buckets, exports Cursor threads, and deletes Cursor workspaces or threads
- lists Antigravity workspaces and conversations, including transcript/artifact availability
- unlocks Antigravity transcript export through macOS Keychain and exports conversations or artifacts as Markdown
- shows dashboard and analytics summaries, including Codex token totals and tool-call frequency

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

Export artifacts are served through the UI as attachment downloads from `/__exports/*`. The packaged `spiracha ui` launcher and the local dev server both use the same export-directory contract.

## Routes

- `/`
  - dashboard
- `/projects`
  - Codex inventory and search
- `/projects/$project`
  - Codex project thread listing
- `/cursor`
  - Cursor workspace inventory and search
- `/cursor/$workspaceKey`
  - Cursor workspace thread listing
- `/antigravity`
  - Antigravity workspace inventory and search
- `/antigravity/$workspaceKey`
  - Antigravity workspace conversation listing
- `/threads/$threadId`
  - Codex thread detail, transcript, export, and delete
- `/$threadId`
  - shortcut redirect to the thread detail page for pasted Codex thread UUIDs
- `/analytics`
  - Codex token and tool-call analytics with project filter

## Testing

- UI component tests live under `src/**/*.vitest.tsx`.
- The repo root wraps this Vitest suite from `src/ui-package.test.ts`, so `rtk bun test` at the root covers both the Bun tests and the UI tests.
