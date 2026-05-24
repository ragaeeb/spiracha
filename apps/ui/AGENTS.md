# AGENTS.md

## Purpose

This package is the local browser UI for Spiracha. It reads the Codex SQLite database and rollout JSONL files through TanStack Start server functions and shared root-package helpers.

## Commands

```bash
rtk bun run dev
rtk bun run build
rtk bun run test
rtk bun run typecheck
```

Important:

- `dev`, `build`, and `preview` run through `bun --bun ...` on purpose. Do not switch them back to plain `vite` or Node execution, because the server functions import Bun-only modules such as `bun:sqlite`.

## Routing

- This package uses TanStack Start with file-based routes in `src/routes/`.
- `src/routeTree.gen.ts` is generated. Do not edit it manually.
- If route typing behaves strangely, delete `src/routeTree.gen.ts` and rebuild with `rtk bun run build` to regenerate it cleanly.

## Shared Data Layer

The UI depends on root-package helpers via `@spiracha/*` path aliases:

- `@spiracha/lib/codex-browser-db`
- `@spiracha/lib/codex-browser-export`
- `@spiracha/lib/codex-thread-cache`
- `@spiracha/lib/codex-analytics`

Keep server-only imports inside server functions or route loaders. Do not import Bun-only modules into purely client-side components.

## Data Access Patterns

Use the existing layers consistently:

- TanStack Start server functions in `src/lib/codex-server.ts`
  - Use for any browser-triggered read/write that needs Bun-only modules, DB access, filesystem access, or shared root-package helpers.
- TanStack Query query options in `src/lib/codex-queries.ts`
  - Use for client-side fetching, caching, retries, and invalidation of server-function results.
- Shared root-package helpers under `@spiracha/lib/*`
  - Extend these when the behavior should stay shared between the UI, CLI, and packaged launcher.
- `settings-store.tsx`
  - Use only for browser-local UI preferences. Do not put server-derived Codex data here.

If a feature needs new Codex data, prefer:
1. shared root-package helper changes
2. server-function exposure in `codex-server.ts`
3. TanStack Query wiring in `codex-queries.ts`
4. client component consumption

## Testing

- UI component tests live under `src/**/*.vitest.tsx`.
- The root package wraps this Vitest suite from `src/ui-package.test.ts` so `rtk bun test` at the repo root exercises both the Bun suite and the UI suite.

## Design

- The UI is intentionally compact, text-first, and operational. Avoid adding decorative cards, large gradients, or chat-bubble styling.
- Prefer deterministic date formatting to avoid hydration mismatches between server and client.

## Constraints

- Do not add a second database.
- Do not duplicate transcript parsing or export rendering in this package.
- Use the shared root-package helpers instead.
