# PATCH-09 — ZIP archive content integrity and fixture cleanup isolation

Commit: `f1b61aeb3cf65e3d3c69e93a5e85885ab2e2bb2d`

Findings: [TG-018](../LEDGER.md#tg-018), [TG-035](../LEDGER.md#tg-035)

Prerequisites: **None among the code patches; independently selectable from the supplied baseline.**

## Why this change

The collision resolver already existed; the missing assurance is that all unique original bodies survive actual compression. An existing cleanup assertion also matched other tests’ broad temporary prefix.

## Files

- `src/lib/conversation-zip-export.integrity.test.ts`
- `src/lib/conversation-zip-export.test.ts`

## Implementation details

Unzip real archives with fflate and verify every content/name pair, NFC/case/suffix collisions, path safety and NUL/CRLF/emoji bytes. Keep blob readable after cleanup. Narrow the existing cleanup assertion to its own randomized project prefix and test cleanup error ordering.

## Acceptance checks

- **TG-018** — All expected bodies appear exactly once under safe distinct names and remain readable after temporary files are removed.
- **TG-035** — Only this test’s temporary artifacts determine its pass/fail result.

## Targeted canonical commands

Run from the repository root after installing the project toolchain. Prefix with `rtk` where available, as requested by AGENTS.md. These commands were **not successfully executed in this environment**.

```bash
bun test src/lib/conversation-zip-export.test.ts src/lib/conversation-zip-export.integrity.test.ts
```

For browser patches, first complete the optional root dependency/lock installation in `testing/e2e/README.md`. Full acceptance also requires the root lint, typecheck, unit/UI, coverage, build and package checks listed in the handoff.

## Evidence actually obtained

Syntax checks passed. Real ZIP tests require Bun and fflate and were not run here; there is no invented CRC/content result.

## Drift, compatibility and rollback

Locate filename resolver/archive exports on drift; preserve its existing algorithm unless the new body assertions prove a bug. Keep temporary-prefix ownership local to each test, not global /tmp emptiness.

Apply using the individual format-patch or cherry-pick this commit from the included Git bundle. On conflict, use these semantic notes and the test acceptance criteria; do not resolve by discarding tests or disabling compiler/lint rules. Roll back this commit with git revert only after checking whether a later selected patch depends on it.

## Residual gaps

Read the linked findings and the pending ledger. A new test file is not a measured coverage increase; no canonical runtime test pass is claimed until it is executed in the target repository.
