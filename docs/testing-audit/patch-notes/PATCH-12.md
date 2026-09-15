# PATCH-12 — Import preparation extraction and partial read success

Commit: `afea335bb34aabeab30fea5d0446dd67c3928e5a`

Findings: [TG-020](../LEDGER.md#tg-020), [TG-021](../LEDGER.md#tg-021)

Prerequisites: **None among the code patches; independently selectable from the supplied baseline.**

## Why this change

Route-local preparation was excluded from coverage and one File.text rejection rejected the entire Promise.all.

## Files

- `src/ui/lib/web-chat-import.ts`
- `src/ui/lib/web-chat-import.vitest.ts`
- `src/ui/lib/web-chat-limits.ts`
- `src/ui/lib/web-chat-server.ts`
- `src/ui/routes/web.index.tsx`

## Implementation details

Move shared constants into a browser-safe limits module; keep server re-exports for compatibility. Extract readImportFiles/dedupeImportErrors and use them from the handwritten Web route. Catch per-file read failures, preserve valid files and deterministic order, and preflight count/total before any reads.

## Acceptance checks

- **TG-020** — Invalid aggregate/count selections do not call text(); per-file errors preserve readable valid files and input order.
- **TG-021** — One read rejection yields one error while other readable files continue into the import payload.

## Targeted canonical commands

Run from the repository root after installing the project toolchain. Prefix with `rtk` where available, as requested by AGENTS.md. These commands were **not successfully executed in this environment**.

```bash
bunx vitest run --config vitest.config.ts src/ui/lib/web-chat-import.vitest.ts src/ui/lib/web-chat-server.vitest.ts
```

For browser patches, first complete the optional root dependency/lock installation in `testing/e2e/README.md`. Full acceptance also requires the root lint, typecheck, unit/UI, coverage, build and package checks listed in the handoff.

## Evidence actually obtained

Independent Node import group passed 10 assertions against the real helper. The eight-module typecheck includes limits, not the import helper’s transitive Bun-dependent graph. Vitest and full project typecheck remain unrun.

## Drift, compatibility and rollback

Do not edit routeTree.gen.ts. Keep limits synchronized via the shared module and preserve user-facing size messages. Review any upstream route changes so partial errors still stay on the list page rather than silently navigating.

Apply using the individual format-patch or cherry-pick this commit from the included Git bundle. On conflict, use these semantic notes and the test acceptance criteria; do not resolve by discarding tests or disabling compiler/lint rules. Roll back this commit with git revert only after checking whether a later selected patch depends on it.

## Residual gaps

Read the linked findings and the pending ledger. A new test file is not a measured coverage increase; no canonical runtime test pass is claimed until it is executed in the target repository.
