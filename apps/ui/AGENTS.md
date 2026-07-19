# AGENTS.md

## Purpose

This directory is the local browser UI source tree for Spiracha. It reads Codex, Claude Code, Grok, Kiro, Qoder, Cursor, Antigravity, and OpenCode local data through TanStack Start server functions and shared root-package helpers.

## Commands

```bash
rtk bun start
rtk bun run build
rtk bun run test:ui
rtk bun run typecheck
rtk bun run coverage
```

Run these commands from the repository root. There is intentionally no nested UI package manifest.

Important:

- `start`, `build`, and `ui:preview` run Vite through `bun --bun ...` on purpose. Do not switch them back to Node execution, because the server functions import Bun-only modules such as `bun:sqlite`.
- Those root-owned Vite scripts use `apps/ui` as their internal working directory because TanStack Start derives part of its dev-server plan from the process working directory.
- Keep UI runtime dependencies needed by the packaged `bunx spiracha` launcher in the root `dependencies`. Keep build and test tooling in the root `devDependencies`.
- Keep Vitest on its normal Node runtime; forcing it through `bun --bun` breaks test-environment module and global behavior.

## Routing

- This package uses TanStack Start with file-based routes in `src/routes/`.
- `src/routeTree.gen.ts` is generated. Do not edit it manually.
- If route typing behaves strangely, delete `src/routeTree.gen.ts` and rebuild with `rtk bun run build` to regenerate it cleanly.
- Stable API routes live in `src/routes/api.v1.*.ts` and should stay thin wrappers around `@spiracha/lib/conversation-api`.
- The UI supports both `/threads/$threadId` and a root shortcut route `/$threadId` that redirects straight to the thread detail page.
- Codex project inventory and project-thread search use route search params. `/codex` and `/codex/$project` use `q`.
- Codex analytics uses the `project` route search param so filtered analytics links can be bookmarked and reloaded.
- Claude Code session detail lives at `/claude-code-sessions/$sessionId`.
- Grok session detail lives at `/grok-sessions/$sessionId`.
- Kiro session detail lives at `/kiro-sessions/$sessionId`.
- Qoder session detail lives at `/qoder-sessions/$sessionId`.
- Cursor thread detail lives at `/cursor-threads/$composerId`.
- Antigravity conversation detail lives at `/antigravity-conversations/$conversationId`.
- OpenCode session detail lives at `/opencode-sessions/$sessionId`.
- Keep the Codex, Claude Code, Grok, Kiro, Qoder, Cursor, Antigravity, and OpenCode list/detail pages aligned around the same table-driven index/detail pattern when adding new source integrations.

## Shared Data Layer

The UI depends on root-package helpers via `@spiracha/*` path aliases:

- `@spiracha/lib/codex-browser-db`
- `@spiracha/lib/codex-browser-export`
- `@spiracha/lib/codex-thread-cache`
- `@spiracha/lib/codex-analytics`
- `@spiracha/lib/concurrency`
- `@spiracha/lib/claude-code-db`
- `@spiracha/lib/claude-code-transcript-phase`
- `@spiracha/lib/claude-code-transcript`
- `@spiracha/lib/grok-db`
- `@spiracha/lib/grok-transcript-phase`
- `@spiracha/lib/grok-transcript`
- `@spiracha/lib/kiro-db`
- `@spiracha/lib/kiro-transcript-phase`
- `@spiracha/lib/kiro-transcript`
- `@spiracha/lib/qoder-db`
- `@spiracha/lib/qoder-transcript-phase`
- `@spiracha/lib/qoder-transcript`
- `@spiracha/lib/cursor-db`
- `@spiracha/lib/cursor-recovery`
- `@spiracha/lib/cursor-transcript`
- `@spiracha/lib/antigravity-db`
- `@spiracha/lib/antigravity-keychain`
- `@spiracha/lib/opencode-db`
- `@spiracha/lib/opencode-transcript-phase`
- `@spiracha/lib/opencode-think-tags`
- `@spiracha/lib/opencode-transcript`
- `@spiracha/lib/conversation-api`
- `@spiracha/lib/conversation-data`

Keep server-only imports inside server functions or route loaders. Do not import Bun-only modules into purely client-side components.
The `*-transcript-phase` helpers are intentionally browser-safe and may be imported by client adapters.

## Data Access Patterns

Use the existing layers consistently:

- TanStack Start server functions in `src/lib/codex-server.ts`, `src/lib/claude-code-server.ts`, `src/lib/grok-server.ts`, `src/lib/kiro-server.ts`, `src/lib/qoder-server.ts`, `src/lib/cursor-server.ts`, `src/lib/antigravity-server.ts`, and `src/lib/opencode-server.ts`
  - Use for any browser-triggered read/write that needs Bun-only modules, DB access, filesystem access, Keychain access, or shared root-package helpers.
  - Use `.validator(...)` for input validation. Do not add new `.inputValidator(...)` calls.
- TanStack Query query options in `src/lib/codex-queries.ts`, `src/lib/claude-code-queries.ts`, `src/lib/grok-queries.ts`, `src/lib/kiro-queries.ts`, `src/lib/qoder-queries.ts`, `src/lib/cursor-queries.ts`, `src/lib/antigravity-queries.ts`, and `src/lib/opencode-queries.ts`
  - Use for client-side fetching, caching, retries, and invalidation of server-function results.
- Shared root-package helpers under `@spiracha/lib/*`
  - Extend these when the behavior should stay shared between the UI and the stable data API.
  - Use the shared source-specific phase helpers for assistant commentary/final-answer rules instead of duplicating that logic in UI adapters.
  - Keep OpenCode think-tag handling in `@spiracha/lib/opencode-think-tags` so UI display and exports strip MiniMax reasoning tags consistently.
- Stable API route handlers in `src/routes/api.v1.*.ts`
  - Use route-level `server.handlers`.
  - Delegate to `@spiracha/lib/conversation-api` instead of duplicating parsing or response-envelope logic.
- `src/lib/source-session-export-server.ts`
  - Use for single-session source exports that may return either inline content or a temporary zip download URL.
- `settings-store.tsx`
  - Use only for browser-local UI preferences. Do not put server-derived source data here.

If a feature needs new source data, prefer:
1. shared root-package helper changes
2. server-function exposure in the matching `*-server.ts`
3. TanStack Query wiring in the matching `*-queries.ts`
4. client component consumption

For URL-backed route state, use `src/lib/route-search.ts` instead of ad hoc parsing in route files. Keep search params minimal and stable because they are user-facing links.

## Testing

- UI component tests live under `src/**/*.vitest.tsx`.
- Source-specific transcript adapter tests live next to their adapter files under `src/lib/*.vitest.ts`.
- Route search parsing tests live next to the helper in `src/lib/route-search.vitest.ts`.
- The root package wraps this Vitest suite from `src/ui-suite.test.ts` so `rtk bun test` exercises both the Bun suite and the UI suite.

## Design

- The UI is intentionally compact, text-first, and operational. Avoid adding decorative cards, large gradients, or chat-bubble styling.
- Prefer deterministic date formatting to avoid hydration mismatches between server and client.

## Constraints

- Do not add a second database.
- Do not duplicate transcript parsing or export rendering in the UI source tree.
- Use the shared root-package helpers instead.
