# AGENTS.md

## Purpose

This repo is a Bun-first local app for browsing, exporting, and exposing agent conversation history from Codex, Claude Code, Cline, Grok, Kiro, Qoder, Cursor, Antigravity, FX, MiniMax Code, and OpenCode.

The command-line exporter, MCP server, and Codex plugin were removed in the 2.0 hard cut. Do not add bridge commands, compatibility aliases, or deprecated entrypoints back. New client workflows should use the stable HTTP API exposed by the UI server or the stable `spiracha/client` package export.

Main entrypoints:
- `bunx spiracha` for running the packaged UI app
- `rtk bun start` for local development
- `rtk bun run ui:preview` after a UI build
- `rtk bun test`, `rtk bun run lint`, `rtk bun run typecheck`, `rtk bun run build`, and `rtk bun run coverage` for verification
- `rtk bun run test:package` for the packaged-entrypoint smoke test

## Conventions and Rules

- Use `rtk` as the default wrapper for shell commands that produce meaningful stdout or stderr.
- Always use `bun` and `bunx`; do not use `npm` unless absolutely necessary.
- Prefer `Bun.file()` instead of `fs` whenever possible.
- Kill any browser instance or stray `bun`/`node` process you start.
- Prefer arrow functions to classical functions and `type` over `interface` in TypeScript.
- Make fixes using a TDD approach.
- Run `bun run lint`, `bun run typecheck`, and `bun test` before completion after meaningful code changes.
- Never disable a Biome or TypeScript rule without explicit permission.
- Add brief comments only when future agents need context that is not obvious from the code.
- Do not use decorative repeated-character section headers.
- Use `it('should...')` style tests.
- Unit tests live next to their implementation.
- `src/ui/routeTree.gen.ts` is generated and must not be manually edited.

## Architecture

Stable conversation API:
- `src/client.ts`
  - public Bun client export for local serverless access and HTTP access to the same normalized conversation DTOs
- `src/lib/conversation-api.ts`
  - HTTP request handler shared by TanStack API routes and root tests
  - owns response envelopes, validation errors, route dispatch, and default selector behavior
- `src/lib/conversation-data/index.ts`
  - source registry, pagination, path-scoped collection, reference resolution, and normalized Markdown rendering
- `src/lib/conversation-data/types.ts`
  - shared source, message, detail, paging, location, and adapter contracts
- `src/lib/conversation-data/path-match.ts`
  - exact and descendant cwd matching
- `src/lib/conversation-data/message-selector.ts`
  - `all`, `last_assistant`, and `last_final_answer` message selection
- `src/lib/conversation-data/*-adapter.ts`
  - source-specific mapping into normalized conversation shapes
- `src/lib/conversation-data/evidence-*.ts`
  - source-independent lens validation, event pairing, bounded episode selection, projection, and Markdown evidence rendering

Codex browser/export modules:
- `src/lib/codex-browser-db.ts`
  - project/thread browsing queries, delete flows, dashboard summaries, DB path resolution
- `src/lib/codex-browser-export.ts`
  - UI-facing thread download rendering
- `src/lib/codex-browser-types.ts`
  - Codex browser query and presentation contracts
- `src/lib/codex-thread-types.ts`
  - Codex DB row and transcript rendering types
- `src/lib/codex-transcript-renderer.ts`
  - Markdown/plain text rendering for Codex session files
- `src/lib/codex-transcript-filter.ts`
  - centralized hidden bootstrap and transcript-text filtering
- `src/lib/codex-thread-parser.ts`
  - structured Codex event parsing used by analytics and the UI
- `src/lib/codex-analytics.ts`
  - token/tool analytics derived from thread rows plus bounded transcript parsing and cache keys
- `src/lib/codex-optimization-analysis.ts`, `src/lib/codex-optimization-findings.ts`
  - deterministic workflow-risk signals and ranked optimization findings for the Analytics route
- `src/lib/codex-thread-cache.ts`
  - thread-detail cache helpers and deferred rollout/transcript loading state
- `src/lib/codex-global-state.ts`
  - structural cleanup of Codex Desktop recent/sidebar references and deleted-thread write-block flags
- `src/lib/codex-thread-recovery.ts`
  - Codex project recovery helpers

