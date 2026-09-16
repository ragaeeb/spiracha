# PATCH-06 — Cache invalidation generation and boundary regressions

Commit: `6a2632c994d307a189197369a97c2514ab94e2b3`

Findings: [TG-004](../LEDGER.md#tg-004), [TG-034](../LEDGER.md#tg-034)

Prerequisites: **None among the code patches; independently selectable from the supplied baseline.**

## Why this change

A real-file/barrier baseline run showed a read issued after invalidation joining an older in-flight promise and returning stale data.

## Files

- `src/lib/bounded-file-cache.boundaries.test.ts`
- `src/lib/bounded-file-cache.ts`

## Implementation details

Add invalidationGeneration to the in-flight key. Test both per-path/global invalidation with a deterministic old-load barrier, new-read completion and finally cleanup; timeout is only a failure bound. Extend rejection/null retry, missing/directory, parser salt, atomic rename and budget contracts.

## Acceptance checks

- **TG-004** — New get returns fresh data before old load is released; old work cannot seed the current cache.
- **TG-034** — Failed loads do not poison later reads and changed file identities do not return stale content.

## Targeted canonical commands

Run from the repository root after installing the project toolchain. Prefix with `rtk` where available, as requested by AGENTS.md. These commands were **not successfully executed in this environment**.

```bash
bun test src/lib/bounded-file-cache.test.ts src/lib/bounded-file-cache.boundaries.test.ts
```

For browser patches, first complete the optional root dependency/lock installation in `testing/e2e/README.md`. Full acceptance also requires the root lint, typecheck, unit/UI, coverage, build and package checks listed in the handoff.

## Evidence actually obtained

cache-before.jsonl reproduces stale reuse; cache-after.jsonl records fresh completion before old release. Independent Node cache group passed 22 assertions; limited TS semantic subset includes the production cache.

## Drift, compatibility and rollback

Preserve upstream generation/eviction logic and change only the in-flight identity needed to separate invalidated work. Never loosen the regression to wait for the old load before making the fresh call.

Apply using the individual format-patch or cherry-pick this commit from the included Git bundle. On conflict, use these semantic notes and the test acceptance criteria; do not resolve by discarding tests or disabling compiler/lint rules. Roll back this commit with git revert only after checking whether a later selected patch depends on it.

## Residual gaps

Read the linked findings and the pending ledger. A new test file is not a measured coverage increase; no canonical runtime test pass is claimed until it is executed in the target repository.
