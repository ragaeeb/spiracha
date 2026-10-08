# Testing strategy

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
- Web import parsing for mapping-based, native Claude/Grok, and generic role/content exports, provider detection, separate reasoning, embedded research/tool events, partial import errors, bounded retention, and Web UI server functions
- Grok Bot roster/replica discovery, bounded parsing, deterministic attribution, global scope, and byte-exact read-only raw export
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