Source-specific browser/export modules:
- `src/lib/claude-code-db.ts`, `src/lib/claude-code-exporter-types.ts`, `src/lib/claude-code-transcript-phase.ts`, `src/lib/claude-code-transcript.ts`
- `src/lib/cline-db.ts`, `src/lib/cline-exporter-types.ts`, `src/lib/cline-transcript.ts`
- `src/lib/grok-db.ts`, `src/lib/grok-exporter-types.ts`, `src/lib/grok-transcript-phase.ts`, `src/lib/grok-transcript.ts`
- `src/lib/kiro-db.ts`, `src/lib/kiro-exporter-types.ts`, `src/lib/kiro-transcript-phase.ts`, `src/lib/kiro-transcript.ts` (detail data exposes history and execution sources separately plus the integrated transcript)
- `src/lib/qoder-db.ts`, `src/lib/qoder-acp-client.ts`, `src/lib/qoder-exporter-types.ts`, `src/lib/qoder-transcript-phase.ts`, `src/lib/qoder-transcript.ts`
- `src/lib/cursor-db.ts`, `src/lib/cursor-exporter-types.ts`, `src/lib/cursor-recovery.ts`, `src/lib/cursor-transcript-phase.ts`, `src/lib/cursor-transcript.ts`
- `src/lib/antigravity-db.ts`, `src/lib/antigravity-exporter-types.ts`, `src/lib/antigravity-keychain.ts`, `src/lib/antigravity-projects.ts`, `src/lib/antigravity-trajectory.ts`, `src/lib/antigravity-transcript-contract.ts`, `src/lib/antigravity-transcript-events.ts`, `src/lib/antigravity-transcript-history.ts`, `src/lib/antigravity-transcript-phase.ts`
- `src/lib/minimax-code-db.ts`, `src/lib/minimax-code-exporter-types.ts`, `src/lib/minimax-code-transcript-phase.ts`, `src/lib/minimax-code-transcript.ts`
- `src/lib/fx-db.ts`, `src/lib/fx-exporter-types.ts`, `src/lib/fx-transcript-phase.ts`, `src/lib/fx-transcript.ts`
- `src/lib/opencode-db.ts`, `src/lib/opencode-exporter-types.ts`, `src/lib/opencode-transcript-phase.ts`, `src/lib/opencode-think-tags.ts`, `src/lib/opencode-transcript.ts`

Shared utilities:
- `src/lib/concurrency.ts`
- `src/lib/bounded-file-cache.ts`
- `src/lib/model-label.ts`
- `src/lib/path-transforms.ts`
- `src/lib/portable-path.ts`
- `src/lib/shared.ts`
- `src/lib/sqlite-error.ts`
- `src/lib/sqlite-retry.ts`
- `src/lib/ui-cache.ts`
- `src/lib/ui-export-archive.ts`
- `src/lib/ui-export-files.ts`
- `src/lib/ui-export-zip.ts`
- `src/lib/conversation-zip-export.ts`
- `src/lib/transcript-load-limiter.ts`
- `src/lib/runtime-config.ts`
- `src/coverage-check.ts`

UI source tree:
- `src/ui/`
  - TanStack Start browser UI
  - API routes live under `src/ui/routes/api.v1.*.ts`
  - source routes include `/threads/$threadId`, `/claude-code-sessions/$sessionId`, `/cline-tasks/$taskId`, `/grok-sessions/$sessionId`, `/kiro-sessions/$sessionId`, `/qoder-sessions/$sessionId`, `/cursor-threads/$composerId`, `/antigravity-conversations/$conversationId`, `/fx-sessions/$sessionId`, `/minimax-code-sessions/$sessionId`, and `/opencode-sessions/$sessionId`
  - Cursor and Antigravity detail routes load large transcript/artifact bodies through post-hydration server queries; Codex exposes deferred loading for oversized rollouts

## Stable API Contract

The package exposes:
- `spiracha/client`
  - `createConversationClient({ mode: 'local' })` for serverless local access
  - `createConversationClient({ mode: 'http', baseUrl })` for a running UI server
- `spiracha/types`
  - normalized conversation DTO types

