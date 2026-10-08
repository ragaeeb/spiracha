# AGENTS.md

## Purpose

Bun-first local app for importing web conversations and browsing, exporting, and exposing agent conversation history from Codex, Claude Code, Command Code, Cline, Grok, Grok Bot, Kiro, Qoder, Cursor, Antigravity, FX, MiniMax Code, and OpenCode.

The legacy exporter, MCP server, and Codex plugin were removed in the 2.0 hard cut. Do not add bridge commands, compatibility aliases, or deprecated entrypoints back. The CLI is an API-driven thin client; new application workflows should import the stable `spiracha/client` Bun SDK instead of shelling out. Do not bake review semantics into Spiracha; clients decide what a selected message means.

Bun 1.4.2 or newer is required. The compiled `spiracha/payload` export must run without Bun or Node built-ins in Node.js, browsers, and Workers.

## Commands

```bash
rtk bun start               # UI dev server
rtk bun run ui:preview      # after a UI build
rtk bun test                # root suite
rtk bun run test:ui         # Vitest UI suite
rtk bun run lint
rtk bun run typecheck
rtk bun run build
rtk bun run coverage        # 90% line gate, root and UI
rtk bun run test:package    # packaged-entrypoint smoke
rtk bun run test:conformance
```

CLI: `spiracha` (prints help with no args), `serve`, `list [--cwd <path>]`, `get <ref>`, `export <ref> [--raw] [--output <path>]`, `evidence <ref> --lens <file> [--output <path>]`.

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
- Use `it('should...')` style tests; unit tests live next to their implementation.
- `src/ui/routeTree.gen.ts` is generated and must not be manually edited.
- TanStack Start server functions use `.validator(...)`, not `.inputValidator(...)`; API routes use route-level `server.handlers`.
- Keep root-package modules imported by the UI available through `@spiracha/lib/*`. `fflate` is the only runtime dependency.
- Keep `*-transcript-phase.ts` modules browser-safe and keep phase/filtering rules centralized so UI export and the stable API select messages identically.

## Architecture Map

Full module list: `docs/architecture.md`.

- `src/client.ts`: public `spiracha/client` (local or HTTP mode).
- `src/lib/conversation-api.ts`: HTTP handler shared by `src/ui/routes/api.v1.*.ts` and tests (envelopes, validation, dispatch, default selectors).
- `src/lib/conversation-data/`: source registry (`index.ts`), shared types, `*-adapter.ts` per source, selectors, path matching, `evidence-*.ts`, normalized Markdown (`markdown.ts`).
- `src/lib/conversation-payload*.ts`: portable `spiracha/payload`; no storage, file, network, or Keychain access.
- `src/lib/web-chat.ts`, `src/ui/lib/web-chat-server.ts`: UI-only Web imports (bounded process memory).
- `src/lib/<source>-*.ts`: per-source discovery, transcript parsing, phase classification, deletion; Codex has the most (browser queries, analytics, recovery, Cloud).
- `src/ui/`: TanStack Start UI; explicit file routes per source.
- Durable recovery: `docs/codex-deletion-recovery.md`, `docs/cursor-crash-recovery.md`, `docs/grok-bot-deletion.md`.

## Hard Invariants

- `CONVERSATION_SOURCES` is authoritative. A new source needs an exact `SOURCE_CATALOG` entry, a storage adapter registration, and a `SOURCE_ICONS` entry; use `satisfies ConversationAdapter<'source-id'>`. Route metadata and route files must agree.
- Web imports are UI-only: not in `CONVERSATION_SOURCES`, the stable API, or the CLI. Payload conversion is exposed via `spiracha/payload` and the Bun client; Claude Code and Command Code payload conversion is unsupported until portable parsers and fixtures exist.
- Never import storage, React, or router modules into the portable catalog or payload normalizers.
- Explicit source requests surface source failures; all-source collection tolerates missing optional integrations. Workspace sources require `cwd`; global sources (Grok Bot) omit it.
- Reuse canonical message/tool/artifact semantics and common export; do not add another transcript renderer or normalization pipeline. Preserve exact artifact strings and original raw bytes; preview limits must not truncate exports.
- Keep source mutation ownership, file locks, journals, stopped-process checks, rollback/cleanup/retry rules, and worktree protection. Destructive tests must never touch personal or default source stores. Source-code directories are never cleanup targets.
- No production pending states, no-op adapters, or optional callbacks for applicable operations. Compiler-negative expectations live only in `src/type-tests`.

## Reference Docs

- Stable API routes, defaults, and package exports: `docs/stable-api.md` (field detail in `docs/api-reference.md`, `docs/client-reference.md`).
- Module map and build notes: `docs/architecture.md`.
- Test strategy and which tests to update for risky areas: `docs/testing.md`.
- Source-adapter contract and onboarding rules (read before changing adapter/UI/export contracts): `docs/source-adapter-contract.md`.
- Contributor checklist: `docs/contributing.md`; full index: `docs/README.md`.
