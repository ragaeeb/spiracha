# PATCH-04 — HTTP client envelopes, error codes and download contracts

Commit: `212405267abb617580aa1279c6a37ab306f97e88`

Findings: [TG-012](../LEDGER.md#tg-012), [TG-013](../LEDGER.md#tg-013), [TG-031](../LEDGER.md#tg-031), [TG-032](../LEDGER.md#tg-032)

Prerequisites: **None among the code patches; independently selectable from the supplied baseline.**

## Why this change

The client cast arbitrary JSON envelopes and did not require ZIP MIME. Additional tests cover stable domain errors and filename/byte behavior across methods.

## Files

- `src/client.http-boundaries.test.ts`
- `src/client.ts`

## Implementation details

Validate top-level JSON objects; reject null/missing data; require normalized application/zip. Test through real ephemeral Bun.serve responses rather than patching global fetch. Each fixture stops its server even when assertions fail.

## Acceptance checks

- **TG-012** — Malformed success responses reject with SpirachaClientError; ordinary well-formed responses remain compatible.
- **TG-013** — Wrong MIME responses reject before returning an archive blob.
- **TG-031** — Domain absence returns null where documented; route/method failures stay typed exceptions.
- **TG-032** — UTF-8 filenames and raw bytes survive; invalid encodings use a safe fallback; URL prefix is retained.

## Targeted canonical commands

Run from the repository root after installing the project toolchain. Prefix with `rtk` where available, as requested by AGENTS.md. These commands were **not successfully executed in this environment**.

```bash
bun test src/client.test.ts src/client.http-boundaries.test.ts
```

For browser patches, first complete the optional root dependency/lock installation in `testing/e2e/README.md`. Full acceptance also requires the root lint, typecheck, unit/UI, coverage, build and package checks listed in the handoff.

## Evidence actually obtained

Source syntax was checked, but client tests could not execute without Bun/SQLite/fflate and installed dependencies. Do not interpret this as a passing HTTP integration run.

## Drift, compatibility and rollback

Locate readJsonEnvelope, requireData and fetchZipOrNull. Preserve typed conversation_not_found/unsupported domain behavior and deployment prefixes. MIME strictness is intentional; nested DTO validation remains TG-052.

Apply using the individual format-patch or cherry-pick this commit from the included Git bundle. On conflict, use these semantic notes and the test acceptance criteria; do not resolve by discarding tests or disabling compiler/lint rules. Roll back this commit with git revert only after checking whether a later selected patch depends on it.

## Residual gaps

Read the linked findings and the pending ledger. A new test file is not a measured coverage increase; no canonical runtime test pass is claimed until it is executed in the target repository.
