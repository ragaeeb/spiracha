# AGENTS.md

## Purpose

This package is the local browser UI for Spiracha. It reads Codex, Claude Code, Kiro, Cursor, Antigravity, and OpenCode local data through TanStack Start server functions and shared root-package helpers.

## Commands

```bash
rtk bun run dev
rtk bun run build
rtk bun run test
rtk bun run typecheck
rtk bun run coverage
```

Important:

- `dev`, `build`, and `preview` run through `bun --bun ...` on purpose. Do not switch them back to plain `vite` or Node execution, because the server functions import Bun-only modules such as `bun:sqlite`.
- Keep TanStack/React runtime dependency versions aligned with the root package when both manifests list the same package. Version drift can break packaged server-function manifests in production.

## Routing

- This package uses TanStack Start with file-based routes in `src/routes/`.
- `src/routeTree.gen.ts` is generated. Do not edit it manually.
- If route typing behaves strangely, delete `src/routeTree.gen.ts` and rebuild with `rtk bun run build` to regenerate it cleanly.
- The UI supports both `/threads/$threadId` and a root shortcut route `/$threadId` that redirects straight to the thread detail page.
- Codex project inventory and project-thread search use route search params. `/projects` and `/projects/$project` use `q`.
- Codex analytics uses the `project` route search param so filtered analytics links can be bookmarked and reloaded.
- Claude Code session detail lives at `/claude-code-sessions/$sessionId`.
- Kiro session detail lives at `/kiro-sessions/$sessionId`.
- Cursor thread detail lives at `/cursor-threads/$composerId`.
- Antigravity conversation detail lives at `/antigravity-conversations/$conversationId`.
- OpenCode session detail lives at `/opencode-sessions/$sessionId`.
- Keep the Codex, Claude Code, Kiro, Cursor, Antigravity, and OpenCode list/detail pages aligned around the same table-driven index/detail pattern when adding new source integrations.

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
- `@spiracha/lib/kiro-db`
- `@spiracha/lib/kiro-transcript-phase`
- `@spiracha/lib/kiro-transcript`
- `@spiracha/lib/cursor-db`
- `@spiracha/lib/cursor-recovery`
- `@spiracha/lib/cursor-transcript`
- `@spiracha/lib/antigravity-db`
- `@spiracha/lib/antigravity-keychain`
- `@spiracha/lib/opencode-db`
- `@spiracha/lib/opencode-transcript-phase`
- `@spiracha/lib/opencode-transcript`

Keep server-only imports inside server functions or route loaders. Do not import Bun-only modules into purely client-side components.
The `*-transcript-phase` helpers are intentionally browser-safe and may be imported by client adapters.

## Data Access Patterns

Use the existing layers consistently:

- TanStack Start server functions in `src/lib/codex-server.ts`, `src/lib/claude-code-server.ts`, `src/lib/kiro-server.ts`, `src/lib/cursor-server.ts`, `src/lib/antigravity-server.ts`, and `src/lib/opencode-server.ts`
  - Use for any browser-triggered read/write that needs Bun-only modules, DB access, filesystem access, Keychain access, or shared root-package helpers.
  - Use `.validator(...)` for input validation. Do not add new `.inputValidator(...)` calls.
- TanStack Query query options in `src/lib/codex-queries.ts`, `src/lib/claude-code-queries.ts`, `src/lib/kiro-queries.ts`, `src/lib/cursor-queries.ts`, `src/lib/antigravity-queries.ts`, and `src/lib/opencode-queries.ts`
  - Use for client-side fetching, caching, retries, and invalidation of server-function results.
- Shared root-package helpers under `@spiracha/lib/*`
  - Extend these when the behavior should stay shared between the UI, CLI, and packaged launcher.
  - Use the shared source-specific phase helpers for assistant commentary/final-answer rules instead of duplicating that logic in UI adapters.
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
- The root package wraps this Vitest suite from `src/ui-package.test.ts` so `rtk bun test` at the repo root exercises both the Bun suite and the UI suite.

## Design

- The UI is intentionally compact, text-first, and operational. Avoid adding decorative cards, large gradients, or chat-bubble styling.
- Prefer deterministic date formatting to avoid hydration mismatches between server and client.

## Constraints

- Do not add a second database.
- Do not duplicate transcript parsing or export rendering in this package.
- Use the shared root-package helpers instead.
