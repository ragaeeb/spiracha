# PATCH-15 — Strict runtime environment for app subprocess fixtures

Commit: `0ca65aecc1a247c5adf4634a294c8efa87d239d8`

Findings: [TG-005](../LEDGER.md#tg-005)

Prerequisites: **None among the code patches; independently selectable from the supplied baseline.**

## Why this change

Existing smoke app environment spread the developer environment and could discover unrelated files/credentials.

## Files

- `src/lib/isolated-runtime-test-helpers.test.ts`
- `src/lib/isolated-runtime-test-helpers.ts`
- `src/package-smoke.test.ts`
- `src/package-smoke.ts`

## Implementation details

Introduce buildIsolatedRuntimeEnv with explicit launch-variable allowlist and all documented source paths under a validated fixture root. Strip auth/proxy/preload settings. Reuse it in package-smoke while preserving explicit PORT and fixture DB. Add direct tests for path containment and dropped sentinel secrets.

## Acceptance checks

- **TG-005** — Secret/proxy/preload sentinels are absent; all controlled data paths lie beneath the fixture root; source DB override remains explicit.

## Targeted canonical commands

Run from the repository root after installing the project toolchain. Prefix with `rtk` where available, as requested by AGENTS.md. These commands were **not successfully executed in this environment**.

```bash
bun test src/lib/isolated-runtime-test-helpers.test.ts src/package-smoke.test.ts
bun run test:package
```

For browser patches, first complete the optional root dependency/lock installation in `testing/e2e/README.md`. Full acceptance also requires the root lint, typecheck, unit/UI, coverage, build and package checks listed in the handoff.

## Evidence actually obtained

Independent Node isolation/live-URL group passed 59 combined assertions. The helper passed the limited semantic typecheck. Actual package smoke is blocked by toolchain and missing original bin/spiracha.ts.

## Drift, compatibility and rollback

Update SOURCE_PATHS for any newly documented source overrides; keep a whitelist, not a blacklist. Upstream existing environment helpers can absorb these assertions. PATCH-16 depends on this export. The helper intentionally does not create directories.

Apply using the individual format-patch or cherry-pick this commit from the included Git bundle. On conflict, use these semantic notes and the test acceptance criteria; do not resolve by discarding tests or disabling compiler/lint rules. Roll back this commit with git revert only after checking whether a later selected patch depends on it.

## Residual gaps

Read the linked findings and the pending ledger. A new test file is not a measured coverage increase; no canonical runtime test pass is claimed until it is executed in the target repository.
