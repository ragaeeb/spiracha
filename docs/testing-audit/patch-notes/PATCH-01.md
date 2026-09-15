# PATCH-01 — Fail-closed coverage reports and exact thresholds

Commit: `34fca89ad277535702f6a093b6df61069ae86cf9`

Findings: [TG-001](../LEDGER.md#tg-001), [TG-002](../LEDGER.md#tg-002), [TG-003](../LEDGER.md#tg-003)

Prerequisites: **None among the code patches; independently selectable from the supplied baseline.**

## Why this change

The baseline accepted empty/non-LCOV reports, NaN hits and hits above totals. Rounding 89.999 to 90 also bypassed the CLI threshold. These were reproduced against the original implementation.

## Files

- `src/coverage-check.ts`
- `src/coverage-check.validation.test.ts`

## Implementation details

The parser now validates completed records, integer counters, paired function counters, unique included source paths and a nonzero measurable denominator. A separate exported assertion gates the raw ratio, retaining rounded presentation. New tests use small LCOV strings rather than changing real coverage thresholds.

## Acceptance checks

- **TG-001** — All four cases reject; a completed included record with real lines still summarizes normally.
- **TG-002** — 89999/100000 fails although the display is 90; 90/100 passes.
- **TG-003** — Every malformed table entry fails explicitly; valid CRLF/Windows records remain supported.

## Targeted canonical commands

Run from the repository root after installing the project toolchain. Prefix with `rtk` where available, as requested by AGENTS.md. These commands were **not successfully executed in this environment**.

```bash
bun test src/coverage-check.test.ts src/coverage-check.validation.test.ts
```

For browser patches, first complete the optional root dependency/lock installation in `testing/e2e/README.md`. Full acceptance also requires the root lint, typecheck, unit/UI, coverage, build and package checks listed in the handoff.

## Evidence actually obtained

coverage-before.jsonl and coverage-after.jsonl show deterministic before/after behavior; the independent Node LCOV group passed 22 assertions. Actual Bun/Vitest-generated LCOV compatibility remains unexecuted.

## Drift, compatibility and rollback

Reapply around summarizeLcovReport, parseLcovBlock and the CLI threshold comparison. Preserve upstream exclusion policy unless deliberately changed. Test the real generated LCOV before tightening grammar further.

Apply using the individual format-patch or cherry-pick this commit from the included Git bundle. On conflict, use these semantic notes and the test acceptance criteria; do not resolve by discarding tests or disabling compiler/lint rules. Roll back this commit with git revert only after checking whether a later selected patch depends on it.

## Residual gaps

Read the linked findings and the pending ledger. A new test file is not a measured coverage increase; no canonical runtime test pass is claimed until it is executed in the target repository.
