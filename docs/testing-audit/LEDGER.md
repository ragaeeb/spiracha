# Prioritized testing-gap ledger

Archive: `spiracha-v2.9.0.zip` · audit: 2026-09-15 · baseline: `b929a9d1f54300909a907d0b3407eabdbf359b59`

**79 reviewed findings: 32 implemented, 5 partially implemented browser findings, 42 pending.** Nineteen selective code commits accompany this ledger. Implemented does **not** mean the Bun/Vitest/browser suites passed; see [VALIDATION.md](VALIDATION.md).

## Scoring and scope

P0 blocks trustworthy verification. P1 prioritizes data integrity, destructive operations, security and primary workflows. P2 covers important edge cases, portability, observability and design-dependent improvements. Confidence is confidence in the **gap**, not an execution guarantee. Complexity is an ordinal 1–5 implementation score, not a time estimate. 1 = narrow; 2 = focused suite/helper; 3 = joined modules/fixtures; 4 = browser/process/platform harness; 5 = crash/durability orchestration.

The table is sorted by priority, then confidence descending, complexity ascending and stable ID. This gives a deterministic order among equal-priority entries, not a false estimate of business value. Dependencies are in the individual patch notes. Findings may share a patch because related assertions belong to one coherent change.

This is a broad audit of the supplied snapshot, not a mathematical claim of exhaustiveness. Existing test assertions and architecture were reviewed; no coverage percentage was obtained. The static inventory’s 100 no-obvious-direct-test candidates are deliberately **not** counted as 100 proven gaps. They include generated, type-only and transitively exercised modules.

## Ranked index

