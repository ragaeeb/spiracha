# PATCH-03 — Real private-directory filesystem tests

Commit: `f731cdf06970bae1928a7a00a2d597c81d15e199`

Findings: [TG-015](../LEDGER.md#tg-015)

Prerequisites: **None among the code patches; independently selectable from the supplied baseline.**

## Why this change

The helper had no dedicated adjacent test file. Related file-level security tests are credited in the ledger.

## Files

- `src/lib/private-runtime-directory.test.ts`

## Implementation details

Create actual nested directories, chmod them on POSIX and test 0700 repair, idempotence, regular-file safety, leaf symlink behavior and assert-only missing paths. Every fixture is removed in finally; Windows skips apply only to POSIX mode/symlink-specific cases.

## Acceptance checks

- **TG-015** — Private directory contracts are verified on real temporary paths with reliable cleanup.

## Targeted canonical commands

Run from the repository root after installing the project toolchain. Prefix with `rtk` where available, as requested by AGENTS.md. These commands were **not successfully executed in this environment**.

```bash
bun test src/lib/private-runtime-directory.test.ts
```

For browser patches, first complete the optional root dependency/lock installation in `testing/e2e/README.md`. Full acceptance also requires the root lint, typecheck, unit/UI, coverage, build and package checks listed in the handoff.

## Evidence actually obtained

Independent Node filesystem checks passed 10 assertions against actual temporary directories. Bun execution and Windows ACL behavior remain unverified.

## Drift, compatibility and rollback

Rebase assertions onto current create/assert helper signatures. Do not follow/chmod the symlink target to make the test pass. A change to ancestor trust requires the separate TG-054 design.

Apply using the individual format-patch or cherry-pick this commit from the included Git bundle. On conflict, use these semantic notes and the test acceptance criteria; do not resolve by discarding tests or disabling compiler/lint rules. Roll back this commit with git revert only after checking whether a later selected patch depends on it.

## Residual gaps

Read the linked findings and the pending ledger. A new test file is not a measured coverage increase; no canonical runtime test pass is claimed until it is executed in the target repository.
