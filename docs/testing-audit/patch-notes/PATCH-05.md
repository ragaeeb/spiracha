# PATCH-05 — API boundaries and fail-closed batch semantics

Commit: `c115a87e7e7c6baa56af63619a5fad04a1a3fad7`

Findings: [TG-007](../LEDGER.md#tg-007), [TG-008](../LEDGER.md#tg-008), [TG-009](../LEDGER.md#tg-009), [TG-014](../LEDGER.md#tg-014), [TG-030](../LEDGER.md#tg-030)

Prerequisites: **None among the code patches; independently selectable from the supplied baseline.**

## Why this change

Existing API coverage is extensive. Added assertions join important method, early-validation and error-shaping invariants into a focused adjacent suite.

## Files

- `src/lib/conversation-api.boundaries.test.ts`

## Implementation details

Table-test 11 Allow contracts and response safety headers. Verify invalid whole batches never mutate, length is capped before dedupe, normalization order is stable, mixed missing export is atomic, deletion cleanup errors remain visible, malformed UTF-8 never invokes conversion, and HTTP 500 bodies redact internal errors.

## Acceptance checks

- **TG-007** — No deletion call occurs for an invalid or oversized request; valid deduplicated IDs retain first-seen order.
- **TG-008** — API returns 404 and HTTP client returns null; no partial download is returned.
- **TG-009** — Every input has the expected result and cleanup failure remains visible in the response.
- **TG-014** — Malformed bytes never reach the converter and produce a client-facing validation error.
- **TG-030** — Every route publishes the intended method contract without invoking normal data work.

## Targeted canonical commands

Run from the repository root after installing the project toolchain. Prefix with `rtk` where available, as requested by AGENTS.md. These commands were **not successfully executed in this environment**.

```bash
bun test src/lib/conversation-api.test.ts src/lib/conversation-api.boundaries.test.ts
```

For browser patches, first complete the optional root dependency/lock installation in `testing/e2e/README.md`. Full acceptance also requires the root lint, typecheck, unit/UI, coverage, build and package checks listed in the handoff.

## Evidence actually obtained

Parse checks passed. Bun/API tests were not executed. The original payload chunked-size tests already exist and remain unchanged.

## Drift, compatibility and rollback

Keep current dependency injection and API error codes. Update route tables for upstream added routes instead of deleting failing entries. Avoid claiming logs are redacted merely because response bodies are generic.

Apply using the individual format-patch or cherry-pick this commit from the included Git bundle. On conflict, use these semantic notes and the test acceptance criteria; do not resolve by discarding tests or disabling compiler/lint rules. Roll back this commit with git revert only after checking whether a later selected patch depends on it.

## Residual gaps

Read the linked findings and the pending ledger. A new test file is not a measured coverage increase; no canonical runtime test pass is claimed until it is executed in the target repository.
