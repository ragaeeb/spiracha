# PATCH-13 — Loopback live URL contract tests

Commit: `424c8444518962b66ad8a3524ab6f63f8a6d64fa`

Findings: [TG-036](../LEDGER.md#tg-036)

Prerequisites: **None among the code patches; independently selectable from the supplied baseline.**

## Why this change

URL generation had indirect coverage but no dedicated alias/protocol/encoding matrix.

## Files

- `src/ui/lib/codex-thread-live-url.vitest.ts`

## Implementation details

Add a Vitest suite for IPv4/localhost/IPv6, scheme and port, encoded special/Unicode IDs, stale query/hash clearing and empty/readonly input. Production code is unchanged.

## Acceptance checks

- **TG-036** — Generated URLs round-trip parameters without altering the supplied IDs.

## Targeted canonical commands

Run from the repository root after installing the project toolchain. Prefix with `rtk` where available, as requested by AGENTS.md. These commands were **not successfully executed in this environment**.

```bash
bunx vitest run --config vitest.config.ts src/ui/lib/codex-thread-live-url.vitest.ts
```

For browser patches, first complete the optional root dependency/lock installation in `testing/e2e/README.md`. Full acceptance also requires the root lint, typecheck, unit/UI, coverage, build and package checks listed in the handoff.

## Evidence actually obtained

Independent Node isolation/live-URL group passed 59 combined assertions; limited TS subset includes this production module. Vitest unexecuted.

## Drift, compatibility and rollback

Adapt current builder parameter names while preserving exact URL semantics. Origin authorization is a separate helper and must not be bypassed to accommodate a URL test.

Apply using the individual format-patch or cherry-pick this commit from the included Git bundle. On conflict, use these semantic notes and the test acceptance criteria; do not resolve by discarding tests or disabling compiler/lint rules. Roll back this commit with git revert only after checking whether a later selected patch depends on it.

## Residual gaps

Read the linked findings and the pending ledger. A new test file is not a measured coverage increase; no canonical runtime test pass is claimed until it is executed in the target repository.
