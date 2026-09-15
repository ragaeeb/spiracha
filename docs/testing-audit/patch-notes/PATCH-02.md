# PATCH-02 — Hostile-origin and loopback alias matrix

Commit: `798d9c04389391eaec50141dce67fdc0954505ee`

Findings: [TG-006](../LEDGER.md#tg-006)

Prerequisites: **None among the code patches; independently selectable from the supplied baseline.**

## Why this change

Security code already exists; the missing work is an explicit broad acceptance/rejection matrix, not a claimed new origin bypass.

## Files

- `src/lib/local-request-security.matrix.test.ts`

## Implementation details

Add an adjacent matrix suite covering opaque/malformed/cross-scheme/cross-port/userinfo/host-suffix origins, accepted loopback aliases and rejected hosts. Production code is unchanged.

## Acceptance checks

- **TG-006** — All hostile matrix entries deny and the intended three loopback spellings remain accepted.

## Targeted canonical commands

Run from the repository root after installing the project toolchain. Prefix with `rtk` where available, as requested by AGENTS.md. These commands were **not successfully executed in this environment**.

```bash
bun test src/lib/local-request-security.test.ts src/lib/local-request-security.matrix.test.ts
```

For browser patches, first complete the optional root dependency/lock installation in `testing/e2e/README.md`. Full acceptance also requires the root lint, typecheck, unit/UI, coverage, build and package checks listed in the handoff.

## Evidence actually obtained

The independent Node origin group passed 29 assertions. The new Bun suite itself was not run.

## Drift, compatibility and rollback

Keep the current same-user loopback policy. Port the matrix to current helper names and preserve allowed default-port normalization. Do not introduce CORS wildcard exceptions.

Apply using the individual format-patch or cherry-pick this commit from the included Git bundle. On conflict, use these semantic notes and the test acceptance criteria; do not resolve by discarding tests or disabling compiler/lint rules. Roll back this commit with git revert only after checking whether a later selected patch depends on it.

## Residual gaps

Read the linked findings and the pending ledger. A new test file is not a measured coverage increase; no canonical runtime test pass is claimed until it is executed in the target repository.
