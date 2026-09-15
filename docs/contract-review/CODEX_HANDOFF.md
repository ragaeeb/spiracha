# Codex handoff: source-adapter contracts

## Start here

The user requested a granular implementation plan, regression tests, and a few foundational contracts for the attached 2.9.0 archive—not a claim that the entire parity migration has already shipped. This tree contains that seed implementation plus the complete target specification/work packages/test matrix. **Implement the remaining plan; do not mark full parity complete from this packet.**

Read in this order:

1. `AGENTS.md` and `README.md` for repository conventions and current behavior.
2. `docs/contract-review/FINDINGS.md` for the reconciled archive audit and source evidence.
3. `docs/source-adapter-contract.md` for target capability, handler, canonical transcript, export, raw, mutation, UI, API and surface contracts.
4. `docs/contract-review/IMPLEMENTATION_PLAN.md` for ordered work packages, dependencies, source/file migration ledger and retirement criteria.
5. `docs/contract-review/TEST_MATRIX.md` for granular independent test cases, native fixtures, source/browser journeys and expected outcomes.
6. `docs/contract-review/VERIFICATION.md` for actual execution results and limits.
7. `docs/contract-review/original-requested-plan.md` to recheck every original acceptance item before closing the work.

All document paths above are repository-relative. The delivery also contains a standalone patch and input/change checksums outside this source tree.

## What changed in the seed

**Identity and omission gates:** `source-catalog.ts` now owns source label/scope/routes/export aliases/navigation order. All 13 adapters preserve their source literals with `satisfies ConversationAdapter<'id'>`; `ConversationAdapterRegistry` is exhaustive instead of Partial. Missing adapters no longer silently succeed as empty lists. Source metadata, deep links, reference-route resolution and sidebar identity derive from the catalog. `source-icons.ts` is exhaustive. The native payload parser map is exhaustive over its existing supported type; Claude Code/Command Code remain excluded from payload parsing.

**Type foundation:** `capability.ts` defines the supported/unsupported/not_applicable union and conditional handler pattern. `src/type-tests/source-contracts.ts` contains ten negative fixtures (route/source/adapter/parser omissions, key mismatch, missing reason and invalid handler states), plus positives. This is not yet production capability enforcement; optional raw/delete adapter methods and the old raw allowlists still remain until the full migration.

**Raw transport:** HTTP and UI now use sanitized native filenames/extensions. ZIP collision suffixes precede the native extension and protect case/NFC/full-filename collisions. Single UI raw download uses a base64 transport decoded to a byte Blob rather than Blob.text(); larger single/raw batches use the existing ZIP lifecycle. Focused raw detail export uses this shared path instead of constructing a `.json` URL/download name independently. The generic normalized renderer was not changed.

**Tests:** new catalog/actual-route, raw transport/name and real ZIP/production download tests; updated HTTP/native-name and UI raw expectations; two Blob lifecycle regressions; a supplemental offline portable compiler/runtime checker. See the verification file before treating any suite as executed.

## What did not change

No source data, deletion algorithm, storage location, live application process, source normalizer, payload artifact parser, generated route tree, dependency declaration, lockfile or package version was changed. Existing normalized defaults and source membership remain. No source was newly declared unsupported to hide an unfinished feature. The target specification proposes a future major hard cut; the seed stays at 2.9.0.

The full target capability matrix, common action controller, normalized options/renderer, settled mutation DTO, Qoder safe deletion, Command Code mutation hardening, Cursor/FX raw native asset collections, complete runtime errors, Web/Cloud actions and exhaustive native/browser conformance are **remaining implementation**, not partially hidden runtime features.

## Reconciliation facts that matter

The attachment has no `.git`, `.github`, or `bin/spiracha.ts`, despite the package declaring a CLI entrypoint and package smoke. The older plan's upstream commit cannot be verified here. The supplied review patch was generated against a synthetic Git baseline of the archive. On the real checkout, record HEAD/dirty files and reconcile before applying it. Restore the real CLI/CI files from the repository, not by guessing their implementation from README.

**Command Code already has table selection, row/batch/detail export and deletion in the archive.** Preserve that work. Remaining work is shared composition, semantic/export parity, robust sidecar/replica ownership and partial/restart-safe mutation reporting. Do not recreate old missing controls.

**Qoder deletion remains an applicable gap.** Its shared ItemTable history/task structures, aliases, state and CLI files require the specified strict ownership planner and durable transaction/cleanup flow. Do not delete a shared key/task/database to remove one selected conversation. Native schema variants and stopped-writer proof receive explicit fixture gates before enabling writes; a blanket unsupported/read-only exception is not a solution.

**Original raw is not reconstructed JSON.** Cursor has native agent JSONL discovery; FX has checkpoint/event/tool-file assets; target raw support exports those native files, not joined model objects. OpenCode's shared relational representation gets an evidence-backed original-file exception, not a whole database export. Resource absence on otherwise supported sources is separate. The seed implements byte/name fidelity for existing single-Blob sources, not these new native-file collections.