The local UI server exposes:
- `GET /api/v1/sources`
- `GET /api/v1/conversations?cwd=<absolute-path>&include_messages=true`
- `POST /api/v1/conversation-query`
- `GET /api/v1/conversations/:source/:id`
- `GET /api/v1/conversations/:source/:id/export`
- `POST /api/v1/conversations/:source/:id/evidence`
- `DELETE /api/v1/conversations/:source/:id`
- `POST /api/v1/conversations/delete`
- `POST /api/v1/conversations/export`
- `GET /api/v1/resolve?ref=<url-or-deeplink>`

Defaults:
- list endpoints default to `message_selector=last_final_answer`
- detail endpoints default to `message_selector=all`
- list endpoints omit message bodies unless `include_messages=true`; positive `limit` values are bounded at 200
- list pagination uses opaque keyset cursors ordered by update time, source, and conversation ID
- `updated_after_ms` and `updated_before_ms` constrain collection before pagination
- `source=codex,claude-code,...` may scope collection
- omitted source means all installed/available integrations
- all-source collection should tolerate missing optional integrations
- explicit source requests should surface source-specific failures
- `delete_session_files` is accepted for single-delete query strings and batch-delete JSON; Cursor uses it to keep or remove transcript directories

Do not bake review semantics into Spiracha. A client such as `fgh --collect` decides that a selected assistant message is a review and chooses where to save it.

## Test Strategy

Current tests cover:
- stable conversation API envelopes, validation, source listing, path-scoped collection, message selectors, reference resolution, and Codex adapter mapping
- source-specific discovery, transcript parsing, phase classification, and export rendering
- Codex project/thread browsing, delete semantics, desktop global-state cleanup, analytics, cache keys, and recovery helpers
- Codex optimization findings, deferred transcript loading, and large-export lifecycle behavior
- Cursor recovery/prune behavior, direct composer lookup, bounded discovery caching, optional transcript-file deletion, and cleanup retries
- Claude Code and Kiro bounded discovery/transcript caches with mutation invalidation
- Antigravity discovery, transcript parsing, Keychain state, and artifact export rendering
- MiniMax Code v2 snapshot discovery, reasoning/tool parsing, export rendering, and synchronized session/runtime deletion
- FX checkpoint/event-log transcript reconstruction, externalized tool results, export rendering, and synchronized session/index/latest-pointer deletion
- OpenCode MiniMax `<think>` tag extraction, including code-literal preservation
- UI component and adapter behavior through the Vitest suite wrapped by `src/ui-suite.test.ts`
- package manifest hard-cut guarantees through `src/package-manifest.test.ts`
- package metadata validation, cache lifecycle controls, and deferred detail-body server queries
- a 90% line-coverage gate for both the root Bun suite and UI Vitest suite, with function and hotspot reporting

When changing risky areas:
- Stable API changes: update `src/lib/conversation-api.test.ts` and focused tests under `src/lib/conversation-data/`.
- Source adapter changes: update the matching `src/lib/conversation-data/*-adapter.ts` tests or add one next to the adapter.
- Transcript parsing/rendering: update the matching source transcript tests.
- Codex browsing/delete/analytics: update `src/lib/codex-browser-db.test.ts` and `src/lib/codex-analytics.test.ts`.
- UI behavior: update/add Vitest files under `src/ui/**/*.vitest.tsx`.
- API route behavior: add a real UI server/browser smoke when route registration or SSR behavior changes.

## Common Commands

```bash
rtk bun test
rtk bun run lint
rtk bun run typecheck
rtk bun run build
rtk bun run coverage
rtk bun start
rtk bun run ui:preview
rtk bun run test:ui
```

## Notes

- Keep root-package source modules imported by the UI available through `@spiracha/lib/*`.
- The repository has one package manifest. Keep UI runtime dependencies needed by packaged `bunx spiracha` in root `dependencies` and build/test-only tooling in root `devDependencies`.
- UI Vite commands run from the repository root with `bun --bun`, so TanStack, server functions, the stable API, and the browser route tree all resolve from one manifest and one dependency graph. UI Vitest commands use the normal Node runtime.
- TanStack Start server functions should use `.validator(...)`, not deprecated `.inputValidator(...)`.
- API routes should use route-level `server.handlers`.
- Keep `*-transcript-phase.ts` modules browser-safe; UI client adapters import them directly.
- Keep source-specific phase and filtering rules centralized so the UI export flow and stable API select messages consistently.
