# Test audit — 2026-09-26

Baseline: `58152c9`, 294 test files / 59,594 lines. Root run: 1,345 pass,
2 fail. Preserve the existing ZIP dependency-version and Grok Bot deletion-phase
failures; removing a failing assertion is not a repair. Existing untracked
`.claude-title-investigation-lens.json` is unrelated and remains untouched.

Read-only discovery split core, conversation-data, UI/infrastructure and CLI/tooling.
This is a conservative candidate audit, not a claim that every remaining test is
minimal. The following decisions were recorded before editing.

| Decision and exact test | Detectable failure and retained proof | Caller, history, cleanup and validation |
| --- | --- | --- |
| Delete `bin/spiracha.test.ts` — `should resolve the package root from the executable location` | Repeats `path.resolve` on a synthetic path. Real packaged startup from the installed tarball verifies the actual executable location. | Only runtime caller is `runSpirachaCli` serve branch. Helper dates to legacy launcher (`d928744`, `792d2d8`), no remaining need for injected directory. Inline expression and remove exported helper. Low risk; CLI tests + `test:package`. |
| Delete same file — `should dispatch serve to the current UI server` | Calls an injected no-op and checks its own flag/zero result; never exercises the production server or package-root wiring. Keep actual packaged HTTP startup and `production-ui-server.test.ts` behavior tests. | Only test uses `runServer` injection; other CLI tests unnecessarily provide it. Explicit serve introduced in `c4175de`. Remove dependency member and mock arguments, preserve startup catch/error path. Low risk; CLI/server tests + `test:package`. No assertion of startup error handling is being removed. |
| Consolidate same file — `should expose bounded retrieval and require an explicit request file` | Successful parse duplicates `evidence-retrieval.test.ts` — `should read a retrieval request through the CLI without printing other messages and report deleted sources`. Missing-request rejection is unique: move it into existing invalid-CLI-options test. | Runtime parser is used by `runSpirachaCli`; introduced in `58152c9`. Remove declaration and redundant success assertion only. Low risk; CLI + evidence retrieval tests. |
| Delete `src/package-smoke.test.ts` — `should start the packaged production server explicitly` | Copies an argument array. Actual smoke spawns the packaged command and checks shell, assets, API and encrypted ZIP response. | Only runtime helper caller is `runPackagedUiSmokeTest`; introduced in `c4175de`. Inline array and delete export/import. Low risk; smoke helper tests + actual `test:package` (also a prepublish gate). |
| Delete same file — `should derive the packed tarball path from package metadata` | Copies `path.join`. Actual pack/install operation fails on the wrong tarball name or version. | Only runtime helper caller is `runPackagedUiSmokeTest`; introduced in `2c52bc0`. Inline path expression and delete export/test import. Low risk; same smoke checks. |
| Delete `src/lib/conversation-data/source-conformance.test.ts` — `should keep native, adapter, and UI fixture owners on disk for every source` | Exact subset of `src/test-support/conversation-sources.test.ts` — `should register an actual native, adapter, and UI action test for every source`; keeper also checks exhaustive keys and nonempty native path. | Both introduced in `e57b717`; fixture map is test-support contract, not runtime behavior. Both run in root CI and `test:conformance`. Remove test/import only. Low risk; `test:conformance`. |
| Delete `src/lib/minimax-code-transcript-phase.test.ts` — `should distinguish tool-use commentary from completed final answers` | `toolUse` commentary and `stop` final phases independently asserted through `minimax-code-transcript-events.vitest.ts` conversion/long-commentary cases and `minimax-code-transcript.test.ts` export filtering. | Runtime callers: `minimax-code-messages.ts` and UI transcript events. Helper case introduced in `3be2727`, renderer strengthened in `e57b717`. Keep helper and unique user-phase-null test. Low risk; phase/renderer/adapter tests + MiniMax UI events. |

Retain performance allocation/fan-out regression spies, portable/package/security
contracts, native setup isolation, raw compression requirement, and source binding
architecture checks: no stronger equivalent keeper was established. Keep the new
retrieval paging/staleness and executable deployment tests: they exercise actual
behavior and lifecycle boundaries.

The skill's OpenClaw-specific runners and `autoreview` skill are absent here.
Use this repository's Bun/Vitest gates and an independent preservation review of
the diff; do not claim those unavailable commands ran.

## Results

Removed six declarations and consolidated one into an existing test. Audit-owned
changes remove a net 66 test lines and 10 production/tooling lines; three trivial
helper exports and the startup injection are gone. No commit or PR was created.

Independent preservation review caught the deleted parser assertion's exact-ref
check missing from its keeper. The retained retrieval CLI resolver now asserts
the supplied reference. A deliberate wrong-reference mutation failed that keeper;
the source was restored byte-for-byte and both CLI/retrieval suites passed.
No other actionable coverage loss remained in the review.

Validation:

- Focused Bun owners: 34 pass; conformance: 10 pass; MiniMax UI events: 2 pass.
- Post-review CLI/retrieval checks: 15 pass.
- Full root coverage run: 1,340 pass, the same 2 baseline failures. Concurrent
  Claude-title work added cases during this audit, so the aggregate delta is not
  the number removed by this patch. Root line-coverage gate: 92.23%.
- Full UI: 524 pass; configured UI line-coverage gate: 91.11%.
- Typecheck, build, real packaged-startup/install smoke and final lint passed.
- Diff whitespace check passed. Unrelated concurrent Claude-title edits were
  not modified by this audit.

No claim is made that every remaining test in the repository is necessary.
Further deletion requires equivalent keeper evidence, especially for performance
instrumentation and the documented source-binding architecture.
