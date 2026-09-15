# CODEX_HANDOFF.md

## Start here

This handoff accompanies a testing audit of **Spiracha 2.9.0 as supplied in the ZIP**, not a clone of upstream history. The project was initialized with Git before edits. Baseline commit: `b929a9d1f54300909a907d0b3407eabdbf359b59`. Read the target repository's `AGENTS.md` and `README.md` again before applying anything, because upstream may have moved.

**79 ranked findings: 32 implemented, 5 partially implemented browser findings and 42 pending.** Nineteen selective code commits are provided; a separate documentation-only commit carries this ledger/handoff. Each code patch has detailed rationale, acceptance criteria, validation limits and drift instructions in `docs/testing-audit/patch-notes/PATCH-XX.md`. The project snapshot is included for inspection, not for replacing an existing checkout wholesale.

The most urgent reproduced defects are the false-green coverage gate, stale in-flight reads after invalidation and generated cursors that could not decode their own legal boundary values. Further patches strengthen client error handling, partial import success, real archive/raw integrity assertions and fixture isolation. The browser harness is staged, not executed.

## Delivery contents

The outer ZIP contains `patches/` (one format-patch per commit), `spiracha-audit.bundle` (baseline plus the audit branch for real cherry-picking), `project/` (final source tree without .git), `findings/` (ledger and per-patch notes), `evidence/` (actual logs/inventory/application checks), `audit-tools/` (optional independent Node checks), `PATCH_INDEX.md`/`.json`, and `SHA256SUMS.txt`. This handoff is also copied to the delivery root.

Do not merge the synthetic baseline into upstream. Cherry-pick only the selected change commits. No combined all-fixes patch is provided.

## Inspect and fetch the selective commits

Start from a clean working tree/branch in the real repository. Verify the bundle and fetch its objects so three-way patch application can use the original base blobs:

```bash
git status --short
git switch -c audit/spiracha-testing
git bundle verify /absolute/path/to/delivery/spiracha-audit.bundle
git fetch /absolute/path/to/delivery/spiracha-audit.bundle \
  refs/heads/audit/testing-gaps:refs/remotes/spiracha-audit/testing-gaps
```

Select commit hashes from `PATCH_INDEX.md` or `docs/testing-audit/CODE_PATCH_INDEX.json`:

```bash
git cherry-pick <selected-commit-hash>
# Or, after fetching the bundle for base objects:
git am --3way /absolute/path/to/delivery/patches/<selected-file>.patch
```

Do not run both commands for the same change. On a failed apply, use `git cherry-pick --abort` or `git am --abort` as appropriate, inspect the per-patch notes and reimplement the semantic change on current code. Do not discard tests, weaken assertions, disable TypeScript/Biome rules, or edit the generated route tree to force a green run.

## Dependencies and selection order

**PATCH-16 depends on PATCH-15. PATCH-17 depends on PATCH-16 and therefore PATCH-15. All other code patches are designed to apply independently to the supplied baseline.** PATCH-07 and PATCH-18 are complementary pagination tests/fixes, not prerequisites of each other. Several findings deliberately share one coherent patch; selective means one focused commit, not one patch per assertion.

Prioritize PATCH-01 (coverage correctness), PATCH-06 (stale in-flight cache), PATCH-18 (cursor round trips), PATCH-15 (safe app fixture environment), PATCH-04/05 (SDK/API boundaries), then storage/export/UI coverage. Add browser PATCH-16/17 only together with their isolation dependency and the explicit toolchain setup below. PATCH-19 is optional if upstream already ignores these outputs; merge patterns, do not overwrite its existing file. Apply the documentation commit separately when useful.

Full hashes and files are recorded in the code patch index. Delivery evidence includes individual baseline apply checks (with only declared dependencies), a full series application and final-tree equality. These checks establish patch mechanics against this snapshot, not conflict-free application to every future upstream revision.

## Resolve the input and environment blockers first

1. Use the project's required Bun **1.4.2 or newer**, `bun`/`bunx`, and `rtk` wrapper when available. Install dependencies with `bun install --frozen-lockfile`. Do not switch to npm or invent dependency versions.
2. Restore the **actual upstream `bin/spiracha.ts`**, which is absent from this archive but referenced by package scripts and an existing manifest test. Do not fabricate a stub or restore removed legacy exporter/MCP/plugin entrypoints. Upstream may already contain this file and hidden CI metadata omitted by the ZIP.
3. For PATCH-16/17, run `bun add --dev --exact @playwright/test` at the **root** and review/commit the exact resolved root `package.json` and `bun.lock` changes. Then `bunx playwright install chromium` (or the documented CI system-dependency variant). The delivered patch does not pretend this dependency was resolved offline. There is no separate testing application manifest.

