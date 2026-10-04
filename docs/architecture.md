# Architecture and module map

Reference map for contributors and agents. `AGENTS.md` carries only the compact version.

## Stable conversation API

- `src/client.ts`
  - public Bun client export for local serverless access and HTTP access to the same normalized conversation DTOs
- `src/lib/conversation-payload.ts`, `src/lib/conversation-payload-*.ts`
  - `spiracha/payload` portable entrypoint (compiled JS and declarations), also exposed by the Bun client; public `convertConversationPayload` SDK workflow for in-memory JSON/JSONL inference and normalized Markdown; source parsers must not load files, databases, network resources, or Keychain data from supplied payloads
- `src/lib/conversation-api.ts`
  - HTTP request handler shared by TanStack API routes and root tests
  - owns response envelopes, validation errors, route dispatch, and default selector behavior
- `src/lib/conversation-data/index.ts`
  - source registry, pagination, path-scoped collection, reference resolution, and normalized Markdown rendering
- `src/lib/conversation-data/types.ts`
  - shared source, message, detail, paging, location, and adapter contracts
- `src/lib/conversation-data/conversation-events.ts`
  - generic transcript presentation events and visibility filtering
- `src/lib/conversation-data/path-match.ts`
  - exact and descendant cwd matching
- `src/lib/conversation-data/message-selector.ts`
  - `all`, `last_assistant`, and `last_final_answer` message selection
- `src/lib/conversation-data/*-adapter.ts`
  - source-specific mapping into normalized conversation shapes
- `src/lib/conversation-data/evidence-*.ts`
  - source-independent lens validation, event pairing, bounded episode selection, projection, and Markdown evidence rendering

## Web import modules

- `src/lib/web-chat.ts`
  - provider-aware JSON import parsing, reasoning/tool-event normalization, generated UI IDs, and bounded in-memory retention
- `src/ui/lib/web-chat-server.ts`
  - validated server functions for importing, listing, and loading normalized Web conversations

## Codex browser/export modules

- `src/lib/codex-database.ts`, `src/lib/codex-fallback-index.ts`, `src/lib/codex-browser-queries.ts`, `src/lib/codex-dashboard.ts`, `src/lib/codex-thread-mutations.ts`
  - project/thread browsing queries, delete flows, dashboard summaries, DB path resolution
- `src/lib/codex-cloud.ts`, `src/lib/codex-cloud-transcript.ts`
  - authenticated, read-only Cloud browsing and normalized task transcripts; the Codex CLI owns login refresh
- `src/lib/agent-dx-analytics.ts`
  - deterministic goal-span analytics and JSON/CSV export; command classification is conservative and heuristic
- `src/lib/codex-browser-export.ts`
  - UI-facing thread download rendering
- `src/lib/codex-browser-types.ts`
  - Codex browser query and presentation contracts
- `src/lib/codex-thread-types.ts`
  - Codex DB row and transcript rendering types
- `src/lib/codex-transcript-renderer.ts`
  - Markdown/plain text rendering for Codex session files
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
- `src/lib/codex-deletion-journal.ts`, `src/lib/cursor-operation-journal.ts`
  - durable deletion/recovery intents and restart reconciliation; see `docs/codex-deletion-recovery.md` and `docs/cursor-crash-recovery.md`

## Source-specific browser/export modules

