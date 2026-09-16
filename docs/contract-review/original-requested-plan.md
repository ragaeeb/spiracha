# Enforce source-adapter parity across navigation, actions, transcript semantics, and exports

## Problem and required outcome

Adding a source currently compiles even when the user cannot select multiple conversations, export them, or delete them. Command Code demonstrated this: its initial adapter supplied list/detail/raw access, while the committed UI omitted export and selection and the adapter omitted deletion. The fix is an enforced end-to-end contract, not another optional checklist or a larger interface that routes can ignore.

Implement exhaustive source registration, explicit supported/unsupported/not-applicable capabilities, common UI action wiring, one portable transcript/export contract, and a conformance suite that automatically exercises every registered source. A future source must fail typechecking or tests until its full applicable user journey is implemented.

This issue covers all existing integrations, not just Command Code. Complete the migration and delete superseded paths; do not leave shims, bridge exports, compatibility aliases, rule suppressions, or a second normalization/export pipeline behind.

## Audit baseline and limits

Static source audit on 2026-09-14 at commit `33b061ebca818b2b1773795ce9eb42ef9395dfc0`. Citations below are pinned to that commit. Recheck current HEAD before implementing. The checkout also contained concurrent, uncommitted Command Code export/selection changes, with deletion work appearing during the audit. Those changes were not modified or treated as completed work. Do not overwrite/reimplement them; first reconcile their final state.

This is a source/contract audit, not proof that every platform has passed live UI or destructive integration testing. No real conversations were deleted. The implementation must supply the behavioral evidence described below.

### Current surface inventory

`Yes` means wiring exists in the audited source; it does not establish semantic parity or passing end-to-end tests. Workspace removal is distinct from deleting every visible conversation. An absent operation is a gap to resolve, not automatically an approved platform limitation.

| Surface | Session detail export | Conversation-list selection / batch export | Session deletion in UI / adapter | Original raw adapter | Workspace removal UI |
| --- | --- | --- | --- | --- | --- |
| Codex local | Yes | Yes | Yes / Yes | Yes | Yes |
| Claude Code | Yes | Yes | Yes / Yes | Yes | Absent |
| Command Code | Absent at baseline; concurrent fix | Absent at baseline; concurrent fix | Absent / Absent at baseline; concurrent work | Yes | Absent |
| Cline | Yes | Yes | Yes / Yes | Yes | Absent |
| Grok | Yes | Yes | Yes / Yes | Yes | Absent |
| Grok Bot | Yes | Absent on global chat inventory | Yes / Yes | Yes | Not applicable: global source |
| Kiro | Yes | Yes | Yes / Yes | Yes | Absent |
| Qoder | Yes | Yes | Absent / Absent | Yes | Absent |
| Cursor | Yes | Yes | Yes / Yes | Absent | Yes |
| Antigravity | Yes | Yes | Yes / Yes | Yes | Absent |
| FX | Yes | Yes | Yes / Yes | Absent | Absent |
| MiniMax Code | Yes | Yes | Yes / Yes | Yes | Absent |
| OpenCode | Yes | Yes | Yes / Yes | Absent | Yes |
| Codex Cloud surface | Detail export | No common batch flow | Read-only | No common raw adapter | Not applicable to local workspace deletion |
| Web import surface | Transcript display/copy and artifact downloads; no common export dialog | No common batch flow | No common deletion flow | No stable storage adapter | Not applicable to local workspace deletion |

The last two are separate surfaces, not additions to `CONVERSATION_SOURCES`. Preserve Codex Cloud read-only behavior and Web's ephemeral UI store. Decide and document applicable in-memory Web export/selection/removal behavior; do not add persistence, external-account deletion, or storage-source membership merely for parity. Gemini, Meta/Muse, GLM, Qwen, Claude Web, and ChatGPT are Web payload providers, not local sources.

### Findings and code anchors