The browser harness is intentionally a separate `testing/e2e` TypeScript project because the existing root tsconfig includes only `src`/`bin`. `.e2e.ts` filenames avoid Bun's default test discovery. Run its explicit typecheck and browser command; merely passing root typecheck does not check these files.

## Canonical verification and acceptance

After each selected patch, run the targeted commands in its note. After the intended set, run all of:

```bash
rtk bun run lint
rtk bun run typecheck
rtk bun test
rtk bun run test:ui
rtk bun run coverage
rtk bun run build
rtk bun run test:package
```

Use the same commands without `rtk` only when the wrapper is unavailable. If Biome finds formatting/import ordering issues, run its write mode only on the changed paths first, inspect the resulting diff, then rerun full lint. No rule-disable comments are an acceptable substitute. Root `bun test` currently launches a UI wrapper; the separate UI invocation is useful explicit evidence but may duplicate work. Coordinate any script redesign with TG-042.

For the browser selections:

```bash
rtk bunx tsc --noEmit --project testing/e2e/tsconfig.json
rtk bun run build
rtk bunx playwright test --config testing/e2e/playwright.config.ts
```

Default port is 4179; set `SPIRACHA_E2E_PORT` to another unused unprivileged port if needed. **Never enable `reuseExistingServer`** or point destructive tests at a personal app. Fixture HOME/profile/XDG/source/auth paths must remain isolated before app imports; external browser HTTP is blocked. Keep single-worker/no-retry behavior initially. The harness uses SIGTERM/forced-stop fallback and removes its fixture directory; investigate any leaked process or directory instead of masking it with retries.

Complete browser acceptance requires six workflow cases and twelve generated portable-SDK cases to pass on the compiled app/payload, with no uncaught page errors. On selector drift, inspect actual accessible labels rather than mocking away the page. Trace/screenshots use synthetic fixture data only.

## Evidence obtained here — do not overstate it

**622 independent Node assertions passed across 10 groups.** They execute production modules using a small TypeScript source loader, including real temporary filesystem operations. Controlled before/after checks reproduced and corrected the coverage, cache and cursor failures. Thirty-six changed TS/TSX files parsed without errors. An explicit eight-module production subset typechecked with locally available TypeScript 5.8.3; the wider attempt hit missing Bun types. `git diff --check` passed.

**Bun/Vitest/Playwright, full lint/typecheck, coverage, build and package smoke did not run successfully.** Bun/rtk/dependencies are absent, and container DNS prevents downloading them; attempted Bun commands exited 127. No coverage percentage or delta was measured. The project requires a different compiler version than the supplemental subset used. Browser code, SQLite/HTTP/ZIP integration, official compiler compatibility and Biome formatting still need target-environment execution.

Use `docs/testing-audit/VALIDATION.md` and the raw evidence rather than treating a new test file as proof it passes. The independent Node harness is optional diagnostic support, not a replacement for the project's Bun-first toolchain.

## Continue the pending work

Follow the ranked ledger, not a generic test-count goal. Each pending row includes source entry points, existing coverage to preserve, implementation steps, acceptance criteria, confidence and complexity. Highest-impact remaining areas include unloaded-module/branch coverage, all-source public conformance, confirmed delete/fresh-app crash recovery, durability/resource faults, real live-worker/SSE lifetimes, and oversized non-payload JSON endpoints.

Existing Codex/Cursor crash/lock/replay tests and compiled Bun/Node payload consumers are already substantial. Reuse them. Do not claim they were missing or add redundant mocks that test less than the current suite. The static list of 100 no-obvious-direct-test modules is **untriaged** and includes types/generated/transitive modules; do not automatically mark them all uncovered.

Mark a finding complete only after its acceptance assertions execute under the appropriate runtime and the selected integration set passes. Record command, runtime/version, platform, exit status and relevant artifacts in the target repository's normal review evidence. Any upstream-specific conflicts or contract changes should be added to the patch note so later cherry-picks remain understandable.
