# PATCH-14 — Fixture-backed public SDK to API to storage integration

Commit: `3b8ed0fa89bec037f1ab07bd24a5b4de0f477d15`

Findings: [TG-008](../LEDGER.md#tg-008), [TG-010](../LEDGER.md#tg-010), [TG-011](../LEDGER.md#tg-011)

Prerequisites: **None among the code patches; independently selectable from the supplied baseline.**

## Why this change

Mocked seam tests do not prove actual SDK/API/SQLite/rollout behavior agrees.

## Files

- `src/client.storage-integration.test.ts`

## Implementation details

Use createCodexBrowserFixture and real production registry functions with explicit codexDbPath. Start Bun.serve on loopback port 0; compare local/HTTP list pages, three selectors, raw bytes and ZIP contents. No deletion is performed; always stop server/remove fixture.

## Acceptance checks

- **TG-008** — API returns 404 and HTTP client returns null; no partial download is returned.
- **TG-010** — Local and HTTP results match across multiple pages and selectors; server and fixture are always removed.
- **TG-011** — Every original byte is preserved through API and public HTTP SDK.

## Targeted canonical commands

Run from the repository root after installing the project toolchain. Prefix with `rtk` where available, as requested by AGENTS.md. These commands were **not successfully executed in this environment**.

```bash
bun test src/client.storage-integration.test.ts
```

For browser patches, first complete the optional root dependency/lock installation in `testing/e2e/README.md`. Full acceptance also requires the root lint, typecheck, unit/UI, coverage, build and package checks listed in the handoff.

## Evidence actually obtained

Source syntax checked only. This integration requires Bun SQLite/fflate and was not executed. Assertions compare real paths rather than claiming a simulated integration passed.

## Drift, compatibility and rollback

Preserve actual registry calls rather than replacing them with static DTO mocks. Update fixture field names on drift. Add new source coverage via TG-043 instead of overstating this Codex-only test.

Apply using the individual format-patch or cherry-pick this commit from the included Git bundle. On conflict, use these semantic notes and the test acceptance criteria; do not resolve by discarding tests or disabling compiler/lint rules. Roll back this commit with git revert only after checking whether a later selected patch depends on it.

## Residual gaps

Read the linked findings and the pending ledger. A new test file is not a measured coverage increase; no canonical runtime test pass is claimed until it is executed in the target repository.
