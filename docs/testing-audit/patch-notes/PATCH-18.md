# PATCH-18 — Cursor encode/decode legal-boundary agreement

Commit: `bdbb2ed0edfadb5f1d897f0bd81e5f410e0ec48b`

Findings: [TG-016](../LEDGER.md#tg-016), [TG-017](../LEDGER.md#tg-017)

Prerequisites: **None among the code patches; independently selectable from the supplied baseline.**

## Why this change

Independent baseline checks reproduced generated cursor failures for long ASCII IDs, multibyte IDs and huge finite timestamps.

## Files

- `src/lib/conversation-data/pagination.cursor-roundtrip.test.ts`
- `src/lib/conversation-data/pagination.ts`

## Implementation details

Raise ID limit to API-supported 2048 characters and retain an encoded cap of 18000 for worst-case escaped JSON/base64. Normalize timestamps through a safe integer floor-or-zero function shared by sorting/encoding. Add round-trip/boundary/next-page regressions.

## Acceptance checks

- **TG-016** — Generated valid boundary cursors decode and paginate; ID length 2049 and encoded length 18001 reject.
- **TG-017** — Every emitted timestamp is decoder-valid and the generated cursor advances without losing the next row.

## Targeted canonical commands

Run from the repository root after installing the project toolchain. Prefix with `rtk` where available, as requested by AGENTS.md. These commands were **not successfully executed in this environment**.

```bash
bun test src/lib/conversation-data/pagination.test.ts src/lib/conversation-data/pagination.cursor-roundtrip.test.ts
```

For browser patches, first complete the optional root dependency/lock installation in `testing/e2e/README.md`. Full acceptance also requires the root lint, typecheck, unit/UI, coverage, build and package checks listed in the handoff.

## Evidence actually obtained

pagination-before.jsonl and pagination-after.jsonl capture three before/after cases. Independent Node pagination group passed 379 combined assertions; production module included in limited TS subset. Bun tests unexecuted.

## Drift, compatibility and rollback

Independent of PATCH-07. Align with the current API ID bound on drift rather than blindly keeping a magic number. Preserve a finite cap; review actual server/proxy URL limits and intentional ordering for corrupt timestamps.

Apply using the individual format-patch or cherry-pick this commit from the included Git bundle. On conflict, use these semantic notes and the test acceptance criteria; do not resolve by discarding tests or disabling compiler/lint rules. Roll back this commit with git revert only after checking whether a later selected patch depends on it.

## Residual gaps

Read the linked findings and the pending ledger. A new test file is not a measured coverage increase; no canonical runtime test pass is claimed until it is executed in the target repository.
