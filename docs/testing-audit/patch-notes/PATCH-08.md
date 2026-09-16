# PATCH-08 — Exact normalized Markdown contracts

Commit: `c8fbf25d9d50e2b9c64bfbc03c5437779829f88b`

Findings: [TG-019](../LEDGER.md#tg-019)

Prerequisites: **None among the code patches; independently selectable from the supplied baseline.**

## Why this change

Portable normalized Markdown was exercised transitively but lacked an adjacent isolated exact-output suite.

## Files

- `src/lib/conversation-data/markdown.test.ts`

## Implementation details

Assert whole Markdown strings for role/title/newline/model behavior and selector semantics. Include Unicode, literal code fences, immutable inputs, message order and the empty-message/no-message distinction. Do not replace byte-sensitive expectations with loose contains assertions.

## Acceptance checks

- **TG-019** — Exact Markdown output and unchanged input are asserted for all focused fixtures.

## Targeted canonical commands

Run from the repository root after installing the project toolchain. Prefix with `rtk` where available, as requested by AGENTS.md. These commands were **not successfully executed in this environment**.

```bash
bun test src/lib/conversation-data/markdown.test.ts src/lib/conversation-data/message-selector.test.ts
```

For browser patches, first complete the optional root dependency/lock installation in `testing/e2e/README.md`. Full acceptance also requires the root lint, typecheck, unit/UI, coverage, build and package checks listed in the handoff.

## Evidence actually obtained

Independent Node Markdown group passed 6 assertions and the production renderer passed the limited TS subset. Bun suite unexecuted.

## Drift, compatibility and rollback

Map fixtures to current ConversationDetail/Message types while retaining exact output. Upstream intentional formatting changes need a documented contract update, not blanket snapshot acceptance.

Apply using the individual format-patch or cherry-pick this commit from the included Git bundle. On conflict, use these semantic notes and the test acceptance criteria; do not resolve by discarding tests or disabling compiler/lint rules. Roll back this commit with git revert only after checking whether a later selected patch depends on it.

## Residual gaps

Read the linked findings and the pending ledger. A new test file is not a measured coverage increase; no canonical runtime test pass is claimed until it is executed in the target repository.
