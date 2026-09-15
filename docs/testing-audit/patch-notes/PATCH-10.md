# PATCH-10 — Evidence export UI helper validation

Commit: `a058ae93566b71fc4f1d768d988b26b69c7cb913`

Findings: [TG-022](../LEDGER.md#tg-022)

Prerequisites: **None among the code patches; independently selectable from the supplied baseline.**

## Why this change

The helper cast parsed JSON before top-level object checking and lacked a direct focused test suite.

## Files

- `src/ui/lib/evidence-export.ts`
- `src/ui/lib/evidence-export.vitest.ts`

## Implementation details

Reject null/array/primitive envelopes before data access. Test invalid lens before fetch, encoded IDs, request body immutability, network/status/JSON/error fallbacks and missing data. Restore fetch mocks after each case.

## Acceptance checks

- **TG-022** — Invalid input never fetches; invalid responses produce controlled errors; valid data is returned.

## Targeted canonical commands

Run from the repository root after installing the project toolchain. Prefix with `rtk` where available, as requested by AGENTS.md. These commands were **not successfully executed in this environment**.

```bash
bunx vitest run --config vitest.config.ts src/ui/lib/evidence-export.vitest.ts
```

For browser patches, first complete the optional root dependency/lock installation in `testing/e2e/README.md`. Full acceptance also requires the root lint, typecheck, unit/UI, coverage, build and package checks listed in the handoff.

## Evidence actually obtained

Independent Node evidence checks passed 12 assertions; limited TS subset includes the production helper. Vitest was not available.

## Drift, compatibility and rollback

Reapply near the response.json call without weakening shared lens validation. Nested data validation remains a separate compatibility decision.

Apply using the individual format-patch or cherry-pick this commit from the included Git bundle. On conflict, use these semantic notes and the test acceptance criteria; do not resolve by discarding tests or disabling compiler/lint rules. Roll back this commit with git revert only after checking whether a later selected patch depends on it.

## Residual gaps

Read the linked findings and the pending ledger. A new test file is not a measured coverage increase; no canonical runtime test pass is claimed until it is executed in the target repository.
