# PATCH-17 — Compiled payload in browser and module Worker

Commit: `666e85119ad5686d06294bcba33dd3d06a9d8263`

Findings: [TG-029](../LEDGER.md#tg-029)

Prerequisites: PATCH-15, PATCH-16

## Why this change

Existing compiled package portability tests cover Bun and Node, not real browser and module Worker globals/module resolution.

## Files

- `testing/e2e/README.md`
- `testing/e2e/payload-portability.e2e.ts`

## Implementation details

Add 12 fixture-driven browser tests importing actual dist/payload JavaScript. Serve only contained .js files from the compiled graph. Use a tiny separate HTML page to prevent app bundles polluting globals; compare window and module Worker conversions and assert Bun/Buffer/process absent. Terminate workers/revoke object URLs even on failure.

## Acceptance checks

- **TG-029** — Every compiled fixture converts in both browser contexts without runtime shims.

## Targeted canonical commands

Run from the repository root after installing the project toolchain. Prefix with `rtk` where available, as requested by AGENTS.md. These commands were **not successfully executed in this environment**.

```bash
bun run build:payload
bunx playwright test --config testing/e2e/playwright.config.ts testing/e2e/payload-portability.e2e.ts
```

For browser patches, first complete the optional root dependency/lock installation in `testing/e2e/README.md`. Full acceptance also requires the root lint, typecheck, unit/UI, coverage, build and package checks listed in the handoff.

## Evidence actually obtained

Browser/Worker execution unrun. The independent Node group passed 73 payload assertions on source-transpiled production modules, which is useful but NOT compiled browser/package portability evidence.

## Drift, compatibility and rollback

Requires PATCH-16, which requires PATCH-15. Keep imports pointed at dist rather than source; confirm source fixtures still cover the 12 portable sources. A real Cloudflare consumer remains TG-071.

Apply using the individual format-patch or cherry-pick this commit from the included Git bundle. On conflict, use these semantic notes and the test acceptance criteria; do not resolve by discarding tests or disabling compiler/lint rules. Roll back this commit with git revert only after checking whether a later selected patch depends on it.

## Residual gaps

Read the linked findings and the pending ledger. A new test file is not a measured coverage increase; no canonical runtime test pass is claimed until it is executed in the target repository.