**Web and Cloud are surfaces, not source IDs.** Web stays in bounded memory with in-memory remove/export/selection and exact artifacts; no persistence/external deletion. Cloud stays authenticated/read-only, with common batch read export and explicit unsupported mutation/raw policy. Provider labels do not become storage sources.

## Next implementation sequence

Begin with REC-01: reconcile the real checkout and run the seed gates in the supported environment. Fix any actual integration/lint/type issue discovered there before relying on the seed. Do not claim the offline subset checked the full module graph.

Then implement REG-01/02 and SEM-01: exhaustive fixture/action/binding requirements, full capability state enforcement and canonical semantic types/projection. Add real parser fixture goldens before SEM-02 source migration. Bind common operations once rather than requiring each source to create a new renderer/ZIP implementation.

Implement EXP-01/02 and RAW-01 against those native goldens. Preserve exact strings/bytes, independent role/phase flags, selectors before filters, full available bodies, artifact independence, explicit atomic/partial batch policy and cleanup/cancellation bounds. Retire duplicated generic source renderers when callers migrate; no parallel compatibility pipeline remains in the final release.

Implement MUT-01/02 and MUT-QD-01/02 with isolated source stores. Preserve existing Codex/Cursor/Grok Bot journals and OpenCode cleanup/recovery. Settled results must retain already completed changes and actionable receipt state even when a later item/phase throws. Run failure/crash/replay and sibling/worktree tests before UI exposure.

Implement UI-01, SUR-01 and API-01, then GATE-01. Migrate every list/detail surface, keep specialized columns/trees/deferred/recovery panels, add global Grok Bot actions, test actual packaged APIs/CLI and real downloads/mutations. Full closure requires the per-source browser ledger, not just component rendering.

The detailed work packages contain file paths and individual exit criteria; the target document contains exact field/default/error/ownership/selection semantics. Resolve unknown native schema ownership through the specified fixtures and fail-closed runtime conflicts—not by inventing a production capability exception.

## Tests to run first

With the project's supported Bun and dependencies installed:

```sh
rtk bun test src/lib/conversation-data/source-catalog.test.ts src/lib/raw-export-contract.test.ts src/lib/raw-export-integration.test.ts src/lib/conversation-api.test.ts
rtk bun run typecheck
rtk bun run test:ui
rtk bun run lint
```

Use the standard complete gate set before integration/release:

```sh
rtk bun run lint
rtk bun run typecheck
rtk bun test
rtk bun run test:ui
rtk bun run build
rtk bun run test:package
rtk bun run coverage
rtk git diff --check
```

The plan adds `test:conformance` and `test:e2e`; those scripts are not present in the seed. Do not invoke imaginary existing scripts and report them passing. Root and UI line coverage must each meet the existing 90% gates after the actual complete suites run.

Optional supplemental check in an environment with Node and an installed TypeScript binary:

```sh
TSC_BIN="$(command -v tsc)" node testing/verify-portable-contracts.mjs
```

This is deliberately not the main Bun workflow. It was used because this environment lacks Bun/rtk/dependencies, and its output does not establish project-wide type correctness.

## Actual verification at delivery

Passed: portable-subset compilation under available TypeScript 5.8.3 including ten negative compiler fixtures; all 13 actual inventory/detail route paths and legal encoded-ID checks; invalid UTF-8/NUL/CRLF/empty base64-to-Blob fidelity; native filename/collision assertions. A syntax-only transpilation check parsed all 37 changed/new TypeScript files without syntax errors. Direct `git diff --check` passed; the final packet also verifies its patch against a clean extraction.

Blocked/not run: repository lint, declared full typecheck, Bun root tests, UI tests, build, package smoke, coverage and all source/browser journeys. `rtk` and Bun are absent; dependencies are not installed. Direct project `tsc --noEmit` fails before a meaningful project check because bun/node/vite type libraries are absent. The available compiler is not the declared project compiler. Packaging additionally needs the CLI file absent from the attachment. No 90% coverage claim is made. Logs are under `docs/contract-review/verification/`.

## Safety and release checklist

Do not run destructive acceptance against default/personal source stores. Require explicit temporary paths and checkout/sibling sentinels. Do not kill external applications, fabricate writer-lock guarantees, reuse tolerant parsing as ownership proof, or discard pending receipts to make UI errors disappear. No real conversations were deleted while preparing the seed.

No legacy commands/MCP/plugin bridges, exported compatibility aliases, optional applicable callbacks, duplicate generic normalizers/renderers, production rule suppressions, fake exception reasons, skipped source fixtures, or `remaining sources later` closeout. Record actual results and native limitations; pending runtime ownership conflicts must not hide ordinary supported fixture deletion. Preserve routes and generate the route tree normally.

The full migration is complete only when every applicable operation has real source/common/UI bindings, reviewed exceptions have behavioral evidence, all public callers agree on semantic/export/error contracts, full bodies and artifact/raw identities survive, settled deletion/recovery is safe, every registered source's real fixture journey passes, and the complete gate set passes with root/UI coverage. Reread the original attached issue and user's request before marking completion.