- `src/lib/claude-code-db.ts`, `src/lib/claude-code-exporter-types.ts`, `src/lib/claude-code-transcript-phase.ts`, `src/lib/claude-code-transcript.ts`
- `src/lib/command-code-db.ts`, `src/lib/command-code-exporter-types.ts`
- `src/lib/cline-db.ts`, `src/lib/cline-exporter-types.ts`, `src/lib/cline-transcript.ts`
- `src/lib/grok-db.ts`, `src/lib/grok-exporter-types.ts`, `src/lib/grok-transcript-phase.ts`, `src/lib/grok-transcript.ts`
- `src/lib/grok-bot-db.ts`, `src/lib/conversation-data/grok-bot-adapter.ts`
- `src/lib/kiro-db.ts`, `src/lib/kiro-exporter-types.ts`, `src/lib/kiro-transcript-phase.ts`, `src/lib/kiro-transcript.ts` (detail data exposes history and execution sources separately plus the integrated transcript)
- `src/lib/qoder-storage.ts`, `src/lib/qoder-sessions.ts`, `src/lib/qoder-session-transcript.ts`, `src/lib/qoder-acp-client.ts`, `src/lib/qoder-exporter-types.ts`, `src/lib/qoder-transcript-phase.ts`, `src/lib/qoder-transcript.ts`
- `src/lib/cursor-db.ts`, `src/lib/cursor-exporter-types.ts`, `src/lib/cursor-recovery.ts`, `src/lib/cursor-transcript-phase.ts`, `src/lib/cursor-transcript.ts`
- `src/lib/antigravity-db.ts`, `src/lib/antigravity-exporter-types.ts`, `src/lib/antigravity-keychain.ts`, `src/lib/antigravity-projects.ts`, `src/lib/antigravity-trajectory.ts`, `src/lib/antigravity-transcript-contract.ts`, `src/lib/antigravity-transcript-events.ts`, `src/lib/antigravity-transcript-history.ts`, `src/lib/antigravity-transcript-phase.ts`
- `src/lib/minimax-code-db.ts`, `src/lib/minimax-code-exporter-types.ts`, `src/lib/minimax-code-transcript-phase.ts`, `src/lib/minimax-code-transcript.ts`
- `src/lib/fx-db.ts`, `src/lib/fx-exporter-types.ts`, `src/lib/fx-transcript-phase.ts`, `src/lib/fx-transcript.ts`
- `src/lib/opencode-db.ts`, `src/lib/opencode-exporter-types.ts`, `src/lib/opencode-transcript-phase.ts`, `src/lib/opencode-think-tags.ts`, `src/lib/opencode-transcript.ts`

## Shared utilities

- `src/lib/concurrency.ts`
- `src/lib/bounded-file-cache.ts`
- `src/lib/model-label.ts`
- `src/lib/path-transforms.ts`
- `src/lib/portable-path.ts`
- `src/lib/shared.ts`, `src/lib/shared-text.ts` (I/O and portable text helpers)
- `src/lib/conversation-data/markdown.ts` (portable normalized Markdown rendering)
- `src/lib/codex-transcript-records.ts`, `src/lib/codex-cloud-transcript.ts` (portable Codex normalization)
- `src/lib/sqlite-error.ts`
- `src/lib/sqlite-retry.ts` (async backoff; database callbacks remain synchronous)
- `src/lib/file-mutation-lock.ts` (cross-process SQLite lock for source-file mutations)
- `src/lib/ui-cache.ts`
- `src/lib/ui-export-archive.ts`
- `src/lib/ui-export-files.ts`
- `src/lib/ui-export-zip.ts`
- `src/lib/conversation-zip-export.ts`
- `src/lib/transcript-load-limiter.ts`
- `src/lib/runtime-config.ts`
- `src/coverage-check.ts`

## UI source tree

- `src/ui/`
  - TanStack Start browser UI
  - API routes live under `src/ui/routes/api.v1.*.ts`
  - source routes include `/threads/$threadId`, `/claude-code-sessions/$sessionId`, `/command-code-sessions/$sessionId`, `/cline-tasks/$taskId`, `/grok-sessions/$sessionId`, `/grok-bot-chats/$conversationId`, `/kiro-sessions/$sessionId`, `/qoder-sessions/$sessionId`, `/cursor-threads/$composerId`, `/antigravity-conversations/$conversationId`, `/fx-sessions/$sessionId`, `/minimax-code-sessions/$sessionId`, and `/opencode-sessions/$sessionId`
  - Web import routes are `/web` and `/web-chats/$conversationId`; imported conversations use server functions and remain in bounded process memory
  - Cursor and Antigravity detail routes load large transcript/artifact bodies through post-hydration server queries; Codex exposes deferred loading for oversized rollouts

## Build and runtime notes

- Keep root-package source modules imported by the UI available through `@spiracha/lib/*`.
- The repository has one package manifest. `fflate` is the only runtime dependency; UI, Vite, and build/test tooling stays in root `devDependencies`.
- `bun start` runs UI development. `bun run build` emits bundled client assets and a bundled server entrypoint consumed by `spiracha serve`; the published package does not ship the UI source tree or Vite toolchain.
- UI Vite commands run from the repository root with `bun --bun`, so TanStack, server functions, the stable API, and the browser route tree all resolve through one development dependency graph. UI Vitest commands use the normal Node runtime.
- Markdown output remains deterministic generation/domain parsing. Bun 1.4's `Bun.markdown` was evaluated but is unstable for this contract and is not used.
- TanStack Start server functions should use `.validator(...)`, not deprecated `.inputValidator(...)`.
- API routes should use route-level `server.handlers`.
- Keep `*-transcript-phase.ts` modules browser-safe; UI client adapters import them directly.
- Keep source-specific phase and filtering rules centralized so the UI export flow and stable API select messages consistently.
