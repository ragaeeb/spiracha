# PATCH-11 — Live route ceilings, signal propagation and test isolation

Commit: `94adca182f4a202fe7cc4c61a208e50a6e7df32e`

Findings: [TG-023](../LEDGER.md#tg-023), [TG-024](../LEDGER.md#tg-024)

Prerequisites: **None among the code patches; independently selectable from the supplied baseline.**

## Why this change

The live route already has an indirect Vitest suite. The addition extends that suite and fixes its environment/mock determinism.

## Files

- `src/ui/lib/codex-thread-events-route.vitest.ts`

## Implementation details

Reset mocks/default implementations and explicitly stub/restore SPIRACHA_CODEX_DB. Assert 65 unique IDs deny, 64 and duplicates succeed with trim/dedupe, denied Origin performs no storage I/O, explicit DB override wins, and the incoming signal reaches the stream factory.

## Acceptance checks

- **TG-023** — Limits apply to unique normalized IDs and denied-origin requests do not open storage.
- **TG-024** — Each case is independent of prior implementation overrides and user database configuration.

## Targeted canonical commands

Run from the repository root after installing the project toolchain. Prefix with `rtk` where available, as requested by AGENTS.md. These commands were **not successfully executed in this environment**.

```bash
bunx vitest run --config vitest.config.ts src/ui/lib/codex-thread-events-route.vitest.ts
```

For browser patches, first complete the optional root dependency/lock installation in `testing/e2e/README.md`. Full acceptance also requires the root lint, typecheck, unit/UI, coverage, build and package checks listed in the handoff.

## Evidence actually obtained

Syntax checked; Vitest/route execution blocked. Signal-forwarding assertions are not evidence of actual socket-resource cleanup.

## Drift, compatibility and rollback

Extend current route test rather than creating a second competing mock graph. Preserve current dynamic import/module mocking conventions and environment restoration across cases.

Apply using the individual format-patch or cherry-pick this commit from the included Git bundle. On conflict, use these semantic notes and the test acceptance criteria; do not resolve by discarding tests or disabling compiler/lint rules. Roll back this commit with git revert only after checking whether a later selected patch depends on it.

## Residual gaps

Read the linked findings and the pending ledger. A new test file is not a measured coverage increase; no canonical runtime test pass is claimed until it is executed in the target repository.