1. **The existing contract is too weak.** [ConversationAdapter](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/lib/conversation-data/types.ts#L276) has only required list/get and optional raw/delete; no UI, export, or explicit exception requirement. [ADAPTERS](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/lib/conversation-data/index.ts#L119) is `Partial<Record<...>>`; a missing adapter can silently become an empty list. [SourceInfo](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/lib/conversation-data/types.ts#L126) advertises only label/scope/source, so consumers cannot distinguish unsupported features from missing resources.
2. **Registration is distributed.** The source union, [labels/scopes](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/lib/conversation-data/index.ts#L77), [URL route mapping](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/lib/conversation-data/index.ts#L332), [sidebar](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/ui/components/app-shell.tsx#L37), [raw-source allowlist](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/ui/lib/source-raw-export-server.ts#L4), and [export-platform map](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/lib/ui-export-archive.ts#L20) each require manual changes. [PayloadSource](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/lib/conversation-payload-types.ts#L3) independently excludes Claude Code/Command Code; [nativeParsers](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/lib/conversation-payload.ts#L52) is yet another registry. Preserve these real availability distinctions while making omissions fail.
3. **UI parity is opt-in.** [DataTable](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/ui/components/data-table.tsx#L84) defaults selection off. [SelectionActionsToolbar](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/ui/components/selection-actions-toolbar.tsx#L4) silently hides missing optional callbacks. The [baseline Command Code table](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/ui/components/command-code-sessions-table.tsx#L54) and [Grok Bot inventory](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/ui/routes/grok-bot.index.tsx#L110) demonstrate this. Source routes separately recreate pending selection, mutations, dialogs, download handling, and query invalidation.
4. **Transcript representations diverge.** API [ConversationMessage](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/lib/conversation-data/types.ts#L138) already carries role/phase/order/tool evidence. UI [TranscriptView](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/ui/components/transcript-view.tsx#L1) instead consumes Codex-owned [ThreadEvent](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/lib/codex-browser-types.ts#L139) and Codex filtering. Sources normalize separately for API and UI; compare [OpenCode API normalization](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/lib/conversation-data/opencode-message-normalizer.ts#L42) with [UI event conversion](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/ui/lib/opencode-transcript-events.ts#L96). Preserve source-specific lifecycle/search/token/deferred/encrypted data rather than flattening everything to text.
5. **Export contracts differ by caller.** [ExportDialogOptions](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/ui/lib/export-options.ts#L3) exposes commentary/tools/metadata, Markdown/text, ZIP. [ExportDialog props](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/ui/components/export-dialog.tsx#L33) make raw/evidence support optional at each call site. API [Markdown rendering](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/lib/conversation-data/markdown.ts#L5) labels by role, without a corresponding role/phase filter contract; [ZIP options](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/lib/conversation-data/types.ts#L254) are Markdown-only. Separate UI renderers couple reasoning to commentary and truncate tool outputs at 4,000 characters: e.g. [Claude Code](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/lib/claude-code-transcript.ts#L24), with the same pattern in Grok, Cursor, FX, MiniMax Code, OpenCode. A UI preview limit must not silently become an export limit.
6. **Raw fidelity and naming diverge.** [Raw download DTO helper](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/lib/conversation-data/raw-download.ts#L4) preserves Blob/name/MIME. [UI raw rendering](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/ui/lib/source-session-export-server.ts#L69) converts a single Blob to text, and writes batch entries with `.json`. [Filename generation](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/lib/ui-export-archive.ts#L53) always uses `.json`; [HTTP raw handler](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/lib/conversation-api.ts#L485) uses that name despite the adapter's actual format. UTF-8 decoding/re-encoding is not byte-preserving for arbitrary original bytes.
7. **Unsupported/missing/failure are conflated.** [Raw/delete dispatch](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/lib/conversation-data/index.ts#L279) uses optional chaining and null. Raw absence becomes HTTP 404 even for an unsupported source. [Batch delete](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/lib/conversation-data/index.ts#L291) aggregates cleanup failures but a thrown per-item operation can obscure earlier successful mutations. Keep source safety/recovery policies explicit and preserve retry information.
8. **Tests are not exhaustive registration gates.** [Source table tests](https://github.com/ragaeeb/spiracha/blob/33b061ebca818b2b1773795ce9eb42ef9395dfc0/src/ui/components/source-tables.vitest.tsx#L135) maintain a manual fixture array and use `as unknown as ComponentType` casts. There is no compile-time requirement that a new source be represented, nor a journey test proving the visible control reaches the correct backend operation.

## Recommended architecture

Use TypeScript `type` contracts and discriminated unions (repository convention), exhaustive `satisfies` mappings, shared action composition, and registration-driven tests. Do not build an inheritance hierarchy, DI framework, dynamic plugin loader, or universal page with source-specific boolean switches.

### 1. One portable source catalog; separate exhaustive bindings

Introduce a small portable catalog module for identity/label/scope/routes/export identity and capability declarations. It must import neither storage/database modules nor React/router modules. Make source IDs derive from the catalog (or retain one source-ID tuple and require exact mapped coverage—never two independent ID lists). Keep icon/component bindings in an exhaustive UI mapping and filesystem handlers in an exhaustive server mapping. Derive `/api/v1/sources` metadata, sidebar entries, source validators, raw eligibility, and reference resolution from these contracts where feasible. Keep TanStack file routes explicit and generated normally; test their coverage against the catalog.

Every operation must be explicitly classified:

```ts
type Capability<T> =
    | { state: 'supported'; value: T }
    | { state: 'unsupported'; reason: string }
    | { state: 'not_applicable'; reason: string };
```

Use the declaration's literal state to require a handler in server/UI bindings when supported and prohibit a handler when unsupported/not applicable. Use a mapped registry keyed by source, with each entry's source ID constrained to its key. Do not put server callbacks in the serialized catalog, and do not repeat unrelated booleans that can disagree with the handler union. Derive serialized capabilities from the authoritative declarations.

Baseline operations: inventory, workspace/global conversation list, detail, multi-selection, single and batch normalized export, original raw export, focused evidence export, individual artifact export where supplied, single and batch conversation deletion, and workspace removal. Normalized Markdown/text and batch selection are common orchestration over required reads; sources should not reimplement ZIP or dialogs. Workspace removal and recovery remain distinct optional *capabilities* with required decisions, not optional undocumented methods.

An unsupported reason must identify a genuine storage/platform constraint with code/docs/fixture evidence. “Not implemented”, “read-only adapter”, “future work”, or missing callbacks do not qualify. New-source completion is blocked by unimplemented applicable baseline work. Keep evidence-backed exceptions in the reviewed catalog with tests; implementation progress belongs in the issue, not a production `pending` capability that hides missing UI. Distinguish runtime unavailability (app not installed, locked, authentication absent, transcript deferred) from inherent unsupported functionality.

Command Code deletion is an applicable gap to complete/reconcile, not an exception justified by its initial omission. Investigate session/checkpoint/meta ownership, parent relationships, live writer interaction, scoped deletion, and retries using existing Command Code discovery. Qoder deletion and Cursor/FX/OpenCode original-raw absence require explicit evidence-backed decisions; do not manufacture an “original file” by serializing reconstructed data or deleting a shared database. Snapshot export, if needed, must be a separately named format, not raw.

### 2. A shared conversation action boundary

Reuse `DataTable`, `SelectionActionsToolbar`, `ExportDialog`, `DeleteConfirmDialog`, `export-mutation.ts`, download lifecycle helpers, and `workspace-delete-navigation.ts`. Introduce only the smallest shared action controller/components needed for list row actions, selected-row toolbar, and detail actions. Bind each to a source descriptor plus typed operations, not ad hoc optional callbacks. Lists with applicable batch actions automatically enable selection. Source tables retain their columns, tree layout, filters, and metadata; source pages retain deferred loading/recovery panels.

Use stable IDs, snapshot selection/options at confirmation, keep selection coherent across filtering/sorting/pagination and disappearing records, prevent duplicate submissions, and implement keyboard/accessible menus and dialogs. Define select-all as visible rows unless a separately labeled all-results action is implemented. Batch export creates a ZIP; empty selections cannot submit. Successful mutation invalidates inventory, workspace, detail and deferred-body queries; mixed failures retain retryable targets and do not masquerade as total failure or success. Global Grok Bot inventory gets applicable row/batch actions without inventing workspaces.

Server validation and capability checks remain authoritative; hiding a UI control is not enforcement. Expose machine-readable unsupported-operation errors distinct from missing resources and runtime failures, consistently through HTTP and `createConversationClient` local/HTTP modes. Workspace removal need not become a new stable public endpoint merely to share UI controls; bind existing source server functions under the same capability contract unless a public contract is deliberately added and tested.

### 3. Normalize once; project for UI and export

Evolve the existing `ConversationMessage`/tool-evidence contract as the common semantic representation rather than inventing a third timeline. Move generic event ownership out of Codex-named modules where appropriate. Preserve typed source lifecycle/search/token events as distinct non-message events, or explicit typed supplemental events, so richer existing UI is not lost. One provider normalizer owns role, phase, ordering, and tool extraction; the UI event projection and export renderer must not reclassify independently.

Required semantics:

- Distinguish user, assistant final answer, assistant commentary, reasoning/thinking, tool call, tool output, system, and unknown. Unknown remains unknown; reasoning/tool output must not become user text or final-answer prose.
- Keep stable message/block IDs, source IDs, order, actual timestamps (unknown as null), per-message models, and branch/parent provenance where provided. Preserve independent turns, interleaved tool blocks and repeated output; dedupe only demonstrated duplicate records.
- Tool calls retain name/namespace/call ID and complete input; outputs retain complete text, status/error, exit code, duration/workdir where known. Empty successful output is still an output event. Pair by observed call ID; any fallback must be explicitly labeled (reuse evidence pairing contracts), not invented evidence.
- Reasoning unavailable/encrypted/summarized is distinguishable from available full text. Preserve hidden bootstrap/synthetic-event policy and source-specific phase logic; do not fabricate a final answer for an interrupted tool turn.
- Keep full data independent of UI previews and lazy loading. Represent omission/truncation or unavailable bodies explicitly. Do not claim full export from a bounded preview.
- Reuse exact `artifacts[].content` semantics from `spiracha/payload`; preserve source titles/IDs, report references, JSON formatting and original strings. Formatting a combined Markdown document does not change artifact-body identity. Support UI artifact downloads without treating provider labels as storage sources.

### 4. One export policy and rendering path

Define a portable shared normalized-export options type consumed by UI/server/API/client/CLI/payload conversion where applicable. Separate format (`md`/`txt`), packaging (single/ZIP), message selection, role/phase inclusion, metadata, and artifact inclusion. Raw bytes and focused evidence are separate operations, not overloaded normalized-format flags.

Specify independent controls for user messages, assistant final text, commentary, reasoning, tool calls, tool outputs, system/unknown events, and metadata. Compact UI grouping is acceptable, but the underlying contract must not couple thinking to commentary. Full-fidelity export includes all available relevant content; any preset hiding content must be labeled. Keep existing selector meaning (`last_assistant` is literally the last assistant-role event, `last_final_answer` requires that phase) unless an explicit breaking migration is documented. Apply selectors first, then explicit filters; never backfill another message if the selected event is excluded. Keep conversation artifacts independent of message selectors, with an explicit include-artifacts choice.

Reuse the portable Markdown/text utilities, normalized DTOs, archive naming/collision handling, temporary-export TTL/byte quotas, private permissions, cancellation and download lifecycle. Delete duplicated generic `*-transcript.ts` rendering/filter logic once migrated; retain only necessary source-specific parsing/metadata extraction. Full exports must not inherit the 4,000-character preview truncation. Render tool evidence and phase labels explicitly rather than relying only on a preformatted `text` field. Honor code fences/literal content without executing it.

Original raw downloads must remain Blob/bytes end to end, including single UI downloads and ZIP entries. Preserve the adapter's sanitized original extension/MIME and deterministic collision-safe archive names; `.jsonl`/`.blob` must not be silently relabeled `.json`. Reject selectors/transforms for raw. If no byte-exact source representation exists, declare original-raw unsupported with a reason instead of synthesizing it. Add a separately named snapshot format only if specifically required.

Preserve `spiracha/payload` portability and its no-I/O invariant. Derive supported payload parsers explicitly; do not make registration imply a parser exists. Keep Claude Code/Command Code payload exclusions until intentionally implemented. Artifacts and normalized export improvements must propagate through existing `POST /api/v1/conversation-payload`, not a new parallel route.

## Implementation sequence and deliverables

1. **Reconcile and freeze behavior:** re-audit current HEAD/concurrent Command Code changes; add a checked-in capability matrix in `docs/source-adapter-contract.md`, backed by the authoritative catalog and concrete exception evidence. Record current specialized behavior to preserve (Codex Cloud, Web, Grok Bot, Antigravity, Cursor/OpenCode recovery, deferred bodies).
2. **Make omission fail first:** add types/catalog and exhaustive storage/UI/payload registrations. Remove `Partial` adapter registration and silent missing-adapter success. Add type-level negative fixtures proving missing source, missing operation binding, ID mismatch, and undeclared exception cannot compile. Do not alter user data.
3. **Unify semantics/export with golden tests:** migrate normalizers/projections and shared filters/renderers while preserving provider evidence and artifacts. Fix raw transport/name fidelity. Publish deliberate export/default/DTO breaking changes and consequences in docs/release notes; do not retain compatibility branches.
4. **Wire common actions:** migrate all registered source list/detail surfaces. Reconcile/finish Command Code export, selection and deletion; fill Grok Bot list actions. Complete or justify every remaining matrix cell. Bind workspace removal only where actually supported, preserving empty-workspace behavior and safety protocols. Implement applicable Web surface actions without adding persistence; preserve Cloud read-only constraints.
5. **Enforce publicly:** capability-aware API/client errors and source metadata; identical local/HTTP export semantics; CLI help/options matching the shared contract. Keep existing route names unless an explicit hard cut is documented. Generate routes rather than editing `routeTree.gen.ts`.
6. **Add source onboarding gate:** fixtures and conformance tests must be exhaustive keyed records driven by the source registry. Update AGENTS.md with the required contract, fixture registration, applicable E2E journey, exception evidence, and commands. Documentation supplements compiler/CI enforcement; it does not replace it.
7. **Close out only after full migration:** remove duplicate lists/normalizers/renderers/action wiring superseded by this work; self-review all changed code, error paths, bounded I/O/concurrency, docs and DX. No TODO adapter stubs or “remaining sources later” closeout.

## Acceptance criteria

- [ ] Every current source has an exhaustive catalog entry, actual storage/UI bindings, and conformance fixtures; Web/Cloud have separately explicit surface policies. Adding a source without any one of these fails a standard gate.
- [ ] Supported features require real handlers and reachable controls. Unsupported/not-applicable features have evidence-backed reasons, visible explanatory metadata, and authoritative backend rejection. Runtime unavailable is separate. A missing method cannot be mistaken for missing data or approved read-only support.
- [ ] Every applicable source has inventory/navigation/detail, row export, multi-select/batch export, detail export, raw/evidence/artifact actions when supported, and single/batch delete with confirmation. Workspace removal is explicitly classified and preserves real project files. Command Code omissions are resolved end to end, not hidden by exceptions.
- [ ] Same source fixture/options produces semantically identical content through UI download, local SDK, HTTP SDK/API, and CLI where exposed; Markdown/text differ only in documented formatting. Payload-supported sources/providers meet the same normalized semantics without storage I/O.
- [ ] Independent role/phase filters work; complete tool inputs/outputs and provenance survive. Long outputs are not silently truncated by preview limits. Missing/encrypted/partial data is represented honestly. Per-source final-answer heuristics remain centralized and tested.
- [ ] Raw bytes survive all routes and ZIP packaging exactly, with correct names/MIME; normalized text/artifact strings are not confused with original raw representation. Exact artifact content is preserved, including JSON whitespace/Unicode/trailing newlines.
- [ ] Deletion reports success, missing, failed and cleanup-pending outcomes accurately, including mixed batches; retries remain actionable after restart where source deletion protocols require durable intent. Existing process checks/locks/journals and no-real-worktree-deletion guarantees remain intact.
- [ ] Selection works with sorting/filtering/pagination, keyboard operation and state changes; pending operations cannot double-submit; cancellation/error handling/temp downloads and cache invalidation are complete.
- [ ] Browser/portable bundles import no filesystem/SQLite/Keychain/storage dependencies. SSR/deferred detail loading remains functional and large sources do not hydrate every transcript for inventory.
- [ ] Documentation covers onboarding, capability exceptions, export defaults/semantics, raw vs normalized vs snapshot/evidence, lifecycle limitations, and any hard breaking changes. All documentation paths are repository-relative.
- [ ] Required gates below pass with no cognitive-complexity warnings, rule suppressions, compatibility scaffolding, skipped parity fixtures, or unresolved applicable matrix cells.

## Test strategy / evidence required

### Compiler and registry tests

Use `satisfies` exhaustive keyed fixtures and supported-operation conditional bindings without `any`, double casts, or tautological tests that merely compare metadata to itself. Include deliberate missing-handler/missing-route-binding/type mismatch negative tests (type-test expectations only in dedicated compiler fixtures, never suppression of production errors). Assert catalog/storage/UI/payload coverage and uniqueness. The standard `typecheck`/test commands must fail if a new source has no fixtures.

### Source normalization/export conformance (root Bun)

Each source fixture exercises its *actual* parser/adapter, not only a prebuilt normalized object. Include supported user/final/commentary/reasoning/tool input/output/system/unknown events, with explicit format-backed exclusions. Cover mixed blocks, multiple turns, branch selection, duplicate IDs, source IDs with special characters, tool-only user wrappers, orphan/empty/error output, unpaired calls, model switches, unknown timestamps, interrupted/deferred/encrypted state, malformed/partial files, absent optional integration, and exact/descendant cwd/time/keyset filters.

Export goldens cover independent inclusion flags, selector/filter precedence, Markdown/text, same-name ZIP entries, long output markers beyond 4,000 and 20,000 characters, literal backticks, Unicode, CRLF, and trailing whitespace. Compare raw byte arrays for single HTTP, UI download and ZIP members (including invalid UTF-8 bytes where a source accepts byte raw data); test `.jsonl` and `.blob` names. Artifact fixtures include exact Markdown and JSON bodies for applicable Web providers and Antigravity. Unknown formats/errors must not fabricate data.

### API/SDK/CLI and packaging

Exercise real request handlers and local-vs-HTTP client calls for capabilities, list/detail/export/raw/evidence/delete and payload conversion where applicable. Assert error codes/status and unsupported-vs-missing behavior, malformed options, ID/batch bounds, cancelled requests, missing source, and mixed mutation outcomes. Use packaged `spiracha serve` smoke with isolated fixture locations to prove route registration and CLI commands, not only fetch mocks. Check public declarations and portable Node/browser/Worker execution; no local files/URL/Keychain loads from supplied payloads.

### UI and browser conformance

An exhaustive source fixture registry drives row/detail actions, selection toolbar, export options, unsupported explanation, confirmation/cancellation, success/error/partial retry, empty data, and invalidation/navigation tests. Test actual common controllers wired to source operations, not just “a button exists.” Preserve specialized tables/tree selection and deferred loading.

Run a real server/browser journey against temporary source fixtures for every applicable source: navigate source → workspace/global list → select two → export ZIP → inspect downloaded members → detail export → cancel delete (no mutation) → confirm delete → list/detail state updates. Add workspace removal/empty workspace/recovery cases only where supported, and verify unsupported controls and backend rejection for exceptions. Never run destructive acceptance against personal source stores; close all browser/server processes started by tests.

### Deletion and resource tests

Use isolated files/databases for scope containment, sibling preservation, shared-project ownership, invalid selectors, concurrent writer rejection/locking as supported, rollback, post-commit cleanup failures, retry/restart recovery, large batches and archive/cancellation cleanup. Workspace deletion must not delete the source-code checkout. Treat process checks as checks, not atomic app writer locks; preserve source-specific documented limitations.

### Final gates

Run and record `rtk bun run lint`, `rtk bun run typecheck`, `rtk bun test`, `rtk bun run test:ui`, `rtk bun run build`, `rtk bun run test:package`, `rtk bun run coverage`, and `rtk git diff --check`. Root and UI line coverage must meet the existing 90% gates. Record per-source E2E outcomes and justified exceptions; coverage percentages alone do not prove parity. Reread this issue and the requesting prompt and verify that no surface or acceptance item was omitted before marking implementation complete.
