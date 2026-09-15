# PATCH-16 — Isolated compiled-app browser workflow harness

Commit: `7f32f5ca330830ce0065612429fc0dcce8687876`

Findings: [TG-025](../LEDGER.md#tg-025), [TG-026](../LEDGER.md#tg-026), [TG-027](../LEDGER.md#tg-027), [TG-028](../LEDGER.md#tg-028)

Prerequisites: PATCH-15

## Why this change

No browser harness exists in the archive. jsdom cannot establish compiled route/server/download behavior.

## Files

- `testing/e2e/README.md`
- `testing/e2e/app-server.ts`
- `testing/e2e/codex-export.e2e.ts`
- `testing/e2e/fixtures.ts`
- `testing/e2e/playwright.config.ts`
- `testing/e2e/server.ts`
- `testing/e2e/tsconfig.json`
- `testing/e2e/web-import.e2e.ts`

## Implementation details

Add optional Playwright config with absolute root/cwd, single worker, no retries, unique fixture server, reuseExistingServer=false and SIGTERM cleanup. Seed Codex fixtures; spawn the real compiled production UI server under the strict isolated environment. Browser tests cover import/reload/metadata, mixed parse failure, exact artifact bytes, native export, delete cancel and hostile Origin. Use .e2e.ts to avoid Bun autodiscovery.

## Acceptance checks

- **TG-025** — Run the compiled app in Chromium using only fixture histories and observe the complete journey.
- **TG-026** — The browser download equals the fixture exactly, not merely a substring.
- **TG-027** — Compiled UI and actual fixture storage produce a readable Markdown download.
- **TG-028** — Both journeys leave the original conversation unchanged.

## Targeted canonical commands

Run from the repository root after installing the project toolchain. Prefix with `rtk` where available, as requested by AGENTS.md. These commands were **not successfully executed in this environment**.

```bash
bunx tsc --noEmit --project testing/e2e/tsconfig.json
bun run build
bunx playwright test --config testing/e2e/playwright.config.ts
```

For browser patches, first complete the optional root dependency/lock installation in `testing/e2e/README.md`. Full acceptance also requires the root lint, typecheck, unit/UI, coverage, build and package checks listed in the handoff.

## Evidence actually obtained

Browser config/spec syntax was checked; no browser was installed or launched. @playwright/test was intentionally not added to package.json/bun.lock offline. Read testing/e2e/README.md for root dependency resolution and browser install.

## Drift, compatibility and rollback

Requires PATCH-15 first. Keep startup fixture environment before app imports, loopback-only requests and safe teardown. On selector drift inspect actual accessible labels; never replace real storage/app with mocks or reuse an existing developer server.

Apply using the individual format-patch or cherry-pick this commit from the included Git bundle. On conflict, use these semantic notes and the test acceptance criteria; do not resolve by discarding tests or disabling compiler/lint rules. Roll back this commit with git revert only after checking whether a later selected patch depends on it.

## Residual gaps

Read the linked findings and the pending ledger. A new test file is not a measured coverage increase; no canonical runtime test pass is claimed until it is executed in the target repository.
