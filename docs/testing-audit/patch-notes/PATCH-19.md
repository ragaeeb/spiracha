# PATCH-19 — Minimal generated-output ignore rules

Commit: `2a76daa258bd2380e2b391e78fd412585fb2626d`

Findings: [TG-037](../LEDGER.md#tg-037)

Prerequisites: **None among the code patches; independently selectable from the supplied baseline.**

## Why this change

The supplied archive contains no .gitignore; this may differ from upstream.

## Files

- `.gitignore`

## Implementation details

Ignore dependencies, compiled output, coverage, Playwright reports, test results and .DS_Store without ignoring source fixtures or audit notes.

## Acceptance checks

- **TG-037** — Generated outputs are ignored without hiding source tests or committed fixture data.

## Targeted canonical commands

Run from the repository root after installing the project toolchain. Prefix with `rtk` where available, as requested by AGENTS.md. These commands were **not successfully executed in this environment**.

```bash
git check-ignore node_modules/example dist/example coverage/example playwright-report/index.html test-results/example .DS_Store
```

For browser patches, first complete the optional root dependency/lock installation in `testing/e2e/README.md`. Full acceptance also requires the root lint, typecheck, unit/UI, coverage, build and package checks listed in the handoff.

## Evidence actually obtained

Git whitespace checks passed. Selective patch application and ignore checks are captured in delivery validation evidence.

## Drift, compatibility and rollback

If upstream already has .gitignore, merge only missing patterns instead of replacing it. This patch is optional and does not affect runtime behavior.

Apply using the individual format-patch or cherry-pick this commit from the included Git bundle. On conflict, use these semantic notes and the test acceptance criteria; do not resolve by discarding tests or disabling compiler/lint rules. Roll back this commit with git revert only after checking whether a later selected patch depends on it.

## Residual gaps

Read the linked findings and the pending ledger. A new test file is not a measured coverage increase; no canonical runtime test pass is claimed until it is executed in the target repository.
