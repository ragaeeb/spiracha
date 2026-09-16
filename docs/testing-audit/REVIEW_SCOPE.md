# Architecture and review coverage

## Reading and baseline

`AGENTS.md` and `README.md` were read before implementation. Git was initialized in the extracted project and the untouched archive content committed before any edits. The CLI is a thin client, the native runtime is Bun, the UI is TanStack Start, and the portable payload export must avoid local resources and Bun/Node-only dependencies. The removed legacy exporter/MCP/Codex plugin were not restored.

## Surfaces reviewed

| Surface | Existing evidence credited | Added or staged work | Principal remaining work |
|---|---|---|---|
| Coverage/test orchestration | Root LCOV gate, UI Vitest bridge, extensive adjacent tests | Fail-closed reports and exact gate | Unloaded denominator, branch/per-file policy, upstream CI verification |
| Public SDK/API | Typed DTOs, method/error tests, source adapters | HTTP malformed-response matrix; batch/method/UTF-8 invariants; real Codex SDK/API/storage parity | Other 12 native sources, actual transport normalization, response-schema/cancellation policy |
| Markdown/raw/ZIP | Source fixtures, raw/export helpers, collision resolver | Exact normalized Markdown, real raw-byte comparison, unzip content integrity | Fault-injected ZIP pipeline, large resource budgets, filename portability |
| Deletion/recovery | Strong Codex/Cursor fresh-process crash, journal, lock and idempotence tests | Whole-batch no-side-effect assertions, cancellation/hostile-origin browser staging | Confirmed browser delete, fresh-app recovery, durability fault matrix, cross-source preservation |
| Cache/filesystem security | Lock/symlink/cleanup utilities and cache tests | Reproduced in-flight stale-read fix, real directory mode/symlink contracts | Ancestor/TOCTOU policy, source-byte versus memory budget, actual disconnect resources |
| Web import/UI | Provider parsing, bounded process store, many jsdom components | Pure preflight extraction, partial read-success fix, staged upload/reload/artifact journeys | Eviction/deep links, drag/drop/reselection, failures, large views and accessibility |
| Live updates | SSE helpers and client/route mocks already covered | Route ceiling/dedupe/origin/signal assertions; direct URL matrix | Real SharedWorker, multitab/fallback, append/reconnect and socket lifecycle |
| Payload portability | Source conversion fixtures, compiled Bun/Node package consumers and declarations | 12 staged compiled browser/module Worker fixtures | Actual browser execution and Cloudflare-specific consumer |
| Packaging/isolation | Package smoke and installed consumer tests | Strict fixture app environment, output ignore rules | Missing original CLI file, real packed-app browser smoke and platform matrix |

Native registry sources: Antigravity, Claude Code, Cline, Codex, Command Code, Cursor, FX, Grok, Grok Bot, Kiro, MiniMax Code, OpenCode and Qoder. The portable fixture set has 12 sources, including Web; it is not identical to the 13-source native registry. The new joined storage integration covers Codex only.

## Static inventory is a triage aid, not a coverage report

`evidence/inventory.json` records all 381 baseline non-test TS/TSX paths, adjacent/direct test hints and the original test filenames. `evidence/test-catalog.txt` records existing test titles for review. The 100 candidates without an obvious direct/adjacent test reference include generated wrappers, type-only modules and code executed transitively. They must not be reported as definitely untested or converted automatically into 100 ledger findings.

The ledger's 79 items are reviewed behavior/assurance opportunities, not a count of uncovered lines. Overlapping dimensions are explicit: for example the browser harness closes several workflow gaps in one patch, while broad shared-worker/recovery journeys remain pending. Confidence describes confidence in the gap, not confidence that unrun code is production-ready.

## Scope protections

No root application dependencies or bun.lock entries were guessed. No generated route tree was edited. No second app manifest was added. No removed CLI surface was recreated. Runtime fixes were limited to concrete failure boundaries: coverage integrity/exact threshold, in-flight generation, cursor self-consistency, HTTP envelope/MIME checks, evidence response guard, partial import reads and test-process isolation. Filesystem/security/export production algorithms were not rewritten merely to obtain more tests.

## Primary tooling references consulted

These references informed harness design, not claims of successful execution:

- Playwright official web-server documentation: `https://playwright.dev/docs/test-webserver` — working directory, reuseExistingServer and graceful shutdown.
- Playwright official configuration/reference: `https://playwright.dev/docs/test-configuration` and `https://playwright.dev/docs/api/class-testoptions` — projects, fixtures, artifacts and browser context options.
- Bun official coverage documentation: `https://bun.sh/docs/test/code-coverage` — loaded-file coverage behavior and report collection.

Versions must be resolved in the target environment. The archived project's declared Bun >=1.4.2 and TypeScript ^7.0.2 requirements were retained; the limited local TypeScript 5.8.3 checks are not misrepresented as those official toolchains.
