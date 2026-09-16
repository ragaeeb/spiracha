# PATCH-07 — Deterministic keyset traversal invariants

Commit: `c0c1b2c84e7d2eadc0f9ef9e4face6511d814048`

Findings: [TG-033](../LEDGER.md#tg-033)

Prerequisites: **None among the code patches; independently selectable from the supplied baseline.**

## Why this change

Small pagination examples leave ties, many page widths and removal-between-pages insufficiently locked down.

## Files

- `src/lib/conversation-data/pagination.boundaries.test.ts`

## Implementation details

Create a deterministic 97-record multi-source dataset and traverse with six page widths. Assert stable total order, no duplicates/omissions/mutation, exact final metadata, removed-cursor behavior and malformed limits/tuples. This patch changes tests only and is independent of the cursor production fix.

## Acceptance checks

- **TG-033** — Concatenated pages equal the intended stable order exactly and terminate with correct metadata.

## Targeted canonical commands

Run from the repository root after installing the project toolchain. Prefix with `rtk` where available, as requested by AGENTS.md. These commands were **not successfully executed in this environment**.

```bash
bun test src/lib/conversation-data/pagination.test.ts src/lib/conversation-data/pagination.boundaries.test.ts
```

For browser patches, first complete the optional root dependency/lock installation in `testing/e2e/README.md`. Full acceptance also requires the root lint, typecheck, unit/UI, coverage, build and package checks listed in the handoff.

## Evidence actually obtained

The Node pagination group, including later cursor invariants, passed 379 assertions; the production module passed the limited semantic typecheck. Canonical Bun suite not run.

## Drift, compatibility and rollback

Adapt source registration dynamically using CONVERSATION_SOURCES.length. Keep the stable comparator/removed-anchor expectations explicit if upstream changes pagination contracts.

Apply using the individual format-patch or cherry-pick this commit from the included Git bundle. On conflict, use these semantic notes and the test acceptance criteria; do not resolve by discarding tests or disabling compiler/lint rules. Roll back this commit with git revert only after checking whether a later selected patch depends on it.

## Residual gaps

Read the linked findings and the pending ledger. A new test file is not a measured coverage increase; no canonical runtime test pass is claimed until it is executed in the target repository.
