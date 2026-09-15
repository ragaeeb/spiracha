# Validation and limitations

## What actually ran

The audit was performed against the supplied ZIP, with Git initialized before edits. The original tree is commit `b929a9d1f54300909a907d0b3407eabdbf359b59`.

| Check | Observed result | Scope / limitation |
|---|---|---|
| Independent Node production-module assertions | **622 assertions, 10 groups, 0 failed groups** | Node 22.16.0 using a TypeScript 5.8.3 source loader; actual production functions and real temporary files where applicable. Not Bun, Vitest, Playwright, coverage or the installed package. |
| Controlled baseline/head reproductions | Coverage, in-flight cache and cursor failures reproduced before; targeted cases corrected after | JSONL before/after evidence is included. These are not the entire upstream suite. |
| TypeScript parse diagnostics | **36 changed TS/TSX files, 0 parse errors** | Syntax only; does not resolve dependencies, check full semantics or replace Biome. |
| Narrow production semantic typecheck | **8 explicitly selected modules passed** | TypeScript 5.8.3 and available Node types, not the project's declared ^7.0.2 compiler or whole dependency graph. |
| Broader 9-module semantic attempt | Blocked by missing `Bun` type in transitive `shared.ts` | The unsuccessful attempt is preserved instead of concealed. The import-helper graph is not part of the eight-module pass. |
| Git whitespace checks | Passed for code changes | No assertion of Biome formatting compliance. |
| Canonical project checks | **Blocked** | Actual command output is saved; see below. |
| Browser launch / E2E | **Not run** | Bun, installed application dependencies, Playwright package/browser and complete build are unavailable. |

The independent groups contain 22 LCOV, 29 origin, 10 private-directory, 22 cache, 379 pagination, 6 Markdown, 12 evidence, 10 import, 59 isolation/live-URL and 73 portable-payload assertions. Assertions are not test-file or test-case counts.

The eight semantic-check entry modules are `bounded-file-cache.ts`, `private-runtime-directory.ts`, `conversation-data/pagination.ts`, `conversation-data/markdown.ts`, `isolated-runtime-test-helpers.ts`, `ui/lib/evidence-export.ts`, `ui/lib/web-chat-limits.ts`, and `ui/lib/codex-thread-live-url.ts`.

## Commands attempted and blocked

`bun run lint`, `bun run typecheck`, `bun test`, `bun run test:ui`, `bun run coverage`, `bun run build`, and `bun run test:package` all exited 127 because `bun` is not installed. `rtk` is also unavailable. The container dependency-network probe failed DNS resolution (curl exit 6). No npm substitution, runtime shim, fabricated dependency version or hand-edited lockfile was used.

The supplied archive also lacks `bin/spiracha.ts`, which the package's manifest/build/smoke scripts require. The existing `package-manifest.test.ts` already checks this. Restore the actual upstream file before full package acceptance; do not create a dummy entrypoint.

`@playwright/test` is intentionally an **optional staged dependency**, not falsely recorded as installed. `testing/e2e/README.md` explains adding an exact resolved version with Bun to the existing root manifest and lockfile and installing Chromium. This remains work for Codex before the staged browser findings can be marked complete.

## Reproduce supplemental checks

The delivery ZIP contains `audit-tools/ts-loader.mjs` and `audit-tools/node-checks.mjs`. From the actual project root after dependency installation:

```bash
node --no-warnings --loader /absolute/path/to/delivery/audit-tools/ts-loader.mjs \
  /absolute/path/to/delivery/audit-tools/node-checks.mjs
```

The loader resolves the root project's TypeScript. Set `SPIRACHA_AUDIT_TYPESCRIPT` only when using a specific locally installed compiler; the saved run used `/usr/local/slides_js/node_modules/typescript/lib/typescript.js` in this audit environment, not a path the recipient is expected to have. `SPIRACHA_AUDIT_ROOT` can select a different project root. The checks deliberately do not emulate Bun APIs and therefore omit SQLite/real Bun HTTP/ZIP/Vitest/browser assertions.

Read `evidence/` in this directory for immutable execution output. Final selective-apply, full-series tree-equality and archive checks are generated after the documentation commit and live under the delivery's top-level `evidence/`; they cannot be self-recorded inside the commit they validate.

## What has not been established

No full suite pass, coverage percentage, coverage delta, official TypeScript pass, Biome pass, build success, installed package success or browser success is claimed. Timing/platform flakes and selector drift can still emerge on first canonical execution. The pending ledger is not presented as already fixed.

The baseline snapshot has 624 files, 221 existing test files (120 Bun and 101 Vitest), and 381 other TS/TSX files. The implementation adds 15 new unit/integration test files and 3 browser spec files, and extends 3 existing test files. The 3 browser files contain six workflow cases and twelve fixture-driven portable-SDK cases; those cases have not run.