| Rank | ID | Priority | Confidence | Complexity | State | Patch | Finding |
|---:|---|---|---:|---:|---|---|---|
| 1 | [TG-001](#tg-001) | P0 | 100% | 2/5 | implemented | PATCH-01 | Coverage gate accepts empty or non-measurable reports |
| 2 | [TG-002](#tg-002) | P1 | 100% | 1/5 | implemented | PATCH-01 | Rounded percentages can pass a below-threshold build |
| 3 | [TG-003](#tg-003) | P1 | 100% | 2/5 | implemented | PATCH-01 | Malformed LCOV counters can bypass or distort the gate |
| 4 | [TG-004](#tg-004) | P1 | 100% | 2/5 | implemented | PATCH-06 | Cache invalidation reuses an older in-flight loader |
| 5 | [TG-012](#tg-012) | P1 | 100% | 2/5 | implemented | PATCH-04 | Malformed success envelopes leak untyped failures or falsely typed values |
| 6 | [TG-016](#tg-016) | P1 | 100% | 2/5 | implemented | PATCH-18 | Generated cursors do not round-trip supported long or Unicode IDs |
| 7 | [TG-010](#tg-010) | P1 | 100% | 3/5 | implemented | PATCH-14 | Public local and HTTP clients lack real storage parity integration |
| 8 | [TG-026](#tg-026) | P1 | 100% | 3/5 | partial | PATCH-16 | No browser download assertion for original artifact bytes |
| 9 | [TG-027](#tg-027) | P1 | 100% | 3/5 | partial | PATCH-16 | No browser native conversation export-dialog journey |
| 10 | [TG-028](#tg-028) | P1 | 100% | 3/5 | partial | PATCH-16 | No real-browser delete-cancel or production hostile-origin safety journey |
| 11 | [TG-025](#tg-025) | P1 | 100% | 4/5 | partial | PATCH-16 | No production-browser import, hydration and reload journey |
| 12 | [TG-029](#tg-029) | P1 | 100% | 4/5 | partial | PATCH-17 | Portable payload package is not exercised in a browser or module Worker |
| 13 | [TG-038](#tg-038) | P1 | 99% | 3/5 | pending | — | Coverage denominator omits modules never loaded by tests |
| 14 | [TG-039](#tg-039) | P1 | 99% | 3/5 | pending | — | Aggregate line coverage alone misses critical branches and low-coverage files |
| 15 | [TG-040](#tg-040) | P1 | 99% | 3/5 | pending | — | UI exclusions hide route orchestration and critical server bridges |
| 16 | [TG-043](#tg-043) | P1 | 99% | 4/5 | pending | — | Real local/HTTP source conformance stops at the new Codex fixture |
| 17 | [TG-044](#tg-044) | P1 | 99% | 4/5 | pending | — | Confirmed browser deletion is not covered end to end |
| 18 | [TG-048](#tg-048) | P1 | 99% | 4/5 | pending | — | Real SharedWorker and fallback live streaming are untested across browser tabs |
| 19 | [TG-013](#tg-013) | P1 | 98% | 1/5 | implemented | PATCH-04 | A successful non-ZIP response is accepted as an archive |
| 20 | [TG-006](#tg-006) | P1 | 98% | 2/5 | implemented | PATCH-02 | Loopback security lacks a systematic hostile-origin matrix |
| 21 | [TG-007](#tg-007) | P1 | 98% | 2/5 | implemented | PATCH-05 | Whole-batch validation must precede any destructive side effect |
| 22 | [TG-008](#tg-008) | P1 | 98% | 2/5 | implemented | PATCH-05, PATCH-14 | Batch export needs an explicit all-or-nothing missing-item assertion |
| 23 | [TG-011](#tg-011) | P1 | 98% | 2/5 | implemented | PATCH-14 | Raw HTTP export needs byte equality against the original rollout |
| 24 | [TG-020](#tg-020) | P1 | 98% | 2/5 | implemented | PATCH-12 | Browser import preflight boundaries are buried in an excluded route |
| 25 | [TG-021](#tg-021) | P1 | 98% | 2/5 | implemented | PATCH-12 | One File.text failure discards otherwise readable selected imports |
| 26 | [TG-023](#tg-023) | P1 | 98% | 2/5 | implemented | PATCH-11 | Live route unique-ID ceiling and denied-origin no-I/O contract need direct tests |
| 27 | [TG-005](#tg-005) | P1 | 98% | 3/5 | implemented | PATCH-15 | Smoke subprocess inherits developer homes, source locations and credentials |
| 28 | [TG-064](#tg-064) | P1 | 98% | 3/5 | pending | — | Browser network failure and interrupted download need honest error states |
| 29 | [TG-045](#tg-045) | P1 | 98% | 5/5 | pending | — | Crash recovery is not verified through a freshly started app and public API |
| 30 | [TG-051](#tg-051) | P1 | 97% | 3/5 | pending | — | Other JSON endpoints need explicit request-body budget and streaming tests |
| 31 | [TG-066](#tg-066) | P1 | 97% | 3/5 | pending | — | Hostile transcript rendering needs browser execution-safety tests |
| 32 | [TG-077](#tg-077) | P1 | 97% | 3/5 | pending | — | Missing/unreadable DB and deferred rollout errors need complete UI/API journeys |
| 33 | [TG-049](#tg-049) | P1 | 97% | 4/5 | pending | — | Real SSE append and reconnect need browser-level sequence invariants |
| 34 | [TG-050](#tg-050) | P1 | 97% | 4/5 | pending | — | Actual HTTP disconnect cleanup lacks a socket-to-monitor integration assertion |
| 35 | [TG-075](#tg-075) | P1 | 97% | 4/5 | pending | — | Destructive source adapters need public-surface preservation invariants |
| 36 | [TG-014](#tg-014) | P1 | 96% | 2/5 | implemented | PATCH-05 | Invalid UTF-8 must fail before portable payload conversion |
| 37 | [TG-015](#tg-015) | P1 | 96% | 2/5 | implemented | PATCH-03 | Private runtime directory invariants have no focused filesystem suite |
| 38 | [TG-018](#tg-018) | P1 | 96% | 2/5 | implemented | PATCH-09 | ZIP tests need body-level proof for colliding filenames |
| 39 | [TG-019](#tg-019) | P1 | 96% | 2/5 | implemented | PATCH-08 | Normalized Markdown renderer lacks exact contract-focused tests |
| 40 | [TG-047](#tg-047) | P1 | 96% | 4/5 | pending | — | Concurrent public reads and deletes lack cross-process freshness tests |
| 41 | [TG-009](#tg-009) | P1 | 95% | 2/5 | implemented | PATCH-05 | Partial deletion and cleanup errors need a stable batch response contract |
| 42 | [TG-076](#tg-076) | P1 | 95% | 3/5 | pending | — | Real server URL normalization and encoded-path security need joined tests |
| 43 | [TG-056](#tg-056) | P1 | 94% | 3/5 | pending | — | ZIP pipeline cleanup needs injected failures at actual pipeline stages |
| 44 | [TG-046](#tg-046) | P1 | 94% | 5/5 | pending | — | Journal durability needs a cross-stage storage-fault matrix |
| 45 | [TG-057](#tg-057) | P1 | 90% | 4/5 | pending | — | Large export/import resource budgets lack repeatable stress evidence |
| 46 | [TG-054](#tg-054) | P1 | 87% | 4/5 | pending | — | Private directory ancestor symlinks and TOCTOU policy are unspecified |
| 47 | [TG-041](#tg-041) | P1 | 85% | 3/5 | pending | — | CI enforcement and runtime matrix cannot be established from the archive |
| 48 | [TG-022](#tg-022) | P2 | 100% | 1/5 | implemented | PATCH-10 | Evidence export client lacks direct malformed-response coverage |
| 49 | [TG-037](#tg-037) | P2 | 100% | 1/5 | implemented | PATCH-19 | Archive lacks ignore rules for generated test evidence and dependencies |
| 50 | [TG-017](#tg-017) | P2 | 100% | 2/5 | implemented | PATCH-18 | Finite but unsafe timestamps can produce self-invalidating cursors |
| 51 | [TG-062](#tg-062) | P2 | 99% | 3/5 | pending | — | Web-store eviction and stale deep links are not exercised in the browser |
| 52 | [TG-063](#tg-063) | P2 | 99% | 3/5 | pending | — | Real file chooser/drop/keyboard/reselection behavior remains uncovered |
| 53 | [TG-069](#tg-069) | P2 | 99% | 3/5 | pending | — | Browser and operating-system compatibility matrix remains Chromium-only |
| 54 | [TG-030](#tg-030) | P2 | 98% | 1/5 | implemented | PATCH-05 | API method dispatch needs a complete Allow-header matrix |
| 55 | [TG-035](#tg-035) | P2 | 98% | 1/5 | implemented | PATCH-09 | ZIP cleanup assertion can fail because of another test’s temporary directory |
| 56 | [TG-036](#tg-036) | P2 | 98% | 1/5 | implemented | PATCH-13 | Live-stream URL generation lacks an explicit browser-safe encoding suite |
| 57 | [TG-033](#tg-033) | P2 | 98% | 2/5 | implemented | PATCH-07 | Keyset pagination needs full tied-data traversal invariants |
| 58 | [TG-065](#tg-065) | P2 | 98% | 3/5 | pending | — | Settings persistence and server hydration need real-browser assertions |
| 59 | [TG-067](#tg-067) | P2 | 98% | 3/5 | pending | — | Dialogs and virtualized views need keyboard/focus/accessibility browser coverage |
| 60 | [TG-068](#tg-068) | P2 | 98% | 4/5 | pending | — | Large deferred/virtualized transcripts lack browser resource and ordering tests |
| 61 | [TG-070](#tg-070) | P2 | 97% | 4/5 | pending | — | Installed-package app smoke needs browser-level reproducibility evidence |
| 62 | [TG-024](#tg-024) | P2 | 96% | 1/5 | implemented | PATCH-11 | Live route test globals and abort wiring can leak across cases |
| 63 | [TG-031](#tg-031) | P2 | 96% | 2/5 | implemented | PATCH-04 | SDK must distinguish domain 404/405 from missing or misrouted endpoints |
| 64 | [TG-034](#tg-034) | P2 | 96% | 2/5 | implemented | PATCH-06 | Cache failure, fingerprint and byte-budget edges need direct coverage |
| 65 | [TG-052](#tg-052) | P2 | 96% | 3/5 | pending | — | HTTP response validation stops at the top-level envelope |
| 66 | [TG-058](#tg-058) | P2 | 96% | 4/5 | pending | — | Parser fixture examples need seed-reproducible property and grammar fuzzing |
| 67 | [TG-032](#tg-032) | P2 | 95% | 2/5 | implemented | PATCH-04 | Content-Disposition precedence and malformed encodings need SDK assertions |
| 68 | [TG-042](#tg-042) | P2 | 94% | 2/5 | pending | — | Test discovery and nested UI execution need a deterministic contract |
| 69 | [TG-071](#tg-071) | P2 | 94% | 3/5 | pending | — | Cloudflare-specific payload portability is not established by browser Workers |
| 70 | [TG-079](#tg-079) | P2 | 94% | 3/5 | pending | — | Suite-wide global state and teardown reliability need randomized-order auditing |
| 71 | [TG-073](#tg-073) | P2 | 94% | 4/5 | pending | — | Cloud auth refresh needs process-and-HTTP seam tests without credentials |
| 72 | [TG-074](#tg-074) | P2 | 94% | 4/5 | pending | — | Qoder ACP framing needs malformed/oversized/half-close fuzz cases |
| 73 | [TG-060](#tg-060) | P2 | 92% | 4/5 | pending | — | SQLite schema compatibility needs an explicit real-file version matrix |
| 74 | [TG-059](#tg-059) | P2 | 91% | 3/5 | pending | — | Deep materialized payloads need explicit recursion and complexity contracts |
| 75 | [TG-072](#tg-072) | P2 | 91% | 3/5 | pending | — | Error logs and retained browser artifacts need a privacy contract |
| 76 | [TG-078](#tg-078) | P2 | 88% | 2/5 | pending | — | Export filename portability needs Windows reserved-name boundary cases |
| 77 | [TG-061](#tg-061) | P2 | 88% | 3/5 | pending | — | Cache maxBytes is not demonstrated as a retained-memory bound |
| 78 | [TG-055](#tg-055) | P2 | 83% | 3/5 | pending | — | Static asset realpath containment is not exercised against symlinked build files |
| 79 | [TG-053](#tg-053) | P2 | 82% | 3/5 | pending | — | SDK timeout and cancellation behavior has no explicit public contract |

## Input and execution blockers

### B-01 — Canonical toolchain unavailable

Bun, rtk, installed app dependencies, Biome and Playwright are unavailable; container DNS prevents dependency download. Seven required Bun commands were attempted and exited 127. This is not an application test failure.

### B-02 — Original CLI input missing from supplied archive

bin/spiracha.ts is named by package.json/build/package scripts but absent from the input ZIP. The existing package-manifest test already checks this. Restore the actual upstream file; do not fabricate a replacement or resurrect removed legacy surfaces.

### B-03 — Repository metadata provenance incomplete

Hidden CI/ignore metadata may have been omitted by archive creation. No claim is made about the current upstream hosted CI or .gitignore.

## Detailed findings

<a id="tg-001"></a>
### 1. TG-001 — Coverage gate accepts empty or non-measurable reports

**P0 · confidence 100% · complexity 2/5 · implemented · unit / tooling**

**Evidence / gap.** Baseline summarizeLcovReport treats absent measurable lines as 100%; an empty report and arbitrary text were independently accepted. This can make a failed coverage collection look green.

**Existing coverage credited.** The existing coverage tests check ordinary totals and configured exclusions, not fail-closed absence of evidence.

**Inspect.** `src/coverage-check.ts`, `src/coverage-check.test.ts`

**Implementation notes.**
1. Require completed LCOV source records and at least one included measurable line.
2. Test empty, non-LCOV, excluded-only and zero-line reports.
3. Keep display percentages separate from gate validity.

**Acceptance criteria.** All four cases reject; a completed included record with real lines still summarizes normally.

**Selective change.** [PATCH-01](patch-notes/PATCH-01.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

**Risk / decision.** Recheck the actual Bun and Vitest LCOV dialects before merging.

<a id="tg-002"></a>
### 2. TG-002 — Rounded percentages can pass a below-threshold build

**P1 · confidence 100% · complexity 1/5 · implemented · unit / tooling**

**Evidence / gap.** The baseline CLI compares a percentage rounded to two decimals. A true 89.999% displays as 90% and passes the 90% gate.

**Existing coverage credited.** Existing tests verify summary rendering, not the raw ratio immediately below the cutoff.

**Inspect.** `src/coverage-check.ts`

**Implementation notes.**
1. Extract assertCoverageThreshold and compare raw lineHits / lineTotal.
2. Keep two-decimal presentation unchanged.
3. Assert just below, exactly at and above 90%.

**Acceptance criteria.** 89999/100000 fails although the display is 90; 90/100 passes.

**Selective change.** [PATCH-01](patch-notes/PATCH-01.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

<a id="tg-003"></a>
### 3. TG-003 — Malformed LCOV counters can bypass or distort the gate

**P1 · confidence 100% · complexity 2/5 · implemented · unit / tooling**

**Evidence / gap.** Baseline NaN hit counts survive parsing and do not fail a less-than comparison; hits greater than totals also produce accepted nonsense.

**Existing coverage credited.** Ordinary LF/LH/FNF/FNH summaries already have examples.

**Inspect.** `src/coverage-check.ts`

**Implementation notes.**
1. Reject duplicate/missing/negative/fractional/non-numeric/unsafe counts and hits greater than totals.
2. Require paired optional function counters and unique included source records.
3. Normalize Windows separators before exclusion and duplicate checks.

**Acceptance criteria.** Every malformed table entry fails explicitly; valid CRLF/Windows records remain supported.

**Selective change.** [PATCH-01](patch-notes/PATCH-01.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

**Risk / decision.** This is not a full LCOV grammar or DA/FN-to-summary consistency validator.

<a id="tg-004"></a>
### 4. TG-004 — Cache invalidation reuses an older in-flight loader

**P1 · confidence 100% · complexity 2/5 · implemented · unit / integration**

**Evidence / gap.** A controlled baseline interleaving reproduced a post-invalidation get waiting on, then receiving, the pre-invalidation load. New work must not join an invalidated generation.

**Existing coverage credited.** Existing tests cover ordinary invalidation and cache reuse, but not a second get before the old promise resolves.

**Inspect.** `src/lib/bounded-file-cache.ts`

**Implementation notes.**
1. Include invalidation generation in the in-flight key.
2. Use barriers to start old load, invalidate, and resolve the fresh read before releasing the old load.
3. Repeat for path and global invalidation and clean all promises in finally.

**Acceptance criteria.** New get returns fresh data before old load is released; old work cannot seed the current cache.

**Selective change.** [PATCH-06](patch-notes/PATCH-06.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

**Risk / decision.** This does not cancel old loaders or promise linearizable snapshots across filesystem writes.

<a id="tg-012"></a>
### 5. TG-012 — Malformed success envelopes leak untyped failures or falsely typed values

**P1 · confidence 100% · complexity 2/5 · implemented · unit / integration**

**Evidence / gap.** ReadJsonEnvelope previously cast any JSON value; null/array/primitive envelopes and null data did not have a consistently typed client error contract.

**Existing coverage credited.** Ordinary API error statuses and well-formed envelopes are already tested.

**Inspect.** `src/client.ts`

**Implementation notes.**
1. Validate top-level parsed unknown before accessing it.
2. Reject missing/null success data using SpirachaClientError.
3. Exercise null, arrays, strings, booleans and numbers through a real ephemeral HTTP server.

**Acceptance criteria.** Malformed success responses reject with SpirachaClientError; ordinary well-formed responses remain compatible.

**Selective change.** [PATCH-04](patch-notes/PATCH-04.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

**Risk / decision.** Nested DTO schema validation is intentionally not solved here; TG-052.

<a id="tg-016"></a>
### 6. TG-016 — Generated cursors do not round-trip supported long or Unicode IDs

**P1 · confidence 100% · complexity 2/5 · implemented · unit**

**Evidence / gap.** Baseline encode followed by decode rejects an API-valid 2048-character ID; a 1024-CJK ID also exceeds the old 2048 encoded-character limit.

**Existing coverage credited.** Existing cursor examples cover ordinary ASCII identifiers and malformed inputs.

**Inspect.** `src/lib/conversation-data/pagination.ts`, `src/lib/conversation-api.ts`

**Implementation notes.**
1. Align decoded ID cap with the API 2048-character contract.
2. Bound encoded length at 18000 to allow worst-case JSON escaping plus base64 without removing bounds.
3. Test long ASCII, CJK, surrogate-pair emoji and control-character IDs.

**Acceptance criteria.** Generated valid boundary cursors decode and paginate; ID length 2049 and encoded length 18001 reject.

**Selective change.** [PATCH-18](patch-notes/PATCH-18.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

**Risk / decision.** Long request URLs may exceed intermediary defaults; TG-076 requires deployment-boundary review.

<a id="tg-010"></a>
### 7. TG-010 — Public local and HTTP clients lack real storage parity integration

**P1 · confidence 100% · complexity 3/5 · implemented · integration**

**Evidence / gap.** Mocked transports and adapter tests cannot detect mismatches across client URL construction, real routing, SQLite inventory and rollout normalization.

**Existing coverage credited.** There are substantial SDK, API and adapter suites; this adds a joined seam rather than replacing them.

**Inspect.** `src/client.ts`, `src/lib/conversation-api.ts`, `src/lib/conversation-data/index.ts`

**Implementation notes.**
1. Start Bun.serve on an ephemeral loopback port with a real Codex fixture DB/rollouts.
2. Inject explicit fixture locations into the production registry, not fake DTOs.
3. Compare local and HTTP pagination, details and Markdown for all three selectors.

**Acceptance criteria.** Local and HTTP results match across multiple pages and selectors; server and fixture are always removed.

**Selective change.** [PATCH-14](patch-notes/PATCH-14.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

**Risk / decision.** Only Codex is covered by the added fixture integration; TG-043 covers the other sources.

<a id="tg-026"></a>
### 8. TG-026 — No browser download assertion for original artifact bytes

**P1 · confidence 100% · complexity 3/5 · partial · E2E**

**Evidence / gap.** A component click/mock cannot prove a browser receives a successful artifact download with its original bytes and filename.

**Existing coverage credited.** Artifact parsing and component behavior already have examples.

**Inspect.** `testing/e2e/web-import.e2e.ts`, `src/ui/routes/web-chats.$conversationId.tsx`

**Implementation notes.**
1. Import a fixture artifact containing CRLF, Unicode and significant whitespace.
2. Wait for the actual download event and inspect failure/suggested filename.
3. Save under the test output directory and compare Buffer bytes.

**Acceptance criteria.** The browser download equals the fixture exactly, not merely a substring.

**Selective change.** [PATCH-16](patch-notes/PATCH-16.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

**Risk / decision.** First execution is blocked on the optional browser toolchain.

<a id="tg-027"></a>
### 9. TG-027 — No browser native conversation export-dialog journey

**P1 · confidence 100% · complexity 3/5 · partial · E2E**

**Evidence / gap.** The source detail route, persisted export controls, server export and browser download are not exercised as a complete built-app workflow.

**Existing coverage credited.** Export dialog and server export units already exist.

**Inspect.** `testing/e2e/codex-export.e2e.ts`, `src/ui/routes/threads.$threadId.tsx`

**Implementation notes.**
1. Navigate to a real fixture-backed Codex thread.
2. Open Export, disable ZIP and submit the dialog.
3. Await a successful .md download and assert a known original transcript line.

**Acceptance criteria.** Compiled UI and actual fixture storage produce a readable Markdown download.

**Selective change.** [PATCH-16](patch-notes/PATCH-16.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

**Risk / decision.** Exact native-renderer bytes remain lower-layer contracts; this browser test checks the seam.

<a id="tg-028"></a>
### 10. TG-028 — No real-browser delete-cancel or production hostile-origin safety journey

**P1 · confidence 100% · complexity 3/5 · partial · E2E / security**

**Evidence / gap.** Component cancellation and direct-handler security tests do not prove the built app leaves storage intact.

**Existing coverage credited.** The original suite covers lower-layer deletion extensively.

**Inspect.** `testing/e2e/codex-export.e2e.ts`

**Implementation notes.**
1. Compare API detail before and after cancelling the browser confirmation.
2. Send a hostile-origin DELETE to the running production server.
3. Assert 403 and record still present.

**Acceptance criteria.** Both journeys leave the original conversation unchanged.

**Selective change.** [PATCH-16](patch-notes/PATCH-16.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

**Risk / decision.** This deliberately does not claim confirmed deletion/recovery coverage; TG-044 and TG-045.

<a id="tg-025"></a>
### 11. TG-025 — No production-browser import, hydration and reload journey

**P1 · confidence 100% · complexity 4/5 · partial · E2E**

**Evidence / gap.** The archive has no browser harness; component tests cannot prove built route navigation, server import, hydration and direct reload work together.

**Existing coverage credited.** Parser/server/component tests are extensive and are retained.

**Inspect.** `testing/e2e/web-import.e2e.ts`, `src/ui/routes/web-chats.$conversationId.tsx`

**Implementation notes.**
1. Add isolated Playwright production-server infrastructure and a file upload flow.
2. Assert loaded title/transcript, direct reload and metadata.
3. Fail on uncaught browser errors and deny external browser network.

**Acceptance criteria.** Run the compiled app in Chromium using only fixture histories and observe the complete journey.

**Selective change.** [PATCH-16](patch-notes/PATCH-16.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

**Risk / decision.** Playwright dependency/lock installation and first real browser run are still required.

<a id="tg-029"></a>
### 12. TG-029 — Portable payload package is not exercised in a browser or module Worker

**P1 · confidence 100% · complexity 4/5 · partial · E2E / portability**

**Evidence / gap.** Node execution cannot establish that the compiled graph avoids Node/Bun globals and runs in real browser/module Worker environments.

**Existing coverage credited.** Existing package-smoke already checks compiled payload consumers in both Bun and Node, including declarations; those are not missing.

**Inspect.** `src/build-payload.ts`, `testing/e2e/payload-portability.e2e.ts`

**Implementation notes.**
1. Serve the actual dist/payload JavaScript graph, not source mocks.
2. Run all 12 portable-source fixtures in an isolated HTML page and a module Worker.
3. Assert no Bun/Buffer/process globals and exact direct/Worker output equality; clean workers and object URLs.

**Acceptance criteria.** Every compiled fixture converts in both browser contexts without runtime shims.

**Selective change.** [PATCH-17](patch-notes/PATCH-17.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

**Risk / decision.** Requires PATCH-16 and its PATCH-15 dependency; not a Cloudflare deployment test.

<a id="tg-038"></a>
### 13. TG-038 — Coverage denominator omits modules never loaded by tests

**P1 · confidence 99% · complexity 3/5 · pending · tooling / coverage**

**Evidence / gap.** The gate only summarizes records emitted by the coverage runner. The static inventory has 100 modules without an obvious direct/adjacent test reference; this is a triage queue, not a measured zero-coverage list.

**Existing coverage credited.** Bun coverage and the current aggregate gate exist; PATCH-01 rejects empty reports but cannot discover absent files.

**Inspect.** `src/coverage-check.ts`, `vitest.config.ts`, `src/ui-suite.test.ts`

**Implementation notes.**
1. Generate an eligible production-module manifest excluding generated/type-only/build/fixture files by documented policy.
2. Compare eligible files to normalized LCOV paths and fail unexplained omissions.
3. Add tests for unloaded modules, exclusions, Windows paths and duplicate records; avoid importing side-effecting modules just to inflate the denominator.

**Acceptance criteria.** A deliberately untested eligible module fails the gate even when all imported modules show 100%.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Policy and runtime instrumentation support need confirmation with the project’s actual Bun version.

<a id="tg-039"></a>
### 14. TG-039 — Aggregate line coverage alone misses critical branches and low-coverage files

**P1 · confidence 99% · complexity 3/5 · pending · tooling / coverage**

**Evidence / gap.** Profiles enforce only aggregate line coverage; function percentages are displayed but not gated and branch counts are not parsed.

**Existing coverage credited.** The existing 90% line gate remains useful and should not be reduced.

**Inspect.** `src/coverage-check.ts`, `vitest.config.ts`

**Implementation notes.**
1. Agree separate thresholds for mutation/security/parser modules and broader app coverage.
2. Parse supported branch/function records, test absent branch records and exact threshold boundaries.
3. Establish an initial honest baseline and ratchet it rather than adding broad exclusions.

**Acceptance criteria.** An uncovered destructive/error branch or critically under-covered file cannot be masked by easy high-coverage modules.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Do not invent current percentages; none were measured in this environment.

<a id="tg-040"></a>
### 15. TG-040 — UI exclusions hide route orchestration and critical server bridges

**P1 · confidence 99% · complexity 3/5 · pending · unit / integration / UI**

**Evidence / gap.** UI coverage excludes all routes and the root gate additionally excludes codex-server/codex-queries. Some orchestration can regress without affecting the gate.

**Existing coverage credited.** Many components and server functions are tested indirectly; exclusion does not imply no tests.

**Inspect.** `vitest.config.ts`, `src/coverage-check.ts`, `src/ui/routes/web.index.tsx`, `src/ui/lib/codex-server.ts`

**Implementation notes.**
1. Classify generated wiring versus handwritten decisions.
2. Extract decision-bearing route helpers where useful, add direct integration tests and selectively include them in coverage.
3. Keep generated routeTree excluded and never edit it manually.

**Acceptance criteria.** Import, mutation and deferred-load decision logic has named tests and an accountable coverage policy.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Avoid chasing framework-generated coverage; prioritize application branches.

<a id="tg-043"></a>
### 16. TG-043 — Real local/HTTP source conformance stops at the new Codex fixture

**P1 · confidence 99% · complexity 4/5 · pending · integration**

**Evidence / gap.** The new joined integration covers Codex only; the other 12 native sources have different schemas, selectors and raw-export capabilities.

**Existing coverage credited.** Each source already has significant adapter/storage fixtures and contract tests.

**Inspect.** `src/lib/conversation-data/index.ts`, `src/client.storage-integration.test.ts`, `src/lib/conversation-data/types.ts`

**Implementation notes.**
1. Reuse source fixtures behind a shared local-and-HTTP conformance harness.
2. Parameterize documented capabilities rather than asserting unsupported operations succeed.
3. Compare ordering, selectors, title/model metadata, raw bytes and domain-not-found behavior on fresh reads.

**Acceptance criteria.** Every registered source has at least one fixture-backed public-surface contract case without reading the developer’s home.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Fixtures must stay source-realistic; do not force all sources into Codex semantics.

<a id="tg-044"></a>
### 17. TG-044 — Confirmed browser deletion is not covered end to end

**P1 · confidence 99% · complexity 4/5 · pending · E2E / filesystem**

**Evidence / gap.** The staged browser tests deliberately cover cancellation and denial, not confirmation with actual storage changes.

**Existing coverage credited.** Lower-layer deletion/journal tests are substantial.

**Inspect.** `src/ui/routes/threads.$threadId.tsx`, `src/lib/codex-thread-mutations.ts`, `testing/e2e/codex-export.e2e.ts`

**Implementation notes.**
1. Create a dedicated disposable fixture per destructive test.
2. Confirm deletion with session-file option on/off and assert UI list/detail behavior after reload.
3. Reopen DB/files outside the UI and verify targeted removal plus unrelated-record preservation.

**Acceptance criteria.** Confirmed deletion reaches real storage exactly as requested and UI caches do not resurrect the record.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Never reuse a developer server; keep this separate from shared read-only browser fixtures.

<a id="tg-048"></a>
### 18. TG-048 — Real SharedWorker and fallback live streaming are untested across browser tabs

**P1 · confidence 99% · complexity 4/5 · pending · E2E**

**Evidence / gap.** Mock clients cannot prove browser worker creation, tab subscriber lifetimes and fallback behavior with the built worker asset.

**Existing coverage credited.** Existing live client/transport tests already cover many mocked lifecycle cases.

**Inspect.** `src/ui/lib/codex-thread-live.worker.ts`, `src/ui/lib/codex-thread-live.ts`

**Implementation notes.**
1. Open two tabs on the same fixture thread and observe one shared connection where supported.
2. Close subscribers and assert monitor release.
3. Disable/unavailable SharedWorker in a separate context and exercise the documented fallback.

**Acceptance criteria.** Updates reach both tabs without duplicate application, and all connections close when the last subscriber leaves.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Worker support differs by browser; capability-specific expectations are needed.

<a id="tg-013"></a>
### 19. TG-013 — A successful non-ZIP response is accepted as an archive

**P1 · confidence 98% · complexity 1/5 · implemented · unit / integration**

**Evidence / gap.** A deployment returning HTML or JSON with HTTP 200 can be wrapped as a ZIP download without a useful SDK error.

**Existing coverage credited.** The SDK already handles failing status codes and valid archive responses.

**Inspect.** `src/client.ts`

**Implementation notes.**
1. Normalize and require application/zip after a successful response.
2. Test HTML/JSON/plain-text success responses and keep typed errors.
3. Preserve existing missing-conversation semantics.

**Acceptance criteria.** Wrong MIME responses reject before returning an archive blob.

**Selective change.** [PATCH-04](patch-notes/PATCH-04.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

**Risk / decision.** Intentional contract tightening: proxies must preserve application/zip. ZIP signature/CRC validation is not added.

<a id="tg-006"></a>
### 20. TG-006 — Loopback security lacks a systematic hostile-origin matrix

**P1 · confidence 98% · complexity 2/5 · implemented · unit / security**

**Evidence / gap.** Existing examples do not form a contract over opaque origins, userinfo tricks, subdomains, alternate host syntax, ports and scheme mismatches.

**Existing coverage credited.** The request-security implementation and basic same-origin/rejection tests already exist; no new authentication model is introduced.

**Inspect.** `src/lib/local-request-security.ts`

**Implementation notes.**
1. Add table-driven hostile Origin and Host cases.
2. Preserve accepted localhost, IPv4 and IPv6 aliases on matching scheme/port.
3. Include malformed URLs and normalized default ports.

**Acceptance criteria.** All hostile matrix entries deny and the intended three loopback spellings remain accepted.

**Selective change.** [PATCH-02](patch-notes/PATCH-02.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

**Risk / decision.** Direct Request construction does not replace actual server/proxy URL normalization testing; see TG-076.

<a id="tg-007"></a>
### 21. TG-007 — Whole-batch validation must precede any destructive side effect

**P1 · confidence 98% · complexity 2/5 · implemented · unit / integration**

**Evidence / gap.** The safety invariant is easy to regress when validating IDs while iterating: a valid prefix could be deleted before an invalid later element is noticed.

**Existing coverage credited.** The API has extensive validation examples and deletion tests; the new tests assert zero dependency calls for an invalid entire batch.

**Inspect.** `src/lib/conversation-api.ts`

**Implementation notes.**
1. Place an invalid item after a valid ID and spy on the mutation dependency.
2. Test the 200-item cap before deduplication and stable trimming/deduplication order.
3. Assert response status/envelope and no mutation on rejection.

**Acceptance criteria.** No deletion call occurs for an invalid or oversized request; valid deduplicated IDs retain first-seen order.

**Selective change.** [PATCH-05](patch-notes/PATCH-05.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

<a id="tg-008"></a>
### 22. TG-008 — Batch export needs an explicit all-or-nothing missing-item assertion

**P1 · confidence 98% · complexity 2/5 · implemented · unit / integration**

**Evidence / gap.** A batch with existing and missing IDs must not silently deliver a partial ZIP while appearing successful.

**Existing coverage credited.** Basic ZIP and missing-single-item paths already exist.

**Inspect.** `src/lib/conversation-api.ts`, `src/client.ts`

**Implementation notes.**
1. Assert mixed missing/existing input returns conversation_not_found before ZIP delivery.
2. Repeat through real HTTP SDK and fixture-backed storage.
3. Keep this separate from intentionally partial deletion results.

**Acceptance criteria.** API returns 404 and HTTP client returns null; no partial download is returned.

**Selective change.** [PATCH-05](patch-notes/PATCH-05.md), [PATCH-14](patch-notes/PATCH-14.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

<a id="tg-011"></a>
### 23. TG-011 — Raw HTTP export needs byte equality against the original rollout

**P1 · confidence 98% · complexity 2/5 · implemented · integration**

**Evidence / gap.** A text-only comparison can hide CRLF, encoding or binary transformations across Response/blob transport.

**Existing coverage credited.** Raw export and download helpers already have unit examples.

**Inspect.** `src/client.ts`, `src/lib/conversation-api.ts`

**Implementation notes.**
1. Read the fixture rollout with Bun.file and compare its Uint8Array to the downloaded blob.
2. Verify the actual source route rather than a stubbed response.
3. Keep Markdown normalization assertions separate.

**Acceptance criteria.** Every original byte is preserved through API and public HTTP SDK.

**Selective change.** [PATCH-14](patch-notes/PATCH-14.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

<a id="tg-020"></a>
### 24. TG-020 — Browser import preflight boundaries are buried in an excluded route

**P1 · confidence 98% · complexity 2/5 · implemented · unit / UI**

**Evidence / gap.** Client file count/size/read preparation lives in route code excluded from UI coverage, making no-read-on-invalid-selection behavior hard to test.

**Existing coverage credited.** Server import and parser limits already have tests.

**Inspect.** `src/ui/routes/web.index.tsx`, `src/ui/lib/web-chat-server.ts`

**Implementation notes.**
1. Extract portable client preparation and common limits without importing a server module into browser-only tests.
2. Test 20 files, 25 MiB/file and 100 MiB aggregate at/beyond boundaries using synthetic File-like objects.
3. Preserve existing server exports and route behavior.

**Acceptance criteria.** Invalid aggregate/count selections do not call text(); per-file errors preserve readable valid files and input order.

**Selective change.** [PATCH-12](patch-notes/PATCH-12.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

<a id="tg-021"></a>
### 25. TG-021 — One File.text failure discards otherwise readable selected imports

**P1 · confidence 98% · complexity 2/5 · implemented · unit / UI**

**Evidence / gap.** The original Promise.all rejects on one unreadable file, losing the valid files that could have been imported.

**Existing coverage credited.** Partial parse/server errors exist, but a client filesystem read rejection occurs before those paths.

**Inspect.** `src/ui/routes/web.index.tsx`, `src/ui/lib/web-chat-import.ts`

**Implementation notes.**
1. Catch read failures per file and return a typed file error.
2. Preserve successful payloads and deterministic order while reads complete out of order.
3. Deduplicate by filename plus message rather than filename alone.

**Acceptance criteria.** One read rejection yields one error while other readable files continue into the import payload.

**Selective change.** [PATCH-12](patch-notes/PATCH-12.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

<a id="tg-023"></a>
### 26. TG-023 — Live route unique-ID ceiling and denied-origin no-I/O contract need direct tests

**P1 · confidence 98% · complexity 2/5 · implemented · unit / UI**

**Evidence / gap.** The live route needs explicit boundary evidence for 64 unique IDs, duplicates, trimming and early rejection before storage resolution.

**Existing coverage credited.** The existing indirect route test already covers normal SSE wiring and several errors; the route is not wholly untested.

**Inspect.** `src/ui/routes/api.v1.codex.threads.events.ts`, `src/ui/lib/codex-thread-events-route.vitest.ts`

**Implementation notes.**
1. Extend that existing suite, not a competing mock-heavy duplicate.
2. Test 65 unique IDs reject and 64/duplicated IDs succeed with stable deduplication.
3. Assert hostile Origin produces 403 with zero database/stream dependency calls.

**Acceptance criteria.** Limits apply to unique normalized IDs and denied-origin requests do not open storage.

**Selective change.** [PATCH-11](patch-notes/PATCH-11.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

<a id="tg-005"></a>
### 27. TG-005 — Smoke subprocess inherits developer homes, source locations and credentials

**P1 · confidence 98% · complexity 3/5 · implemented · integration / tooling**

**Evidence / gap.** The supplied smoke environment spreads process.env and changes only a subset of paths. A real app process can discover unrelated local histories or inherit credentials/preload options.

**Existing coverage credited.** The smoke suite already runs an app and package consumers in fixtures; the missing assertion is exhaustive environment isolation.

**Inspect.** `src/package-smoke.ts`, `src/lib/isolated-runtime-test-helpers.ts`

**Implementation notes.**
1. Whitelist essential process-launch variables instead of copying all environment keys.
2. Set HOME/profile/XDG/AppData/temp/cache and every documented source/auth/socket/CLI path under one non-root fixture directory.
3. Exercise the real helper and update its existing smoke assertion.

**Acceptance criteria.** Secret/proxy/preload sentinels are absent; all controlled data paths lie beneath the fixture root; source DB override remains explicit.

**Selective change.** [PATCH-15](patch-notes/PATCH-15.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

**Risk / decision.** Audit other existing fixture helpers separately; this patch covers smoke and its reusable helper, not every test process.

<a id="tg-064"></a>
### 28. TG-064 — Browser network failure and interrupted download need honest error states

**P1 · confidence 98% · complexity 3/5 · pending · E2E**

**Evidence / gap.** Happy-path browser downloads cannot establish that network/server interruptions avoid false success notifications and stale loading controls.

**Existing coverage credited.** Client/unit tests exercise several rejected fetch paths.

**Inspect.** `src/ui/lib/evidence-export.ts`, `src/ui/components/export-dialog.tsx`, `testing/e2e`

**Implementation notes.**
1. Abort targeted fixture requests or return controlled 500 responses at actual browser boundaries.
2. Interrupt a download after headers and assert visible error/retry state.
3. Retry against a healthy fixture and verify controls recover without duplicate artifacts.

**Acceptance criteria.** Failed work is not reported as saved/exported and retry succeeds without requiring a full app restart.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Keep network interception limited to the fault being injected; do not mock the whole app.

<a id="tg-045"></a>
### 29. TG-045 — Crash recovery is not verified through a freshly started app and public API

**P1 · confidence 98% · complexity 5/5 · pending · integration / E2E**

**Evidence / gap.** Existing crash/replay units do not by themselves prove app startup, route caches and browser state expose reconciled storage consistently.

**Existing coverage credited.** The original Codex/Cursor journals already have real fresh-process crashes, replay, locking and idempotence tests. Do not rebuild them from scratch.

**Inspect.** `src/lib/codex-deletion-journal.ts`, `src/lib/cursor-operation-journal.ts`, `src/lib/production-ui-server.ts`

**Implementation notes.**
1. Reuse existing journal failpoint fixtures and kill the fixture app after durable intent but before completion.
2. Start a new app against the same isolated root.
3. Read public list/detail endpoints and UI after reconciliation, including a second restart.

**Acceptance criteria.** Public state matches the documented recovery outcome with no resurrection or unrelated deletion after repeated restarts.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Production failpoint hooks, if needed, must be test-only and not remotely controllable.

<a id="tg-051"></a>
### 30. TG-051 — Other JSON endpoints need explicit request-body budget and streaming tests

**P1 · confidence 97% · complexity 3/5 · pending · integration / security**

**Evidence / gap.** The portable payload endpoint has a 64 MiB bounded reader, but other JSON helpers use request.json; item limits after parse do not bound pre-parse allocation.

**Existing coverage credited.** The original payload endpoint already tests both Content-Length and oversized chunked streams with cancellation.

**Inspect.** `src/lib/conversation-api.ts`

**Implementation notes.**
1. Inventory JSON routes and define appropriate per-route byte ceilings.
2. Test missing/lying Content-Length and streaming overflow before invoking dependencies.
3. Verify cancellation and consistent error envelopes without relaxing item-count/lens validation.

**Acceptance criteria.** Oversized batch/evidence/query bodies are rejected before large parsing or side effects.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** This requires an explicit request-budget design, not simply applying the payload’s large limit everywhere.

<a id="tg-066"></a>
### 31. TG-066 — Hostile transcript rendering needs browser execution-safety tests

**P1 · confidence 97% · complexity 3/5 · pending · E2E / security**

**Evidence / gap.** Untrusted imported transcript text and links should not execute script or navigate dangerous schemes merely by rendering.

**Existing coverage credited.** Escaping/parsing/component tests may cover isolated fragments; the compiled render surface is not browser-tested.

**Inspect.** `src/ui/components`, `src/ui/routes/web-chats.$conversationId.tsx`

**Implementation notes.**
1. Import synthetic HTML/script/event-handler/javascript-link/fence-breakout content.
2. Observe browser dialogs, window markers and unexpected network/navigation.
3. Assert inert display while original raw/Markdown exports preserve original content where documented.

**Acceptance criteria.** Rendering cannot execute fixture payloads, and security changes do not silently corrupt archival exports.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Do not conflate safe UI rendering with rewriting every exported Markdown document.

<a id="tg-077"></a>
### 32. TG-077 — Missing/unreadable DB and deferred rollout errors need complete UI/API journeys

**P1 · confidence 97% · complexity 3/5 · pending · integration / E2E**

**Evidence / gap.** Adapter fallbacks and component errors can each pass while the full metadata-to-export journey fails when storage changes between stages.

**Existing coverage credited.** Fallback indexing, absent DB and deferred-load units already exist.

**Inspect.** `src/lib/codex-fallback-index.ts`, `src/lib/codex-thread-cache.ts`, `src/ui/routes/threads.$threadId.tsx`

**Implementation notes.**
1. Start fixture app with no DB but valid rollouts, then with unreadable/missing rollout after list metadata is loaded.
2. Read list/detail/export through HTTP and browser.
3. Assert meaningful unavailable/deferred UI, correct fallback inventory and no fabricated content.

**Acceptance criteria.** Each degraded storage state has a stable public result and recovery action without page crashes.

**Verification.** Static review only; proposal is not implemented or executed.

<a id="tg-049"></a>
### 33. TG-049 — Real SSE append and reconnect need browser-level sequence invariants

**P1 · confidence 97% · complexity 4/5 · pending · integration / E2E**

**Evidence / gap.** Transport mocks do not exercise actual incremental UTF-8 framing, file appends and reconnect after connection loss.

**Existing coverage credited.** There are existing SSE helper and parser tests, including shared monitor cleanup.

**Inspect.** `src/lib/codex-thread-events.ts`, `src/ui/lib/codex-thread-live.ts`

**Implementation notes.**
1. Append fixture records at byte boundaries that split multibyte text and SSE framing.
2. Disconnect/reconnect deterministically and append more records.
3. Assert visible ordering, deduplication, final state and bounded reconnect attempts.

**Acceptance criteria.** No record is lost, duplicated or corrupted across the agreed reconnect semantics.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Use server-controlled barriers/events, not timing-sensitive arbitrary sleeps.

<a id="tg-050"></a>
### 34. TG-050 — Actual HTTP disconnect cleanup lacks a socket-to-monitor integration assertion

**P1 · confidence 97% · complexity 4/5 · pending · integration / resource**

**Evidence / gap.** Passing an AbortSignal in a mocked route does not prove a closed TCP/browser request releases filesystem monitors and stream readers.

**Existing coverage credited.** The helper cancellation paths are already unit-tested; PATCH-11 tests exact signal wiring.

**Inspect.** `src/lib/codex-thread-events.ts`, `src/ui/routes/api.v1.codex.threads.events.ts`

**Implementation notes.**
1. Open a real fixture SSE connection, wait for subscription, then abort/close the client socket.
2. Observe monitor/subscriber counts through a test-only seam.
3. Repeat many connect/disconnect cycles and assert return to baseline and prompt child shutdown.

**Acceptance criteria.** No active monitor, reader or timer remains after the last disconnected client.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Resource counters should not become a public production endpoint.

<a id="tg-075"></a>
### 35. TG-075 — Destructive source adapters need public-surface preservation invariants

**P1 · confidence 97% · complexity 4/5 · pending · integration / filesystem**

**Evidence / gap.** Source-specific deletion tests do not uniformly show, via reopened public state, that unrelated workspace files/records survive all supported mutations.

**Existing coverage credited.** Codex and Cursor have particularly strong mutation/recovery suites; unsupported deletion sources must remain unsupported.

**Inspect.** `src/lib/conversation-data/index.ts`, `src/lib/conversation-data/*-adapter.ts`

**Implementation notes.**
1. For each deletion-capable adapter, seed target, sibling and unrelated-workspace records/files.
2. Delete through public HTTP/local surfaces, reopen storage in a fresh process and inspect all sentinels.
3. Assert idempotent repeat deletion and per-source cleanup semantics.

**Acceptance criteria.** Only authorized target data changes and public state agrees after reopen for every supported adapter.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Shared fixture utilities must not normalize away source-specific ownership rules.

<a id="tg-014"></a>
### 36. TG-014 — Invalid UTF-8 must fail before portable payload conversion

**P1 · confidence 96% · complexity 2/5 · implemented · unit / integration**

**Evidence / gap.** The payload transport needs a direct assertion that malformed UTF-8 is rejected without invoking conversion, rather than being replacement-decoded into a different conversation.

**Existing coverage credited.** The original API suite already tests Content-Length and chunked 64 MiB overflow with stream cancellation. Those are not claimed as missing.

**Inspect.** `src/lib/conversation-api.ts`

**Implementation notes.**
1. Supply an invalid UTF-8 byte sequence with a converter spy.
2. Assert validation status and zero conversion calls.
3. Preserve the existing bounded-body tests unchanged.

**Acceptance criteria.** Malformed bytes never reach the converter and produce a client-facing validation error.

**Selective change.** [PATCH-05](patch-notes/PATCH-05.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

<a id="tg-015"></a>
### 37. TG-015 — Private runtime directory invariants have no focused filesystem suite

**P1 · confidence 96% · complexity 2/5 · implemented · unit / filesystem**

**Evidence / gap.** The helper lacks a dedicated suite asserting mode repair and leaf non-directory/symlink safety using actual files.

**Existing coverage credited.** Related export/file-lock tests already cover several file-level symlink and hardlink cases.

**Inspect.** `src/lib/private-runtime-directory.ts`

**Implementation notes.**
1. Create nested directories and assert 0700/idempotence on POSIX.
2. Repair permissive directories without altering unrelated regular files or symlink targets.
3. Test assert-only behavior on missing paths and skip only unsupported OS semantics.

**Acceptance criteria.** Private directory contracts are verified on real temporary paths with reliable cleanup.

**Selective change.** [PATCH-03](patch-notes/PATCH-03.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

**Risk / decision.** Ancestor symlink races and platform ACL behavior are separate decisions, TG-054.

<a id="tg-018"></a>
### 38. TG-018 — ZIP tests need body-level proof for colliding filenames

**P1 · confidence 96% · complexity 2/5 · implemented · integration**

**Evidence / gap.** Unique-looking entry names alone do not prove that all original Markdown bodies survive case/Unicode/literal-suffix collisions.

**Existing coverage credited.** The existing resolver already handles NFC/case/literal-suffix collisions; this audit does not claim an existing overwrite defect.

**Inspect.** `src/lib/conversation-zip-export.ts`, `src/lib/ui-export-zip.ts`

**Implementation notes.**
1. Build real archives, unzip with fflate and map every body back to its input.
2. Include NFC, case variants, an existing suffixed name and unsafe path punctuation.
3. Compare NUL/CRLF/emoji bytes and read the blob after cleanup.

**Acceptance criteria.** All expected bodies appear exactly once under safe distinct names and remain readable after temporary files are removed.

**Selective change.** [PATCH-09](patch-notes/PATCH-09.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

<a id="tg-019"></a>
### 39. TG-019 — Normalized Markdown renderer lacks exact contract-focused tests

**P1 · confidence 96% · complexity 2/5 · implemented · unit**

**Evidence / gap.** Source/export snapshots exercise this renderer indirectly but do not isolate its role/title/model/newline and selector contracts.

**Existing coverage credited.** Provider-specific transcript and payload suites already check substantial rendered content.

**Inspect.** `src/lib/conversation-data/markdown.ts`

**Implementation notes.**
1. Add exact full-string assertions for roles, titles, newlines and model labels.
2. Include Unicode, fences and non-mutating input.
3. Test no-final-answer behavior, maximum message order rather than array position, and empty transcript distinctions.

**Acceptance criteria.** Exact Markdown output and unchanged input are asserted for all focused fixtures.

**Selective change.** [PATCH-08](patch-notes/PATCH-08.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

**Risk / decision.** These are contract tests, not a new Markdown sanitizer or provider renderer rewrite.

<a id="tg-047"></a>
### 40. TG-047 — Concurrent public reads and deletes lack cross-process freshness tests

**P1 · confidence 96% · complexity 4/5 · pending · integration**

**Evidence / gap.** Lock-unit correctness and cache-unit invalidation do not establish end-to-end behavior when independent app/client processes read and mutate the same fixture.

**Existing coverage credited.** The existing lock suite already tests concurrency and cleanup, and PATCH-06 closes one in-flight cache race.

**Inspect.** `src/lib/file-mutation-lock.ts`, `src/lib/conversation-data/index.ts`, `src/lib/bounded-file-cache.ts`

**Implementation notes.**
1. Coordinate two fixture processes with IPC barriers rather than sleeps.
2. Overlap list/detail/export with mutation and reopen storage.
3. Assert results obey a documented before-or-after policy, never mixed corrupt bytes or resurrected deleted data.

**Acceptance criteria.** Repeated deterministic interleavings preserve storage and publish a consistent error/snapshot contract.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Do not demand stronger transactional guarantees than adapters promise without an explicit design decision.

<a id="tg-009"></a>
### 41. TG-009 — Partial deletion and cleanup errors need a stable batch response contract

**P1 · confidence 95% · complexity 2/5 · implemented · unit / integration**

**Evidence / gap.** Mixed success, missing records and cleanup errors need explicit per-item semantics rather than accidental rejection of the entire batch.

**Existing coverage credited.** Source deletion and cleanup helpers have existing tests.

**Inspect.** `src/lib/conversation-api.ts`

**Implementation notes.**
1. Inject mixed deleted/not-found/cleanup-error outcomes.
2. Assert HTTP 200 for a completed batch with typed per-item results.
3. Preserve IDs and cleanup details without pretending failed cleanup succeeded.

**Acceptance criteria.** Every input has the expected result and cleanup failure remains visible in the response.

**Selective change.** [PATCH-05](patch-notes/PATCH-05.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

<a id="tg-076"></a>
### 42. TG-076 — Real server URL normalization and encoded-path security need joined tests

**P1 · confidence 95% · complexity 3/5 · pending · integration / security**

**Evidence / gap.** Direct Request construction omits server/router normalization of percent encodings, path prefixes, Host spelling and long cursor URLs.

**Existing coverage credited.** There are many handler and origin tests; PATCH-02/05 add more direct matrices.

**Inspect.** `src/lib/production-ui-server.ts`, `src/lib/conversation-api.ts`, `src/lib/local-request-security.ts`

**Implementation notes.**
1. Send actual socket/HTTP requests through the production server for encoded separators, double encoding, malformed escapes and unusual Host/Origin spellings.
2. Test long valid cursor URLs within the chosen server/proxy budget.
3. Assert consistent route rejection without unexpected data access.

**Acceptance criteria.** The deployed route boundary preserves ID/origin validation and gives controlled errors for unsupported URL sizes/encodings.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Do not claim a bypass until reproduced through the actual transport.

<a id="tg-056"></a>
### 43. TG-056 — ZIP pipeline cleanup needs injected failures at actual pipeline stages

**P1 · confidence 94% · complexity 3/5 · pending · integration / filesystem**

**Evidence / gap.** Helper cleanup-order tests do not exhaust failures while rendering, writing entries, compressing, reading the final archive and removing the output directory.

**Existing coverage credited.** Existing cleanup helpers and PATCH-09 cover normal integrity and cleanup ordering.

**Inspect.** `src/lib/conversation-zip-export.ts`, `src/lib/ui-export-archive.ts`, `src/lib/ui-export-zip.ts`

**Implementation notes.**
1. Inject narrow stage failures while using actual temporary output directories.
2. Assert no orphan files and preservation of the primary failure when cleanup also fails.
3. Confirm a subsequent export works after each failure.

**Acceptance criteria.** Every stage either returns a complete readable blob or fails without leaked artifacts or masked primary errors.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Avoid broad module mocks that skip the cleanup code being tested.

<a id="tg-046"></a>
### 44. TG-046 — Journal durability needs a cross-stage storage-fault matrix

**P1 · confidence 94% · complexity 5/5 · pending · integration / filesystem**

**Evidence / gap.** Permission/disk-full/fsync/rename failures at each durable boundary can differ from process interruption and deserve explicit recovery outcomes.

**Existing coverage credited.** There are existing crash tests and a transcript renderer disk-full test; basic disk-full coverage is not claimed absent everywhere.

**Inspect.** `src/lib/codex-deletion-journal.ts`, `src/lib/cursor-operation-journal.ts`, `src/lib/file-mutation-lock.ts`

**Implementation notes.**
1. Introduce a narrowly injected filesystem fault seam or controlled child filesystem wrapper.
2. Fail write, sync, rename and removal at each journal stage with ENOSPC/EROFS/EACCES.
3. Assert primary error preservation, durable intent visibility, lock release and successful replay after restoring storage.

**Acceptance criteria.** Each documented stage has an invariant-preserving failure and retry result, not merely an error string assertion.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Use deterministic failpoints; filling the host disk or changing real home permissions is unacceptable.

<a id="tg-057"></a>
### 45. TG-057 — Large export/import resource budgets lack repeatable stress evidence

**P1 · confidence 90% · complexity 4/5 · pending · integration / performance**

**Evidence / gap.** 200-conversation exports and concurrent large file reads can allocate much more than fixture-scale tests reveal; current source-byte limits do not establish peak memory.

**Existing coverage credited.** There are existing bounded retention, concurrency and payload-size tests.

**Inspect.** `src/lib/conversation-zip-export.ts`, `src/lib/web-chat.ts`, `src/ui/lib/web-chat-import.ts`

**Implementation notes.**
1. Generate deterministic near-limit synthetic inputs outside the fast unit suite.
2. Measure peak RSS/heap, elapsed time and event-loop responsiveness in an isolated process.
3. Test several concurrent requests and document hardware-tolerant regression budgets.

**Acceptance criteria.** Resource use stays within an agreed envelope and over-limit work fails early with cleanup.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Do not assert an arbitrary universal millisecond or memory threshold without a measured baseline.

<a id="tg-054"></a>
### 46. TG-054 — Private directory ancestor symlinks and TOCTOU policy are unspecified

**P1 · confidence 87% · complexity 4/5 · pending · integration / security**

**Evidence / gap.** Leaf lstat checks do not establish whether symlinked ancestors or a concurrent path replacement are acceptable within the same-user threat model.

**Existing coverage credited.** Leaf symlink/hardlink protections already exist; PATCH-03 adds focused directory tests.

**Inspect.** `src/lib/private-runtime-directory.ts`, `src/lib/ui-export-files.ts`

**Implementation notes.**
1. Document trusted root/ancestor assumptions first.
2. Build controlled ancestor symlink and rename-race fixtures without touching external data.
3. Use realpath/handle-relative checks only where the chosen contract requires them and retest legitimate symlinked home setups.

**Acceptance criteria.** Accepted and rejected ancestor/race cases are explicit and protected paths cannot be redirected outside the fixture.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Do not label this an exploitable remote vulnerability without confirming the threat model.

<a id="tg-041"></a>
### 47. TG-041 — CI enforcement and runtime matrix cannot be established from the archive

**P1 · confidence 85% · complexity 3/5 · pending · tooling / CI**

**Evidence / gap.** No .github/workflow files are present in the supplied ZIP, so hosted CI triggers, required checks and runtime matrices are unknown.

**Existing coverage credited.** Local verification scripts already exist. Upstream may have CI omitted by archive/export rules.

**Inspect.** `package.json`, `AGENTS.md`

**Implementation notes.**
1. First inspect the real repository’s existing CI rather than blindly creating a duplicate workflow.
2. Ensure frozen-lock install, lint, typecheck, unit/UI, coverage, build, package smoke and an isolated browser job are required appropriately.
3. Add controlled artifact retention and Linux/macOS/Windows coverage for platform-specific behavior.

**Acceptance criteria.** A documented upstream CI matrix executes the intended suites and fails for a deliberately broken regression.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** This is a verification gap in available inputs, not a claim that hosted CI is absent.

<a id="tg-022"></a>
### 48. TG-022 — Evidence export client lacks direct malformed-response coverage

**P2 · confidence 100% · complexity 1/5 · implemented · unit / UI**

**Evidence / gap.** Parsed JSON is cast before object validation, so null or primitive responses can fail via accidental property access instead of the intended error.

**Existing coverage credited.** Evidence lens validation and export behavior have extensive lower-layer tests.

**Inspect.** `src/ui/lib/evidence-export.ts`

**Implementation notes.**
1. Validate parsed unknown top-level envelopes.
2. Test lens validation before fetch, encoded target IDs, immutable request body, invalid JSON, empty data, HTTP fallback errors and network rejection.
3. Keep ordinary evidence semantics unchanged.

**Acceptance criteria.** Invalid input never fetches; invalid responses produce controlled errors; valid data is returned.

**Selective change.** [PATCH-10](patch-notes/PATCH-10.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

**Risk / decision.** Truthy wrong nested data remains a contract decision; TG-052.

<a id="tg-037"></a>
### 49. TG-037 — Archive lacks ignore rules for generated test evidence and dependencies

**P2 · confidence 100% · complexity 1/5 · implemented · tooling**

**Evidence / gap.** No .gitignore is present in the supplied archive; installing dependencies or running browser/coverage tools can leave large or sensitive outputs available for accidental staging.

**Existing coverage credited.** This is an archive-context observation, not proof that the upstream GitHub repository lacks a .gitignore.

**Inspect.** `.gitignore`

**Implementation notes.**
1. Add minimal rules for node_modules, dist, coverage, Playwright reports, test results and .DS_Store.
2. On upstream drift merge these patterns into existing rules.
3. Keep synthetic audit evidence separate from actual browser traces.

**Acceptance criteria.** Generated outputs are ignored without hiding source tests or committed fixture data.

**Selective change.** [PATCH-19](patch-notes/PATCH-19.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

**Risk / decision.** Do not overwrite an existing upstream .gitignore wholesale.

<a id="tg-017"></a>
### 50. TG-017 — Finite but unsafe timestamps can produce self-invalidating cursors

**P2 · confidence 100% · complexity 2/5 · implemented · unit**

**Evidence / gap.** A very large finite updatedAtMs is encoded although the decoder requires a safe integer; a generated nextCursor then cannot be consumed.

**Existing coverage credited.** NaN/Infinity/negative timestamp handling already exists and receives extra regression coverage.

**Inspect.** `src/lib/conversation-data/pagination.ts`

**Implementation notes.**
1. Normalize timestamps once for ordering and cursor generation using safe integer floor or zero.
2. Test Number.MAX_VALUE and paging into the next item.
3. Keep negative/null/non-finite fallback consistent.

**Acceptance criteria.** Every emitted timestamp is decoder-valid and the generated cursor advances without losing the next row.

**Selective change.** [PATCH-18](patch-notes/PATCH-18.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

**Risk / decision.** Corrupt giant timestamps now sort with zero/unknown values rather than ahead of real dates.

<a id="tg-062"></a>
### 51. TG-062 — Web-store eviction and stale deep links are not exercised in the browser

**P2 · confidence 99% · complexity 3/5 · pending · E2E**

**Evidence / gap.** In-memory imports are intentionally bounded and process-local; browser reload/deep links after eviction or restart need an understandable failure state.

**Existing coverage credited.** Existing web-store units cover retention and limits; PATCH-16 covers reload while the item still exists.

**Inspect.** `src/lib/web-chat.ts`, `src/ui/routes/web-chats.$conversationId.tsx`

**Implementation notes.**
1. Use a small test-configured retention budget or deterministic eviction fixtures.
2. Open an imported detail, evict/restart, then navigate/reload/back.
3. Assert a recoverable expired/not-found UI and no stale transcript from client cache.

**Acceptance criteria.** Users see an accurate recovery action instead of a blank page, crash or another conversation’s content.

**Verification.** Static review only; proposal is not implemented or executed.

<a id="tg-063"></a>
### 52. TG-063 — Real file chooser/drop/keyboard/reselection behavior remains uncovered

**P2 · confidence 99% · complexity 3/5 · pending · E2E / accessibility**

**Evidence / gap.** setInputFiles covers one browser input path but not drag/drop, keyboard activation or selecting the same filename after a prior attempt.

**Existing coverage credited.** Component events and the staged direct input upload already cover basic imports.

**Inspect.** `src/ui/routes/web.index.tsx`

**Implementation notes.**
1. Exercise accessible keyboard activation and actual drag/drop DataTransfer.
2. Repeat the same file after an error and after success.
3. Verify input reset, disabled/loading states and duplicate error behavior without double submission.

**Acceptance criteria.** All supported input gestures reach the same validated import pipeline exactly once.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Inspect actual component extraction on upstream drift; some behavior may remain in the route.

<a id="tg-069"></a>
### 53. TG-069 — Browser and operating-system compatibility matrix remains Chromium-only

**P2 · confidence 99% · complexity 3/5 · pending · E2E / portability**

**Evidence / gap.** The staged harness defines only Desktop Chrome; WebKit/Firefox, mobile viewport and Windows filesystem semantics are not covered by it.

**Existing coverage credited.** Existing tests have some platform branches and the new POSIX mode tests skip Windows appropriately.

**Inspect.** `testing/e2e/playwright.config.ts`, `src/lib/private-runtime-directory.ts`

**Implementation notes.**
1. After Chromium is stable, add Firefox/WebKit projects for critical journeys.
2. Add at least one narrow viewport/keyboard path and run platform-sensitive filesystem tests on Windows/macOS.
3. Record supported-versus-unsupported feature behavior rather than silently skipping failures.

**Acceptance criteria.** The supported platform matrix has explicit passing contracts and documented capability exceptions.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Avoid multiplying all heavy stress tests across every matrix cell.

<a id="tg-030"></a>
### 54. TG-030 — API method dispatch needs a complete Allow-header matrix

**P2 · confidence 98% · complexity 1/5 · implemented · unit**

**Evidence / gap.** Individual method errors do not lock down the supported method set for every stable route.

**Existing coverage credited.** The API already has route and error tests.

**Inspect.** `src/lib/conversation-api.ts`

**Implementation notes.**
1. Table-test 11 stable routes with an unsupported method.
2. Assert 405, exact Allow and safety headers.
3. Keep method rejection separate from origin rejection.

**Acceptance criteria.** Every route publishes the intended method contract without invoking normal data work.

**Selective change.** [PATCH-05](patch-notes/PATCH-05.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

<a id="tg-035"></a>
### 55. TG-035 — ZIP cleanup assertion can fail because of another test’s temporary directory

**P2 · confidence 98% · complexity 1/5 · implemented · unit / isolation**

**Evidence / gap.** The existing cleanup check observes a broad global temporary prefix; a parallel test can legitimately own another matching directory.

**Existing coverage credited.** The cleanup behavior itself already has coverage.

**Inspect.** `src/lib/conversation-zip-export.test.ts`

**Implementation notes.**
1. Narrow the assertion to the unique project prefix created by this test.
2. Retain actual cleanup checks rather than ignoring filesystem errors.
3. Add empty selection and cleanup ordering contract cases in the new integrity suite.

**Acceptance criteria.** Only this test’s temporary artifacts determine its pass/fail result.

**Selective change.** [PATCH-09](patch-notes/PATCH-09.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

<a id="tg-036"></a>
### 56. TG-036 — Live-stream URL generation lacks an explicit browser-safe encoding suite

**P2 · confidence 98% · complexity 1/5 · implemented · unit / UI**

**Evidence / gap.** Loopback alias, protocol/port and special event ID behavior is important for live reconnect but only indirectly exercised.

**Existing coverage credited.** Other live client/fallback tests already exist.

**Inspect.** `src/ui/lib/codex-thread-live-url.ts`

**Implementation notes.**
1. Table-test three host aliases including IPv6 brackets.
2. Assert HTTP/HTTPS and port behavior, reserved/Unicode IDs, cleared old query/hash, readonly inputs and empty selection.
3. Keep origin policy distinct from URL construction.

**Acceptance criteria.** Generated URLs round-trip parameters without altering the supplied IDs.

**Selective change.** [PATCH-13](patch-notes/PATCH-13.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

<a id="tg-033"></a>
### 57. TG-033 — Keyset pagination needs full tied-data traversal invariants

**P2 · confidence 98% · complexity 2/5 · implemented · unit**

**Evidence / gap.** A few page examples can miss duplicate/omitted records at equal timestamps across sources and ID tie breakers.

**Existing coverage credited.** Baseline pagination and cursor validation already have unit examples.

**Inspect.** `src/lib/conversation-data/pagination.ts`

**Implementation notes.**
1. Build 97 deterministic tied records spanning every registered source.
2. Traverse with page sizes 1,2,7,16,97,200 and assert no mutation, duplicate or omission.
3. Test removed cursor rows, exact boundaries and malformed cursor/limit tables.

**Acceptance criteria.** Concatenated pages equal the intended stable order exactly and terminate with correct metadata.

**Selective change.** [PATCH-07](patch-notes/PATCH-07.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

<a id="tg-065"></a>
### 58. TG-065 — Settings persistence and server hydration need real-browser assertions

**P2 · confidence 98% · complexity 3/5 · pending · E2E**

**Evidence / gap.** Component/storage-unit tests do not prove cookies/preferences are consumed consistently during SSR, reload and navigation.

**Existing coverage credited.** Existing settings/preferences tests remain valuable.

**Inspect.** `src/ui/routes/settings.tsx`, `src/ui/routes/__root.tsx`

**Implementation notes.**
1. Change path conversion/redaction and theme settings in a browser.
2. Reload and open another relevant route/context with the same storage.
3. Assert rendered/exported effects and no hydration mismatch; test invalid old stored values.

**Acceptance criteria.** Persisted settings have consistent server/client behavior and malformed stored state falls back safely.

**Verification.** Static review only; proposal is not implemented or executed.

<a id="tg-067"></a>
### 59. TG-067 — Dialogs and virtualized views need keyboard/focus/accessibility browser coverage

**P2 · confidence 98% · complexity 3/5 · pending · E2E / accessibility**

**Evidence / gap.** jsdom cannot fully verify focus trapping, restoration, scrolling and browser accessibility semantics under real navigation.

**Existing coverage credited.** Existing component role/label assertions provide a useful baseline.

**Inspect.** `src/ui/components/export-dialog.tsx`, `src/ui/components/ui/alert-dialog.tsx`, `src/ui/components`

**Implementation notes.**
1. Test keyboard-only open/close/confirm/cancel with focus returning to the trigger.
2. Check error announcements and reachable virtualized controls.
3. Add an accessibility scanner only after resolving a root-manifest dependency and review findings manually.

**Acceptance criteria.** Core import/export/delete journeys work without a pointer and have no agreed critical accessibility violations.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Do not install a second application dependency graph under testing/.

<a id="tg-068"></a>
### 60. TG-068 — Large deferred/virtualized transcripts lack browser resource and ordering tests

**P2 · confidence 98% · complexity 4/5 · pending · E2E / performance**

**Evidence / gap.** Large payloads are intentionally deferred; browser hydration, fetch timing, virtual scroll/search and memory need joined verification.

**Existing coverage credited.** Existing unit/component tests cover deferred preview and virtualized rendering logic.

**Inspect.** `src/ui/routes/threads.$threadId.tsx`, `src/ui/routes/cursor-threads.$composerId.tsx`, `src/ui/routes/antigravity-conversations.$conversationId.tsx`

**Implementation notes.**
1. Generate large synthetic rollouts/artifacts behind fixture routes.
2. Assert lightweight initial payload and explicit full-load behavior after hydration.
3. Scroll/search/filter across boundaries and measure bounded DOM/memory without dropping or reordering events.

**Acceptance criteria.** Large conversations stay responsive and preserve full content when requested.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Use a separate stress tier so fast CI tests remain deterministic.

<a id="tg-070"></a>
### 61. TG-070 — Installed-package app smoke needs browser-level reproducibility evidence

**P2 · confidence 97% · complexity 4/5 · pending · integration / E2E / packaging**

**Evidence / gap.** The new browser harness runs the repository production build, not the exact packed/installed artifact a user receives.

**Existing coverage credited.** Existing package-smoke already checks package installation, CLI/app health, Bun and Node payload consumers and declarations.

**Inspect.** `src/package-smoke.ts`, `src/build-server.ts`, `src/build-payload.ts`

**Implementation notes.**
1. Restore the original missing CLI input first.
2. Start the packed package from an isolated consumer root using the safe environment helper.
3. Run a small import/export browser smoke and assert no dependence on repository src, development caches or undeclared files.

**Acceptance criteria.** The shipped package works from a clean consumer directory with only declared artifacts.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Do not recreate legacy entrypoints or replace the missing CLI with a stub to make this pass.

<a id="tg-024"></a>
### 62. TG-024 — Live route test globals and abort wiring can leak across cases

**P2 · confidence 96% · complexity 1/5 · implemented · unit / UI**

**Evidence / gap.** Inherited SPIRACHA_CODEX_DB and retained mock implementations can make tests environment/order dependent; explicit AbortSignal forwarding also needs an assertion.

**Existing coverage credited.** SSE helper tests already cover subscriber cancellation and shared monitor cleanup.

**Inspect.** `src/ui/lib/codex-thread-events-route.vitest.ts`

**Implementation notes.**
1. Reset mocks and install deterministic default implementations per case.
2. Stub/restore database environment explicitly.
3. Assert route passes the exact incoming abort signal to the stream factory.

**Acceptance criteria.** Each case is independent of prior implementation overrides and user database configuration.

**Selective change.** [PATCH-11](patch-notes/PATCH-11.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

**Risk / decision.** This is route wiring, not a real socket disconnect proof; TG-050.

<a id="tg-031"></a>
### 63. TG-031 — SDK must distinguish domain 404/405 from missing or misrouted endpoints

**P2 · confidence 96% · complexity 2/5 · implemented · unit / integration**

**Evidence / gap.** Broad null/unsupported handling can accidentally hide an unknown API route or ordinary method_not_allowed response.

**Existing coverage credited.** The baseline has individual domain-error examples; the missing assertion is consistent behavior across read/download/delete methods.

**Inspect.** `src/client.ts`

**Implementation notes.**
1. Table-test detail, Markdown, raw and ZIP domain-not-found versus route-not-found.
2. Test ordinary 405 for both single and batch deletion.
3. Preserve domain null/unsupported semantics only for matching typed error codes.

**Acceptance criteria.** Domain absence returns null where documented; route/method failures stay typed exceptions.

**Selective change.** [PATCH-04](patch-notes/PATCH-04.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

<a id="tg-034"></a>
### 64. TG-034 — Cache failure, fingerprint and byte-budget edges need direct coverage

**P2 · confidence 96% · complexity 2/5 · implemented · unit / filesystem**

**Evidence / gap.** Happy-path reuse does not prove failures are retryable, absent files avoid parsing or atomic same-size replacement invalidates cached content.

**Existing coverage credited.** Existing tests exercise basic TTL/size/invalidation behavior.

**Inspect.** `src/lib/bounded-file-cache.ts`

**Implementation notes.**
1. Add rejected/null loader retries, missing/directory cases, delete/recreate and parser-key salts.
2. Replace a file atomically with same-size content to exercise identity fingerprints.
3. Test zero/oversize budgets and invalid ceilings.

**Acceptance criteria.** Failed loads do not poison later reads and changed file identities do not return stale content.

**Selective change.** [PATCH-06](patch-notes/PATCH-06.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

**Risk / decision.** Memory accounting still estimates source bytes, not full retained object size; TG-061.

<a id="tg-052"></a>
### 65. TG-052 — HTTP response validation stops at the top-level envelope

**P2 · confidence 96% · complexity 3/5 · pending · unit / integration**

**Evidence / gap.** PATCH-04/10 reject non-object envelopes, but truthy data with the wrong nested shape may still be returned under a strong TypeScript type.

**Existing coverage credited.** Well-formed result DTOs and typed server errors already have tests.

**Inspect.** `src/client.ts`, `src/ui/lib/evidence-export.ts`

**Implementation notes.**
1. Decide whether the public client trusts same-version servers or validates critical DTOs.
2. Add lightweight schemas for lists, page metadata, detail and evidence outputs if required.
3. Table-test arrays/scalars/missing fields and preserve forward-compatible optional fields.

**Acceptance criteria.** The agreed compatibility policy is explicit and malformed required fields cannot masquerade as a successful typed result.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Schema strictness can break older/newer clients; avoid over-restricting extension fields.

<a id="tg-058"></a>
### 66. TG-058 — Parser fixture examples need seed-reproducible property and grammar fuzzing

**P2 · confidence 96% · complexity 4/5 · pending · unit / property**

**Evidence / gap.** Handwritten examples cannot span malformed nesting, ordering, Unicode and role/tool combinations across all provider grammars.

**Existing coverage credited.** The archive already contains extensive real/provider fixture and malformed-input tests; fuzzing complements them.

**Inspect.** `src/lib/conversation-payload.ts`, `src/lib/web-chat.ts`, `src/lib/codex-transcript-records.ts`

**Implementation notes.**
1. Build bounded source-aware generators with recorded random seeds.
2. Assert no mutation, deterministic output, bounded errors and preservation of meaningful message order/content.
3. Shrink failures into committed provider fixtures and run a small fixed seed corpus in CI.

**Acceptance criteria.** Any discovered regression is reproducible from a seed and promoted to a focused contract test.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Keep grammars bounded; unrestricted random JSON mostly exercises trivial rejection.

<a id="tg-032"></a>
### 67. TG-032 — Content-Disposition precedence and malformed encodings need SDK assertions

**P2 · confidence 95% · complexity 2/5 · implemented · unit / integration**

**Evidence / gap.** Download filename decoding can regress on UTF-8 names or malformed percent escapes, and base URL query state can bleed into requests.

**Existing coverage credited.** There are existing basic filename and URL construction tests.

**Inspect.** `src/client.ts`

**Implementation notes.**
1. Test filename* precedence over quoted filename and malformed encoding fallback.
2. Compare downloaded raw bytes including 0xFF/CRLF.
3. Assert a prefixed base URL retains path but clears stale query/fragment.

**Acceptance criteria.** UTF-8 filenames and raw bytes survive; invalid encodings use a safe fallback; URL prefix is retained.

**Selective change.** [PATCH-04](patch-notes/PATCH-04.md)

**Verification.** Supplemental evidence is mapped in the patch note; canonical Bun/Vitest/Playwright execution is blocked.

<a id="tg-042"></a>
### 68. TG-042 — Test discovery and nested UI execution need a deterministic contract

**P2 · confidence 94% · complexity 2/5 · pending · tooling**

**Evidence / gap.** Root Bun runs a wrapper that launches Vitest, while coverage then launches the UI coverage run again. New browser files must not be auto-discovered by Bun.

**Existing coverage credited.** The wrapper already ensures UI failures propagate; PATCH-16 uses .e2e.ts names to avoid default Bun suffixes.

**Inspect.** `src/ui-suite.test.ts`, `vitest.config.ts`, `package.json`, `testing/e2e/playwright.config.ts`

**Implementation notes.**
1. Create a small suite-inventory assertion and document root/UI/browser ownership.
2. Test child exit propagation and ensure browser specs are excluded from root discovery.
3. Decide whether duplicate UI execution is deliberate; retain an explicit complete command if separating jobs.

**Acceptance criteria.** All expected suites run once in the agreed pipeline, and focused/skipped tests cannot silently reduce required coverage.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Changing scripts needs CI coordination and root manifest review, not an unverified offline edit.

<a id="tg-071"></a>
### 69. TG-071 — Cloudflare-specific payload portability is not established by browser Workers

**P2 · confidence 94% · complexity 3/5 · pending · integration / portability**

**Evidence / gap.** Browser module Workers and Node do not exercise the specific Worker deployment/module-resolution constraints named in the README.

**Existing coverage credited.** Existing Bun/Node consumers and staged browser/Worker cases provide broad portable-runtime evidence.

**Inspect.** `src/build-payload.ts`, `src/lib/conversation-payload.ts`, `testing/e2e/payload-portability.e2e.ts`

**Implementation notes.**
1. Create a minimal isolated Cloudflare-compatible test consumer using the compiled package export.
2. Convert the fixed provider fixture set without network/filesystem access.
3. Assert package resolution, crypto/text APIs and typed invalid-input behavior.

**Acceptance criteria.** The documented Worker target executes the compiled package with no Node/Bun compatibility shims.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Resolve the external test tool dependency in the root lockfile; deployment credentials must not be required for routine CI.

<a id="tg-079"></a>
### 70. TG-079 — Suite-wide global state and teardown reliability need randomized-order auditing

**P2 · confidence 94% · complexity 3/5 · pending · tooling / isolation**

**Evidence / gap.** Global env/fetch mocks, temporary directories and subprocesses can create order-dependent passes or leaks even when focused tests pass.

**Existing coverage credited.** PATCH-09/11/15 close specific observed isolation weaknesses; many existing suites already clean up correctly.

**Inspect.** `src/client.test.ts`, `src/ui/vitest.setup.ts`, `src/ui/lib/codex-thread-events-route.vitest.ts`, `src/lib/*-test-helpers.ts`

**Implementation notes.**
1. Inventory environment/fetch/time/module mocks and ensure restoration in hooks/finally.
2. Run supported randomized seeds and parallel stress for fixture-heavy suites.
3. Check child processes, sockets and owned temp directories return to baseline, recording failing seeds.

**Acceptance criteria.** Focused and full randomized runs agree without developer-path access, leaked workers or cross-test temporary-file assertions.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Do not fix flakes by adding retries or weakening assertions before identifying the shared state.

<a id="tg-073"></a>
### 71. TG-073 — Cloud auth refresh needs process-and-HTTP seam tests without credentials

**P2 · confidence 94% · complexity 4/5 · pending · integration**

**Evidence / gap.** Function mocks do not cover a real fake-CLI subprocess emitting malformed/huge output or a delayed HTTP auth-refresh sequence.

**Existing coverage credited.** Cloud request normalization and authentication paths already have mocked unit coverage.

**Inspect.** `src/lib/codex-cloud.ts`, `src/lib/codex-cloud-transcript.ts`

**Implementation notes.**
1. Use a fixture executable and local stub HTTP server with no actual user login.
2. Exercise expired token refresh, timeout, cancellation, stderr/output limits and malformed JSON.
3. Assert token redaction and no shell interpolation of untrusted task IDs.

**Acceptance criteria.** Controlled process/network failures are bounded and surface actionable safe errors without consulting real credentials.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Preserve the design that Codex CLI owns login refresh; do not add a second auth implementation.

<a id="tg-074"></a>
### 72. TG-074 — Qoder ACP framing needs malformed/oversized/half-close fuzz cases

**P2 · confidence 94% · complexity 4/5 · pending · integration / property**

**Evidence / gap.** The current socket examples do not exhaust split/invalid frame boundaries, oversized declared lengths and premature half-closes.

**Existing coverage credited.** Existing tests cover framed updates, ID collisions, drain-after-load, empty completion and client-side limits.

**Inspect.** `src/lib/qoder-acp-client.ts`, `src/lib/qoder-acp-client.test.ts`

**Implementation notes.**
1. Use a local fixture socket with deterministic byte fragmentation and malformed headers/lengths.
2. Add oversized frames, truncated UTF-8/JSON, duplicate responses and peer half-close.
3. Assert bounded buffering, useful errors, cancellation and socket cleanup.

**Acceptance criteria.** Invalid or incomplete frames cannot hang the request or grow memory without bound; valid fragmented frames still work.

**Verification.** Static review only; proposal is not implemented or executed.

<a id="tg-060"></a>
### 73. TG-060 — SQLite schema compatibility needs an explicit real-file version matrix

**P2 · confidence 92% · complexity 4/5 · pending · integration / portability**

**Evidence / gap.** Individual schema fixtures do not clearly enumerate supported historical/current optional columns, absent tables and platform error variants.

**Existing coverage credited.** Existing DB suites already use real SQLite fixtures and cover multiple fallback/error conditions.

**Inspect.** `src/lib/codex-database.ts`, `src/lib/cursor-db.ts`, `src/lib/opencode-db.ts`

**Implementation notes.**
1. Catalog supported schema variants from current adapters and checked-in fixtures.
2. Build minimal real databases for each capability combination, including read-only and WAL sidecars.
3. Verify graceful unsupported-schema reporting and no accidental migration/mutation.

**Acceptance criteria.** The support matrix maps every variant to a passing fixture-backed list/detail/raw behavior or a controlled unsupported result.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Do not fabricate support for unknown upstream schema versions.

<a id="tg-059"></a>
### 74. TG-059 — Deep materialized payloads need explicit recursion and complexity contracts

**P2 · confidence 91% · complexity 3/5 · pending · unit / security**

**Evidence / gap.** Caller-supplied objects can bypass byte-oriented text limits; deep nesting or enormous embedded arrays deserve distinct complexity tests.

**Existing coverage credited.** Existing suites already exercise cycles and JSON/payload limits; do not relabel those as missing.

**Inspect.** `src/lib/conversation-payload.ts`, `src/lib/web-chat.ts`

**Implementation notes.**
1. Inventory recursion, node-count and string budgets for already-materialized objects.
2. Test deeply nested but acyclic structures and wide arrays at boundaries.
3. Require controlled typed errors rather than stack overflow or pathological traversal.

**Acceptance criteria.** Complexity limits are documented, enforced before excessive work and consistent between text and object inputs.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Confirm the actual helper path during implementation; normalization may be distributed across payload modules.

<a id="tg-072"></a>
### 75. TG-072 — Error logs and retained browser artifacts need a privacy contract

**P2 · confidence 91% · complexity 3/5 · pending · integration / security**

**Evidence / gap.** Generic HTTP 500 bodies are tested, but original errors may still be logged; traces/screenshots can contain conversation text and auth-related context.

**Existing coverage credited.** PATCH-05 verifies generic client-facing internal errors, and the browser harness uses synthetic data only.

**Inspect.** `src/lib/conversation-api.ts`, `testing/e2e/playwright.config.ts`, `src/lib/codex-cloud.ts`

**Implementation notes.**
1. Define allowed diagnostic fields and redaction rules for paths/tokens/content.
2. Inject sentinel secrets into controlled errors and capture logs.
3. Document CI trace access/retention and enforce fixture-only browser environments.

**Acceptance criteria.** No sentinel secret leaks into user-facing responses or retained logs/artifacts outside the adopted diagnostic policy.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Logging tradeoffs need an explicit policy; avoid stripping information required for safe recovery.

<a id="tg-078"></a>
### 76. TG-078 — Export filename portability needs Windows reserved-name boundary cases

**P2 · confidence 88% · complexity 2/5 · pending · unit / portability**

**Evidence / gap.** Path punctuation/Unicode collision tests do not necessarily cover CON/PRN/AUX, trailing dots/spaces and truncation near the filename byte limit.

**Existing coverage credited.** Filename sanitization and collision logic already have substantial tests; PATCH-09 adds archive body integrity.

**Inspect.** `src/lib/ui-export-files.ts`, `src/lib/ui-export-archive.ts`, `src/lib/conversation-zip-export.ts`

**Implementation notes.**
1. Locate the actual filename-byte budget and test Windows reserved basenames with/without extensions.
2. Combine multi-byte truncation with case/NFC collisions and suffix assignment.
3. Extract generated archives on supported OS fixtures if portable extraction is part of the contract.

**Acceptance criteria.** Downloaded archive entry names remain distinct and usable on supported platforms without losing content.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** This is a portability gap hypothesis; verify upstream tests and exact limit before changing naming conventions.

<a id="tg-061"></a>
### 77. TG-061 — Cache maxBytes is not demonstrated as a retained-memory bound

**P2 · confidence 88% · complexity 3/5 · pending · unit / performance**

**Evidence / gap.** File size is a useful admission estimate but parsed objects can expand or retain extra data; naming can imply a stronger memory guarantee than implemented.

**Existing coverage credited.** Cache eviction/byte admission and PATCH-06 edge tests exist.

**Inspect.** `src/lib/bounded-file-cache.ts`

**Implementation notes.**
1. Document whether maxBytes means source bytes or estimated retained object bytes.
2. Add expansion-heavy loader fixtures and eviction/admission assertions.
3. Measure process memory separately if a true memory budget is required; introduce a weight callback only with a clear contract.

**Acceptance criteria.** The cache budget is accurately named/documented and measured behavior matches that contract.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** Do not treat object-size expansion alone as a bug if the documented budget is source bytes.

<a id="tg-055"></a>
### 78. TG-055 — Static asset realpath containment is not exercised against symlinked build files

**P2 · confidence 83% · complexity 3/5 · pending · integration / security**

**Evidence / gap.** Lexical path.resolve containment alone cannot prove containment after a symlink; the practical risk depends on whether build output is trusted and writable.

**Existing coverage credited.** Production server tests already cover ordinary assets and path handling.

**Inspect.** `src/lib/production-ui-server.ts`

**Implementation notes.**
1. Inspect actual static-file dispatch and document the trusted-build assumption.
2. Serve a fixture dist tree containing an internal symlink to an outside sentinel.
3. Assert the chosen rejection/containment contract and preserve legitimate asset behavior.

**Acceptance criteria.** No unreviewed path follows a symlink outside the allowed static root under the adopted policy.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** This is a medium-confidence hardening opportunity, not a demonstrated production data leak.

<a id="tg-053"></a>
### 79. TG-053 — SDK timeout and cancellation behavior has no explicit public contract

**P2 · confidence 82% · complexity 3/5 · pending · unit / integration**

**Evidence / gap.** Long local/HTTP exports can outlive a caller’s intent; the current API does not expose an obvious unified cancellation/timeout option.

**Existing coverage credited.** Ordinary network failure/status handling is tested.

**Inspect.** `src/client.ts`

**Implementation notes.**
1. Decide whether caller-provided AbortSignal belongs on client defaults, operation options or both.
2. Add delayed-response/stream tests with abort before connect and during body transfer.
3. Verify typed abort errors and cleanup without converting cancellation into not-found.

**Acceptance criteria.** Documented cancellation stops work where supported and cannot return a misleading successful or null result.

**Verification.** Static review only; proposal is not implemented or executed.

**Risk / decision.** This is a design-dependent improvement, not a reproduced API bug.
