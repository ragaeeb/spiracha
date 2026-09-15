# Source-adapter contract: target specification and foundation status

## 1. Status, authority, and terminology

This document is the implementation specification for the attached source-parity proposal, grounded in the supplied 2.9.0 archive. It is **not a claim that the entire specification is implemented**. The seed patch implements portable source identity, exhaustive adapter/parser/icon registrations, compiler-negative examples, and lossless raw transport/naming. The other contracts below are the next implementation. Read `docs/contract-review/FINDINGS.md`, `IMPLEMENTATION_PLAN.md`, and `TEST_MATRIX.md` alongside this document. `CODEX_HANDOFF.md` is the entry point.

The archive has no Git history. The upstream audit's commit cannot be verified from it. In particular, Command Code selection, export, and deletion already exist here; preserve them while replacing duplicated orchestration and strengthening their safety/reporting. Do not restore the older audit's missing implementation. The packet's Git patch is against a synthetic baseline of the supplied archive, not an assertion about upstream HEAD.

A **source** is one of the 13 IDs in `CONVERSATION_SOURCES`. A **surface** is a UI/data-access context: local sources, authenticated Codex Cloud, or in-memory Web imports. A Web payload provider is neither a source nor a new storage registration. An **inventory** lists source workspaces or, for a global source, conversations. A **conversation list** is the workspace's list or the global list. A **native workspace removal** mutates owned application workspace/project metadata, not a user's source-code directory. Deleting all conversations in a virtual grouping is a different operation.

A **supported capability** promises an implemented, bound operation, not the presence of usable data on a particular machine. An absent installation, locked file, expired authentication, missing native raw file, deferred body, or unavailable encryption key is a runtime availability state. A static exception is never justified by a missing method, missing UI, or future work.

## 2. Non-negotiable boundaries

1. Keep the source tuple authoritative. Every catalog, server binding, UI binding, parser decision, and conformance fixture must be an exhaustive mapped record keyed by it. IDs in entries must equal their keys. Do not introduce a second manually maintained source union.
2. The portable catalog imports no filesystem, SQLite, Keychain, React, router, or source storage module. UI modules import the portable catalog, never the server registry. The `spiracha/payload` dependency graph remains entirely no-I/O.
3. One provider normalizer owns semantic classification. Rendering, UI projections, selectors, evidence, and archives consume its output; they do not infer role/phase again.
4. Normalized export, original raw assets, focused evidence, and exact artifact-body downloads are separate operations. No `raw: true` branch inside normalized formatting. No reconstructed object is labeled original raw.
5. Preserve existing source mutation protocols. Shared orchestration reports outcomes and coordinates requests; it does not turn independently committed store updates into an alleged atomic batch.
6. Keep explicit TanStack file routes and regenerate routes normally. Do not hand-edit `src/ui/routeTree.gen.ts`. No universal source page with dozens of boolean switches, inheritance hierarchy, dynamic plugins, DI framework, bridge exports, or legacy compatibility branch.
7. The final migration cannot ship partial registries, optional applicable callbacks, `pending` production capabilities, skipped source fixtures, rule suppressions, or a second renderer maintained “temporarily.” Intermediate work is tracked here, not encoded as approved production exceptions.

## 3. Catalog and capability declarations

### 3.1 Files and dependency direction

Keep the identity catalog at `src/lib/conversation-data/source-catalog.ts`. Extend its entries with `capabilities` only when the corresponding typed server/UI bindings and exception fixtures exist. Add portable operation types in `capability.ts` and `operation-types.ts`. Put source-specific bindings in `source-bindings.server.ts`, common export orchestration in `export-service.ts`, and React bindings in `src/ui/lib/source-ui-bindings.ts`. The existing `index.ts` remains the public composition/dispatch entry, not a second registration owner.

The current foundation's `SourceDescriptor<S>` owns `source`, `label`, `scope`, `inventoryPath`, `detailRouteSegment`, `exportPlatform`, and `navigationOrder`. Preserve existing URLs and the Claude/MiniMax export aliases. Add workspace-route metadata only for workspace-scoped entries; use a scope-discriminated union so Grok Bot cannot acquire a fake workspace route. Route metadata contains serializable path templates/parameter names, not `Route`, `Link`, or icon objects. `source-icons.ts` is already exhaustively keyed and remains UI-only.

The target operation IDs are:

```ts
type OperationId =
    | 'inventory'
    | 'list'
    | 'detail'
    | 'multi_selection'
    | 'normalized_export'
    | 'batch_normalized_export'
    | 'original_raw'
    | 'batch_original_raw'
    | 'focused_evidence'
    | 'artifact_download'
    | 'delete'
    | 'batch_delete'
    | 'workspace_removal'
    | 'deletion_reconciliation'
    | 'workspace_recovery';
```

`inventory` is workspace summaries for workspace sources and conversation summaries for Grok Bot; `list` requires the corresponding scope input. `workspace_recovery` restores/merges recoverable workspace state; it is not deletion cleanup. `deletion_reconciliation` finishes an already authorized mutation. Neither capability implicitly authorizes another delete.

### 3.2 Literal-state binding rules

Retain the supplied union's spellings:

```ts
type Capability<Value> =
    | { state: 'supported'; value: Value }
    | { state: 'unsupported'; reason: string }
    | { state: 'not_applicable'; reason: string };

type CapabilityBinding<Declaration extends Capability<unknown>, Handler> =
    Declaration extends { state: 'supported' }
        ? { handler: Handler }
        : { handler?: never };
```

The seed contains these types and ten compiler-negative examples. It does not yet use them to enforce every production action. The existing compiler configuration does not enable `exactOptionalPropertyTypes`; `handler?: never` excludes a callable handler but may accept an explicitly undefined property. No semantic code may rely on that property being absent. If exact absence becomes important, introduce a tested stricter builder or deliberately enable the compiler setting with repository-wide migration; do not claim the seed enforces it.

Add `Supported<Value>` and a reviewed exception type with `reasonCode`, `reason`, and nonempty `evidence` entries (`path`, `symbol`, `testId`). These are serializable. A catalog declaration's `value` says which implementation owns the operation: source reader/mutator, common service, or surface store. It never contains a function. For existing local sources, inventory, list, detail, selection, normalized single/batch export, evidence, and single/batch deletion are required supported declarations. Qoder's deletion work is therefore a release prerequisite, not an allowed exception.

Model per-source bindings using the **literal** indexed declaration, for example `typeof SOURCE_CATALOG[S]['capabilities'][K]`, rather than widening it to `Capability<...>` before applying the conditional. A widened union admits the wrong branch. Require the registry expression to `satisfies { [S in ConversationSource]: BindingsFor<S> }` and constrain `source: S`. Use a small `bindSource` identity helper only if needed for TypeScript inference; do not cast the whole registry to the desired type. Add a test where a supported literal loses its handler, and prove that it fails under the normal project typecheck.

Only provider-owned operations require provider callbacks. Shared operations require one exhaustive common-operation map plus per-source read/reference bindings: selection from stable IDs, normalized export from full detail, batch export from repeated reads, evidence from canonical messages, and batch deletion from settled single mutations. A source must not satisfy an export capability by supplying another Markdown renderer. UI binding requirements include a reachable action composition and fixture, not just a server callback.

### 3.3 Serialization and runtime validation

`GET /api/v1/sources` derives its metadata from the catalog and returns identity, scope, route/export identity, and the operation declarations. It omits callbacks, server filesystem locations, secrets, and UI objects. `schemaVersion: 1` belongs to the capability metadata envelope; it is not an extra storage source/version union. Reasons and reason codes appear for both unsupported and not-applicable states. Supported values contain public limits/formats where relevant, not internal module names.

Server validation checks the catalog state before opening a source store. UI visibility is not authorization. For a valid source with an unsupported operation, reject that operation even when the provided conversation ID does not exist; avoid using resource existence to hide an unsupported capability. For a supported operation, distinguish resource absence from unavailable backing data. Local client, HTTP client, API, and server functions use the same error-producing dispatcher.

An exception's evidence is checked in conformance tests for a real repository path and the independently authored behavior test that demonstrates the constraint. Tests also reject blank reasons and reasons equivalent to “not implemented,” “read-only adapter,” or “later.” Documentation links alone do not prove a constraint. New applicable omissions fail completion, even if all registered IDs have labels.

### 3.4 Exact handler responsibilities and request shapes

A source-specific callback is already bound to its source; do not pass it a second independently editable source ID. Public requests carry source, dispatcher selects that binding, and the provider receives the remaining validated fields plus a private server context. The binding entry and returned canonical detail/summary retain `source: S`. Constrain a detail return with a generic detail type or `Omit<ConversationDetail, 'source'> & { source: S }`; add a negative fixture for a handler returning a different source. Do not change the public source union to make that assignment work.

Server context fields are `locations` (validated local configuration), `signal` (AbortSignal), and `operationId` (opaque correlation identity). Locations never come from arbitrary HTTP body paths. Signal propagation is required for bounded reads and orchestration, but a committed source mutation follows its durability protocol before returning. This context and Blob/file handles do not enter the portable catalog or serialized source metadata.

| Operation | Provider/common handler input after validation | Output and ownership |
| --- | --- | --- |
| inventory | Workspace-source inventory query: search text, limit/cursor and source-native safe filters; global inventory uses the global conversation-list query. No detail-body flag defaults true. | Workspace summaries with stable native/derived key, label/path, counts and recovery availability; or global conversation summaries. A missing installation is availability, not a missing binding. |
| list | Discriminated `{scope:'workspace', workspaceKey, cwd?, cursor?, limit, updatedAfterMs?, updatedBeforeMs?}` or `{scope:'global', cursor?, limit, updatedAfterMs?, updatedBeforeMs?}`. UI workspaceKey resolves against authoritative source discovery; public cwd query keeps current exact/descendant semantics. | Summary page with stable canonical IDs, source literal, real timestamps/counts and cursor. Never all transcript bodies for selection. Cwd filtering must not bypass workspace/account ownership. |
| detail | `{id, bodyMode:'summary'|'preview'|'full'}`; public existing get options map to this private full-read boundary. | Canonical conversation or resource absence. Summary/preview can explicitly defer bodies; full requests complete available bodies under limits and return declared intrinsic absences. Canonical result is not preselected for an export. |
| multi_selection | Shared UI controller receives current inventory identity and stable row IDs, not provider I/O. | Required selection actions/binding; visible-page semantics. No per-source selection handler duplicating React state. |
| normalized_export | Shared service `{id, options:NormalizedExportOptions, packaging}` plus full-read binding. | Named Blob/text or private URL transport plus completeness report. Provider supplies no renderer or ZIP callback. |
| batch_normalized_export | Shared service `{ids, options, packaging:'zip', failurePolicy}`. | Published ZIP plus per-ID manifest/outcomes, or atomic failure with no URL; defined request order. |
| original_raw | Provider `{id}`; optional explicit partial-original consent belongs to service request for native-file sets, not normalized transforms. | Nonempty original-asset collection with identity/coverage or typed representation absence. Common service chooses one-file versus ZIP transport. |
| batch_original_raw | Shared service `{ids, failurePolicy, allowPartialOriginal:false|true}` over raw provider. | ZIP of original members and labeled generated manifest, never reconstructed transcripts. No raw format selector named md/txt. |
| focused_evidence | Shared service `{id, lens, generatedAt?}` over full canonical detail. | Existing validated evidence contract and Markdown projection, preserving pairing confidence and omission bounds. Lens is not passed into native parsing to reclassify messages. |
| artifact_download | Common service `{id, artifactId}` after full/deferred artifact lookup. | Exact artifact content bytes with sanitized title/MIME. Unknown conversation404; known conversation with unknown artifact uses `artifact_not_found`404. No client-supplied file path. |
| delete | Provider `{id, cleanupPolicy}` plus context. Cleanup policy is a discriminated catalog-declared source policy (e.g. Codex rollout retention), not arbitrary fields. | One settled DeleteOutcome with actual affected IDs, side effects and receipt. Client cannot disable required logical-store cleanup to manufacture success. |
| batch_delete | Shared executor `{ids, cleanupPolicy}` using the same single provider. | One outcome per distinct requested ID in order; all started work settled; no batch-wide atomicity promise. |
| workspace_removal | Supported native provider `{workspaceKey, cleanupPolicy}`; resolve current native selector inside source boundary. | `removed`, `missing`, `cleanup_pending` or `failed` result, affected conversation/native metadata IDs and receipt; no worktree deletion. Current source server functions remain its UI transport. |
| deletion_reconciliation | Source-owned provider `{receiptId, dryRun:boolean}` or existing bounded source pending-intent discovery. | Per-receipt completed/pending/failed report. Dry run never mutates; opaque receipt ID resolves only under this source's configured private receipt root. No arbitrary journal path from public caller. |
| workspace_recovery | Supported native provider with its existing validated workspace/target selector and dry-run/confirmation options. | Existing source recovery plan/result adapted without losing ownership or pending-delete conflicts. It is not automatically exposed as a stable API route. |

Common limit/default expansion happens before these callbacks. Provider-specific scope/ownership validation repeats at the native store boundary, because a typed caller is not a security boundary. Keep source-specific cleanup policies in a closed union with catalog-declared options/defaults and UI labels; reject flags not applicable to that source rather than silently ignoring them. The seed retains current adapter signatures; this table is the target replacement contract.

Inventory paging and transcript order are different concerns. A changed inventory can invalidate a cursor with a typed error; it cannot cause message IDs to be reassigned. Source-specific list summary DTOs used by specialized tables may be retained as typed supplemental summary data, but canonical ID/source/scope and common actions come from one binding. The controller does not need to hydrate detail or decode an entire source-native row to identify the target.

## 4. Capability matrix and explicit decisions

The table is a **target decision matrix**, not a record of passing end-to-end tests. Every source has supported inventory, appropriate-scope list, detail, selection, single/batch normalized export, focused evidence, and single/batch deletion. Evidence with no tool events returns a valid empty result with omission counts, not an invented unsupported state.

`Native files` means byte-exact source-owned transcript asset(s), with resource-level availability and coverage metadata. `N/A group` means no independent Spiracha virtual-group object to remove. Artifact capability refers to named generated artifact bodies, not every image attachment or tool-written path mentioned in a conversation.

| Source | Scope | Original raw target | Named artifacts | Native workspace removal | Native payload parser |
| --- | --- | --- | --- | --- | --- |
| antigravity | workspace | Native transcript files when present; locked/trajectory-only is runtime unavailable for this representation | Supported; preserve typed artifact/deferred-body model | N/A group; do not delete project metadata merely used as a label | Supported |
| claude-code | workspace | Existing native JSONL; explicitly not a reserialized coalesced lineage | N/A for current parsed format | N/A group | Unsupported parser format in current portable implementation; explicit exclusion retained |
| cline | workspace | Existing native message file | N/A for current parsed format | N/A group | Supported |
| codex | workspace | Existing rollout JSONL; source-file presence is resource-dependent | N/A for current parsed named-artifact model | Supported existing project removal, respecting rollout policy | Supported |
| command-code | workspace | Existing session JSONL; meta/checkpoints are not silently folded into it | N/A for current parsed format | N/A group | Unsupported parser format in current portable implementation; explicit exclusion retained |
| cursor | workspace | **Add native agent-transcript file set**; DB-only conversation has no available native-file representation | N/A for current parsed named-artifact model | Supported existing workspace removal | Supported |
| fx | workspace | **Add native session transcript asset set**; never serialize reconstructed turns as original | N/A for current parsed named-artifact model | N/A group | Supported |
| grok | workspace | Existing native transcript file | N/A for current parsed format | N/A group | Supported |
| grok-bot | global | Existing account-scoped `.blob`, preserving its declared MIME | N/A for current parsed named-artifact model | Not applicable: no workspace scope | Supported |
| kiro | workspace | Existing physical history/execution representation, not synthesized merged lineage | N/A for current parsed format | N/A group | Supported |
| minimax-code | workspace | Existing native transcript file | N/A for current parsed format | N/A group | Supported |
| opencode | workspace | **Unsupported original native conversation file** for the shared relational representation in this checkout | N/A for current parsed named-artifact model | Supported existing workspace/project cleanup | Supported |
| qoder | workspace | Existing CLI JSONL or persisted state JSON; never ACP-reconstructed JSON | N/A for current parsed named-artifact model | N/A group | Supported |

The two parser exclusions are **payload format support declarations**, not exceptions to local source read/delete/export requirements. Preserve the existing excluded type until an actual portable parser and independent fixture are implemented. A future source must explicitly choose a parser policy, not inherit “excluded because a function is missing.” For current sources without named artifacts, evidence is the current parser/DTO's lack of a named artifact record type, not the absence of an export button. Revisit the declaration whenever a parser begins emitting artifacts.

### 4.1 Original-raw decisions and implementation evidence

**Cursor:** `findCursorTranscriptDirs`, `listCursorAgentTranscriptFiles`, and `readCursorAgentTranscript` in `src/lib/cursor-db.ts` discover sorted per-composer JSONL files in `agent-transcripts/<composerId>`. Reads can merge these with shared database bubbles. Therefore absence of a current raw callback does not justify a source-wide raw exception. Factor discovery into a shared *discovery-only* helper; export the exact discovered JSONL bytes as one native file or a native-file-set ZIP. Do not return shared global/workspace SQLite files. If discovery has no native JSONL, return `original_representation_unavailable` for that conversation; do not fabricate it from bubbles. Preserve every discovered native file rather than choosing an arbitrary “latest” replica. The archive-member manifest labels these as agent transcript files and coverage as `source_subset` or `unknown`, never a complete DB backup.

**FX:** `readTurnSources` in `src/lib/fx-db.ts` reads `checkpoint.json` and `events.jsonl`; `parseTurn` resolves additional tool-result text. A reconstructed turn array is not original. Add discovery for native session-owned transcript assets: existing session metadata, display metadata, checkpoint, event log, and tool-output files actually referenced by the parsed session format. Derive exact paths from the existing readers, not a recursive walk of arbitrary workdir. The raw file-set exporter preserves each file. If a referenced asset is missing, report it in coverage metadata; require explicit partial-original policy before downloading an incomplete set. Never include unrelated source-code files named inside tool text. Tests must prove every native asset path is contained in the owned session area.

**OpenCode:** `src/lib/opencode-db.ts` reads session/message/part state from shared tables, including related event/project data. The checkout has no authoritative standalone native conversation file. Encoding selected SQL rows creates a snapshot, not original raw; exporting the whole database violates conversation scope. The target exception is `no_native_conversation_file`, backed by a multi-session database fixture and a test that raw dispatch never reads/exports the whole database. Do not add a snapshot format in this migration. If a future native file format is added, change this policy with parser/discovery evidence and tests.

**Existing file-backed sources:** preserve each current adapter's original-file choice before considering additional native assets. Describe physical-file coverage honestly for Claude/Kiro coalesced histories and Antigravity trajectory-backed detail. An invalid UTF-8 transport test is a byte-fidelity test, not proof that invalid UTF-8 is valid semantic input for a source parser.

The Cursor/FX native-file collection contract is future work; the seed supports current single-Blob adapters only. It must not be advertised in runtime metadata until discovery, bounded packaging, UI controls and fixtures are complete.

### 4.2 Workspace and recovery decisions

Virtual workspace groups are derived by the `list*WorkspaceGroups` functions cited in `FINDINGS.md`. “Remove workspace” is not applicable to an independent group object there. Provide the separate, explicitly labeled “Delete all conversations in this workspace” action by enumerating authoritative membership and applying the conversation deletion contract. It is not equivalent to deleting selected/filtered rows. Empty virtual groups disappear on refreshed authoritative discovery; they have no external worktree deletion.

Only Codex, Cursor, and OpenCode bind native workspace removal in this migration. Use their existing handlers and safety options, not a generic `rm(workspacePath)`. Preserve existing recovery/merge panels for Codex/Cursor/OpenCode where their current functions apply. Do not label completion of a pending delete as “restore.”

Deletion reconciliation is supported where durable intent/cleanup exists: preserve Codex, Cursor, and Grok Bot policies; add it for the new Command Code/Qoder multi-store protocols. OpenCode's cleanup retry plan must become an actionable, restart-safe result when its desktop cleanup spans committed database changes. Other sources must declare either their actual recovery behavior or evidence-backed `not_applicable` when the mutation is one atomic owned-store action with no durable follow-up. If an audit reveals multiple non-atomic phases, implement durable intent rather than inventing a recovery exception. This remaining per-source mutation classification is task MUT-02; no production matrix may claim it is settled before those tests pass.

## 5. Portable canonical transcript

### 5.1 Evolve the existing types, not a third timeline

`ConversationMessage` in `types.ts` remains the canonical message contract. Extend it and `ConversationToolEvidence`; move generic presentation event ownership out of `codex-browser-types.ts` into `conversation-events.ts`. Keep Codex-specific parsing/metadata types in their source modules. `ThreadEvent` consumers migrate to a generic event union; do not leave an exported compatibility alias to the old type.

Canonical output consists of `messages`, `supplementalEvents`, `artifacts`, and conversation/body availability. Supplemental events preserve lifecycle, token usage, and search records that are not messages. Source normalizers receive provider-native parsed records and produce this output exactly once. Storage adapters and payload parsers reuse that pure normalizer. UI event conversion is a projection, never a second normalization pass. Source-specific final-answer heuristics live beside the normalizer and are reused by evidence and payload conversion.

Target additions use `type` declarations:

```ts
type ContentState =
    | { state: 'available'; representation: 'full' | 'summary' }
    | { state: 'partial'; reason: string; availableCharacters: number; totalCharacters: number | null }
    | { state: 'deferred'; reason: string }
    | { state: 'encrypted'; reason: string }
    | { state: 'unavailable'; reason: string };

type MessageProvenance = {
    sourceRecordId: string | null;
    sourceConversationId: string;
    blockIndex: number | null;
    branchId: string | null;
    parentMessageId: string | null;
    origin: 'native' | 'derived' | 'synthetic';
};
```

Keep `createdAtMs: number | null`, `id`, `order`, `model`, `metadata`, `role`, `phase`, `text`, and `toolEvidence`. Add `contentState`, `provenance`, and `visibility: 'normal' | 'bootstrap' | 'synthetic'`. `text` is exact available source text, including empty strings, CRLF and trailing whitespace. It is not a formatted tool-summary string. An unavailable field has `text: ''` plus its state; a successful empty output has available-full `text: ''`. Do not infer missingness from truthiness. Native JSON without an original string may be deterministically rendered to text with provenance `derived`; raw still uses bytes.

Use source-neutral `source: ConversationSource | 'web' | 'codex_cloud'` only in the **transcript/surface context**, not by widening `ConversationSource`. Preserve provider identity separately for Web. Do not mint local `spiracha://` links for Web or Cloud records. Canonical types that payload imports must not import the surface server store.

### 5.2 IDs, ordering, branches and timestamps

A message ID is stable for the same source record/block across list/detail/export/payload uses of the same representation. Prefer native message ID plus an explicit block discriminator. For duplicate native IDs, retain the native ID in provenance and disambiguate by stable occurrence index. For idless records, use a namespaced conversation/record-position/block key based on parsed source order; never use current time, a random UUID, absolute machine path, rendered text, or `Array.sort()` index after filtering. IDs only promise stability within a known native representation revision when a source provides no stable record identity; document that limit.

`order` is a monotonically increasing zero-based integer assigned after source-native ordering/branch reconciliation and before selectors or visibility filters. It is not a timestamp. Preserve `sourceOrder`/step/turn identifiers in provenance or typed metadata where needed. UI pagination must not renumber canonical messages. Independent turns with identical text remain independent. Dedupe only records proven to be duplicates by native identity or the source's documented replay rule; textual equality alone is insufficient.

Do not sort unknown timestamps before/after messages to manufacture chronology. Unknown timestamp remains null; file mtime may describe a conversation but is not a message timestamp. Equal native timestamps use original stable record order. A source with explicit branches must apply its existing branch selection rule once and retain parent/branch provenance. Do not mix all branches into an apparent single conversation without labels. Interrupted turns have no fabricated final message.

### 5.3 Role/phase invariants

Roles remain `user`, `assistant`, `tool`, `system`, `unknown`. Phases remain `final_answer`, `commentary`, `reasoning`, `tool_call`, `tool_output`, `unknown`. The normalizer must distinguish user messages, final prose, interim commentary, reasoning/thinking, tool calls, tool output, system text, and unknown data.

Classify rendering/inclusion buckets once with this precedence: tool_call phase; tool_output phase; reasoning phase; assistant/final_answer; assistant/commentary; user role; system role; then unknown. Assistant/unknown and tool/unknown stay in unknown, not in final prose. A provider's user-role wrapper around a tool result becomes a tool-output semantic message with wrapper provenance; it is not user content. Validate impossible known combinations instead of “repairing” them in a renderer. Provider-specific source role is retained in metadata when semantic unwrapping changes it.

Split heterogeneous content blocks into canonical messages or typed blocks at their original order positions. A text+tool+text assistant record must not become one string with the tool appended at the end. Preserve independent model IDs on every message where provided; conversation model is only a fallback label, never overwrites a model switch.

Reasoning may be full, summarized, encrypted, deferred, or unavailable. Display/export the representation label. Never claim a summary is full reasoning, decrypt by inventing text, or silently reclassify reasoning as commentary/final. Hidden bootstrap/synthetic handling remains source-specific classification followed by shared explicit visibility policy. `createTextMessage` must stop trimming and dropping empty tool events; audit every caller before changing it so control records that truly have no message are still emitted as supplemental events or intentionally omitted with a reason.

### 5.4 Tool evidence and supplemental events

Retain name, namespace, call ID, complete input, complete output, status, exit code, duration, workdir, and command where actually known. Extend tool evidence with input/output content states and provenance instead of collapsing unavailability into null strings. `null` means not observed, `''` means observed empty. Exit code zero is meaningful. A missing exit code does not imply success. Duration has a documented unit (milliseconds) and stays null when unknown.

Use observed call IDs for primary pairing. Reuse existing evidence pairing confidence contracts and explicitly label fallback positional/source pairing. Do not invent a call ID, pair across unrelated branches, discard repeated outputs, or convert orphan outputs into a user message. Multiple outputs for one call remain separate events. A tool call without output stays unpaired, including interrupted sessions.

Supplemental event union variants: lifecycle (`started`, `completed`, `interrupted`, with actual native status); token usage (input/output/cache/reasoning counts only when recorded); search (query/result references preserving existing fields); and unknown source event (typed raw-event reference and availability, not speculative prose). Each has stable ID, order coordinate and timestamp/provenance. Never embed raw unbounded provider objects in every inventory result. Analytics and existing tool/search panels must retain needed typed data, including Codex task lifecycle and Antigravity trajectory step identity.

### 5.5 Artifacts, body loading and losses

Reuse `ConversationPayloadArtifact`'s `id`, `title`, and **exact** `content`. Enrich artifact metadata in a compatible internal shape only if necessary for availability/MIME/provenance; do not change `.content` by parsing/restringifying JSON, trimming, normalizing newlines, replacing project paths, or interpreting report references. The combined Markdown wrapper can add headings/fences around an artifact, but individual artifact download bytes are exactly `TextEncoder().encode(content)`. Arbitrary binary attachments are a separately typed asset, not a string artifact pretending to be original raw.

Summary/list reads must not hydrate all transcript/artifact bodies. Detail preview responses can mark deferred/partial states. The full-read service explicitly requests all bodies under existing concurrency limits and source authentication/key policy. It returns either canonical full available content with declared intrinsic absences, or a typed incomplete result. An Antigravity preview limit of 20,000 characters and renderer preview limits of 4,000 characters never define export completeness.

Add a loss/inclusion report with counts/IDs/reasons for selector exclusions, explicit filters, hidden bootstrap policy, unavailable/encrypted bodies, partial native records and missing referenced assets. These are different categories. An intentionally filtered conversation is not a storage failure. A genuinely empty tool output is not an omission. Full-fidelity means every available relevant source body is included and every intrinsic absence is disclosed; it does not promise nonexistent/encrypted content.

## 6. Shared export options and deterministic rendering

### 6.1 Target options and defaults

Add the portable options type to `export-options.ts` under `conversation-data`, replacing the separate generic UI options during the migration:

```ts
type NormalizedExportOptions = {
    format: 'md' | 'txt';
    messageSelector: 'all' | 'last_assistant' | 'last_final_answer';
    include: {
        user: boolean;
        assistantFinal: boolean;
        commentary: boolean;
        reasoning: boolean;
        toolCalls: boolean;
        toolOutputs: boolean;
        system: boolean;
        unknown: boolean;
        supplemental: boolean;
        bootstrap: boolean;
        synthetic: boolean;
        metadata: boolean;
        artifacts: boolean;
    };
    completeness: 'require_available_full' | 'allow_partial';
    pathDisplay: {
        convertToProjectRoot: boolean;
        projectPath?: string | null;
        redactUsername: boolean;
    };
};

type ExportPackaging = 'single' | 'zip';
type BatchFailurePolicy = 'atomic' | 'partial';
```

This is the **target hard cut**, not the current runtime default. The default export preset is `Full available content`: format md, selector all, every inclusion true except bootstrap and synthetic, completeness `require_available_full`, both path transforms false. Metadata and artifacts true. Bootstrap and synthetic have separate explicit controls; the default label must say those diagnostic events are excluded. A `Full diagnostic content` preset additionally includes them. A `Conversation only` preset includes user+assistantFinal+metadata+artifacts, excludes other buckets, and visibly says it filters content. Reasoning is never implicitly coupled to commentary; tools may have one grouped UI toggle but the underlying call/output flags remain independent.

`require_available_full` forces deferred available bodies to load and rejects when any body known to have available full content remains truncated/unreadable. It may export an intrinsic encrypted/unavailable native field only with an explicit omission notice; it must not label that field full. `allow_partial` is an explicit opt-in for known partial bodies and must include the loss report. A source read failure cannot be downgraded to an empty conversation. UI preview defaults are separate and may be more compact.

Accept partial options at public request boundaries only through one strict validator/default-expander; internal services receive complete options. Unknown keys, wrong boolean types, unknown selectors, conflicting source/scope, invalid packaging, or normalized flags on raw are errors. Do not silently ignore extra raw flags. Do not reuse `zipArchive`/`outputFormat` compatibility aliases after the hard cut. Packaging and batch failure policy are request envelope fields, not message inclusion fields. Batch normalized export always uses ZIP; single can use single or ZIP. Empty ID arrays cannot submit.

`get`/list selector defaults remain their existing public meanings unless separately documented: full detail/default `all`, list behavior retains its documented default selected message. **Export always asks for full canonical messages first**, even when the caller requests last_assistant. Do not accidentally run a second selector over an already summarized adapter response. Payload conversion preserves its documented selected `messages` behavior, but artifacts remain independent and the same full input feeds export policy. Keep these distinctions explicit in declarations/help.

### 6.2 Exact pipeline

1. Validate source/surface, capability, request and bounds. Normalize requested IDs by first occurrence; retain request order.
2. Read the authoritative conversation representation, requesting complete available bodies, or obtain canonical Web/Cloud data through its surface provider. Do not select messages in this provider read.
3. Validate canonical IDs/order/body states and extract the source-proven loss report.
4. Apply `messageSelector` to the full canonical message array. `last_assistant` literally chooses the last assistant-role message by order, including commentary/reasoning/tool-call phases. `last_final_answer` requires assistant+final_answer. No final phase means no selected message.
5. Apply independent inclusion flags and visibility policy to selected messages. If a selected message is excluded, the result is empty: **do not backfill** an earlier final/user message. Supplemental events are separate and included by their flag; selectors do not fabricate relations to them. For last-message presets, the UI may explicitly disable supplemental events but the selector itself does not do so.
6. Include conversation artifacts solely according to `include.artifacts`, not selected message count. Exact artifact bodies bypass path transformations. Apply explicitly enabled path transformations to normalized conversation/tool/metadata presentation strings without mutating the canonical DTO.
7. Render through the sole portable Markdown/text renderer. Render a concise omission/partiality notice when relevant even if metadata is off; safety/completeness disclosure is not optional metadata. Produce exact artifact-file entries separately when a ZIP is requested.
8. Name, package and transport through the common export service. API/local/HTTP SDK/CLI/UI call it with the same expanded options. No source-specific generic formatting branch remains.

### 6.3 Markdown/text output grammar

Use deterministic structure and LF for wrapper syntax. Preserve source strings inside bodies, including CRLF, trailing spaces, Unicode and final newlines. Never `trim()` body text. A document has a title (fallback `Conversation`), optional metadata, ordered event sections, optional artifacts, and an omission summary. Missing title may be cleaned only for its heading; original title/ID remains metadata. Labels explicitly distinguish `User`, `Assistant · Final answer`, `Assistant · Commentary`, `Reasoning`, `Tool call`, `Tool output`, `System`, `Unknown`, and supplemental kinds. Include observed model labels without changing raw model IDs in metadata.

For Markdown, user/final/commentary text may render as Markdown literal content already supplied by the source; tools and data blocks use fences selected as one longer than the longest run of that fence character in the entire body, minimum three. Never terminate a fence early on embedded backticks. Escaping wrapper headings is separate from altering body strings. Available empty successful tool output renders a labeled tool-output section with an explicit `Empty output` wrapper note and its success/exit metadata; it is not dropped. Unknown/encrypted reasoning has a state label without invented body prose.

For text, use the same section order and human-readable labels with no Markdown heading/fence syntax generated by Spiracha. Do not strip original Markdown syntax already inside source text. Tool input/output is written verbatim after labels. Same options yield the same included semantic events and exact contained body strings in both formats; whole-document bytes differ due to the wrapper grammar. Golden files define final separators (one blank wrapper line between sections, one trailing document LF if needed) and show body/trailing-newline preservation explicitly. No snapshot timestamp is inserted unless the caller supplies a deterministic `generatedAt` for the relevant evidence/manifest contract.

### 6.4 ZIPs, manifests, failures and names

Retain existing normalized naming utilities and aliases. Add collision tests for differing source IDs, equal titles, case/NFC-equivalent names, names already ending in `-2`, and path/control characters. Bound each final basename to 180 UTF-8 bytes, retaining its meaningful extension and collision suffix; use a safe fallback for empty/reserved device names. The seed handles native basename sanitization and full-filename collisions but not all of these additional bounds/reserved-name cases.

Make batch failure policy explicit. Default API/SDK/CLI is `atomic`; UI deliberately requests `partial` for batch reads/exports and shows partial outcomes. This preserves the useful Codex partial-export workflow without leaving it source-specific. Atomic means “no downloadable archive is published unless every requested conversation succeeds”; it is not a cross-store snapshot/lock guarantee. Build privately, discard on any item failure, and return errors with no download URL. Partial exports include successful items and an outcome manifest; zero successful items returns an error with per-item outcomes, not an empty success ZIP.

Every batch ZIP contains `spiracha-manifest.json` in one versioned schema shared by all sources, migrating Codex's existing manifest deliberately. Required fields: `schemaVersion`, operation kind, source/surface, expanded options excluding private locations, failurePolicy, request-order entries (`requestedId`, status, member names, omission summary, public error or null), and total/success/failed/missing counts. Artifact entries include source artifact IDs. A manifest is explicitly generated metadata, not native raw content. Do not promise deterministic ZIP binary equality across timestamps/compressors; tests compare member names and bytes and deterministic manifest fields.

Single normalized Markdown/text omits the archive manifest but includes completeness disclosure. Individual artifact downloads use a sanitized title-derived filename and exact `.content` bytes. An artifacts-in-ZIP policy writes both the combined transcript (with its artifact sections) and exact artifact member files; documenting intentional duplication avoids accidental data loss.

## 7. Original raw and download transport

The seed's private server-function DTO is:

```ts
type RawInlineDownload = {
    mode: 'download_base64';
    contentBase64: string;
    fileName: string;
    mimeType: string;
};
```

Base64 is a wire encoding, not a text export. The browser decodes to `Uint8Array`, constructs a Blob, and uses the same anchor/object-URL lifecycle as text downloads. Single bodies above the configured threshold and all current raw batches use the existing private ZIP/download-URL lifecycle. HTTP `/raw` continues returning bytes directly, now with sanitized native filename/extension rather than a fabricated `.json` name. MIME is preserved from the adapter; a `.blob` may legitimately retain the adapter's `application/json` declaration. Do not sniff and rewrite MIME based only on extension.

For the target native-file-set cases, evolve the internal raw provider result to a nonempty array of `{assetId, fileName, mimeType, bytes/Blob handle, provenance, coverage}`. Asset IDs are opaque source-scoped identifiers, not user-supplied paths. A single file can still return the native bytes; multiple original files become a ZIP with native members and a labeled generated manifest. Widen MIME types where the actual native format requires it. The stable client still returns a download Blob/name/MIME; add public representation/coverage metadata without turning raw into normalized JSON. Document that a raw set ZIP is packaging of originals, not an original single file or a reconstructed snapshot.

Raw rejects message selectors, role/phase filters, redaction/path transforms, evidence lenses, and artifact rewriting. Caller packaging may wrap native files in ZIP but may not change member bytes. Archive member names use safe basenames and deterministic collision handling; never leak an absolute source path in Content-Disposition. Preserve extensions `.jsonl`, `.json`, `.blob`, or another genuinely returned native extension; do not relabel to `.json`. For resource-level missing assets, show that condition before download and apply an explicit `allow_partial_original` consent only to native-file sets, not silently to a single missing file.

A Blob/file can change while an external app writes it. Capture pre-read identity/size/mtime, read under bounded I/O, recheck identity afterward and reject `source_changed` rather than falsely claiming a coherent snapshot when it changed. A process check is not an atomic writer lock. Do not export a whole shared SQLite database to avoid this problem. Hash bytes for test verification or a bounded manifest when needed, never via UTF-8 decoding.

Download lifecycle target: preparing → ready → downloading; failure/cancellation is terminal for that attempt. Prevent anchor creation after unmount/abort; revoke inline URLs on success **and every error after URL creation**; clear pending refs in finally. A browser-triggered download does not prove the OS finished saving it, so UI wording must not claim that. Preflight HEAD uses the same authorization/expiry rules as GET. Never retry a deletion automatically through a download retry helper.

Reserve export bytes before writing, rather than assuming pruning existing files bounds concurrent in-flight work. Retain configured TTL, private permissions and quota behavior from `ui-export-files.ts`/runtime configuration. Bound concurrent body loads with existing limiters; size admission uses bytes, not JS string length. Clean work directories and incomplete ZIPs on failure/abort; release reservations in finally. Anonymous logs must not contain transcript content, raw base64, keys, or private artifact bodies. Durable deletion receipts are not subject to temporary-export TTL pruning.

## 8. Errors, validation, API and clients

### 8.1 Error contract and HTTP mapping

Introduce a portable `ConversationOperationError` with `code`, `message`, `source`/surface, `operation`, optional `id`, `retryable`, and structured public `details`. Storage paths/secrets stay in server diagnostics unless an existing local recovery UI deliberately exposes an authorized path. Local SDK throws this error; HTTP SDK reconstructs the same fields from the existing error envelope, without making callers parse English strings.

| Condition | Code | HTTP | Retry behavior |
| --- | --- | --- | --- |
| Invalid options, unknown source, invalid ID/scope, unsupported selector/format value | `invalid_request` | 400 | Fix request; no source access/mutation |
| Valid capability statically unsupported | `unsupported_operation` | 422 | Never retry unchanged; include state/reasonCode |
| Valid operation not applicable to scope/surface | `not_applicable_operation` | 422 | Never retry unchanged |
| Supported operation, conversation absent | `conversation_not_found` | 404 | Refresh inventory |
| Conversation exists, native raw representation absent | `original_representation_unavailable` | 409 | Other representation/export may work; not a missing conversation |
| Deferred/known partial body cannot meet requested completeness | `incomplete_transcript` | 409 | Retry only if body can become available |
| Source changed during a bounded read | `source_changed` | 409 | Bounded explicit retry may succeed |
| Destructive ownership/path/process/recovery conflict | `mutation_conflict` | 409 | Explain required intervention; never silently retry |
| Source authentication absent/expired | `authentication_required` | 401 | Existing source login flow; no new credential capture |
| Permission denied to a supported local asset | `permission_denied` | 403 | Fix permissions, not missing data |
| Installation/store temporarily unavailable, lock timeout | `source_unavailable` | 503 | Public reason and bounded retry hint |
| Request/body/export quota exceeded | `resource_limit_exceeded` | 413 | Reduce selection or raise explicit configured quota |
| Unexpected source failure | `source_operation_failed` | 500 | Preserve cause server-side; no claim of no mutation |

The 422 mappings are a deliberate change from current delete 405 and raw null/404 ambiguity. 405 remains appropriate for an actual unsupported HTTP method, not a supported route on a source with no capability. Update tests and release notes in one hard cut. An aborted client uses AbortError/cancelled operation state locally; do not invent a stable nonstandard HTTP status. A server may have committed work before the response connection closes; receipts and settled outcomes, not cancellation alone, determine what changed.

Keep existing route names listed in README, including `/api/v1/conversation-payload`, `/conversations/.../raw`, evidence and batch endpoints. Add capabilities to existing source metadata. Workspace removal stays on existing validated source server functions bound by the same contract; it does not need a new public API endpoint. A single normalized text request can add the shared format/options to the existing normalized export route; do not create a parallel renderer route. The CLI `bin/spiracha.ts` is absent from this archive and must be restored from the real checkout before its migration is implemented/tested.

### 8.2 Validation details

Move common validation into portable functions, separating storage locations (local-only) from public request fields. Preserve the archive's existing ID length 2,048, requested batch size 200, path length 4,096, maximum timestamp 9,999,999,999,999, payload conversion limit 25 MiB, and HTTP payload request-body limit 64 MiB. List limit continues to clamp to 200 as currently documented unless explicitly changing it; reject non-positive/non-integer values. Validate batch size before deduplication to bound input work. Trim only request IDs where the current ID validator explicitly permits it; do not normalize an ID's case or decode it twice.

Require nonempty IDs, reject embedded path traversal according to source validators, reject malformed percent encoding, and encode UI/API path segments exactly once. `a/b ?#é` must round-trip where the source ID syntax permits it; a source's stricter native ID format can reject it without exposing paths. Cwd exact/descendant semantics remain those of `path-match.ts`; relative paths are invalid for the public scoped query. Time bounds are inclusive as existing source helpers specify; both known null timestamps and filter behavior receive fixtures. No runtime availability probe may mutate source data.

Request option defaults, selector validation, capabilities and errors must be equal through API, direct local SDK and HTTP SDK. Server functions cannot accept more permissive shapes than API. Public response/declaration builds must include new types deliberately through current exports, not wildcard exports of server binding internals. Add all supported export controls to CLI help, including the separate normalized/evidence/raw distinction; do not bring back removed commands or aliases.

## 9. Mutation contract and source safety

### 9.1 Per-item outcomes

Replace fail-fast `mapWithConcurrency` deletion aggregation with a settled, bounded executor that preserves request-order results and all successful effects. Target result envelope has operation ID, requested IDs, affected IDs, results, and summary counts. Per-item union:

```ts
type DeleteOutcome =
    | { status: 'deleted'; id: string; affectedIds: string[]; deletedFiles: string[]; coveredBy: string | null }
    | { status: 'missing'; id: string; affectedIds: []; deletedFiles: [] }
    | { status: 'cleanup_pending'; id: string; affectedIds: string[]; deletedFiles: string[];
        receiptId: string; failures: CleanupFailure[] }
    | { status: 'failed'; id: string; affectedIds: string[]; deletedFiles: string[];
        effect: 'none' | 'partial' | 'unknown'; error: PublicOperationError; receiptId: string | null }
    | { status: 'cancelled'; id: string; affectedIds: []; deletedFiles: [] };
```

The named error/cleanup types are to be defined in `operation-types.ts`; do not copy this snippet into production with unresolved aliases. `deleted` means all requested source-owned phases for that item completed. `cleanup_pending` means logical deletion committed but post-commit phases remain, with actionable recovery identity. `missing` means no logical target and no pending authorized cleanup; a missing row with an existing receipt must reconcile and cannot be reported simply missing. A thrown unknown source error must report effect unknown, not default none. Paths in UI/API results follow existing authorized local exposure policies; use source asset descriptions when a private path need not be public.

`coveredBy` handles an explicitly observed source cascade affecting another selected ID. Do not count a child as independently deleted twice or silently report it missing after its parent succeeded. Discover source-authorized cascades under the source lock, report actual affected IDs, and never infer cascade ownership from a parent-looking string. Each original requested ID receives exactly one result; deduped duplicate requests are documented in request metadata, not duplicated mutations.

Default per-source concurrency preserves current values until tests justify change: Claude Code 4; OpenCode 2; every other source 1. This is scheduling concurrency, not permission to bypass store locks. Batch executor catches per-item exceptions and awaits every started operation. Abort stops scheduling new items and labels only unstarted work cancelled; it cannot undo committed items. Validate all requested IDs/capability/scope before any mutation. Mixed results return a 200 batch outcome envelope, not an HTTP exception that discards earlier successes. Single failed/unsupported/missing operations use the error table; single cleanup-pending returns a successful transport with explicit pending result, not a boolean success.

### 9.2 Durable mutation protocol

For non-atomic multi-store deletion, capture exact ownership and intent before the first destructive write. A receipt contains version, operation ID, source/account/store identity, exact requested/affected IDs, selected cleanup policy, captured native file identities, and enough logical keys to replay after primary rows vanish. It contains no open-ended directory glob or arbitrary client path. Use private permissions, a bounded receipt size, temporary write+fsync+atomic rename+directory fsync, and a source-scoped cross-process Spiracha mutation lock. OS process checks are additional fail-closed checks, not a lock honored by an external app.

Replay revalidates ownership and file identity, skips already removed targets, preserves siblings, and leaves a receipt on any unresolved phase. Mark completion only after all required phases and cache invalidations have succeeded; completion-marker cleanup must itself be idempotent. Do not overwrite journals or add a generic new journal over an existing proven protocol. Cancellation after durable intent means the authorized operation may still require reconciliation; the UI must say so.

Keep source-code worktrees untouched. Never recursively remove a user project path because it appears as cwd, workspacePath, a message path, or a tool workdir. Follow existing source-specific options such as Codex rollout retention. Source file symlinks/hardlinks and ownership mismatches fail closed before destructive access. A discovery helper that converts malformed JSON or read failure into an empty collection is suitable for tolerant browsing only, not destructive ownership proof.

### 9.3 Command Code protocol to implement

Preserve current route/table/server behavior. In `command-code-db.ts`, factor strict deletion discovery from `listCommandCodeSessionCleanupFiles`; validate the requested native session ID; enumerate exact `.jsonl`, `.meta.json`, `.checkpoints.jsonl` ownership under the configured projects root. Existing cleanup scans the same ID across project directories, so explicitly capture every replica path and its regular-file identity under the lock. Do not infer that another session belongs to the delete because a record's `parentId` references it; parser parentId currently enforces in-file record order.

Keep current no-symlink/nlink=1 checks and revalidate immediately before unlink. Reject concurrent source changes observed after intent planning, retain any already committed effects, and explain that Spiracha's SQLite file-mutation lock is not an external Command Code writer lock. Implement fail-closed stopped-writer checks only for processes that can be reliably identified from source configuration; unknown process-check results reject destructive work. Do not guess process names or kill the app from Spiracha.

Add a private source-root receipt through the existing file-mutation-lock boundary. Persist all targets and their identities before sidecar removal. Deletion order remains sidecars before transcript so the final transcript absence is meaningful, but every successful unlink is accumulated. A failure at any phase returns failed/partial or cleanup_pending as appropriate with receipt; repeated same-ID calls resume even if the main transcript is gone. Restore paths only through an explicitly designed recovery action, not rollback by fabricating deleted content. MUT-CC tests inject failure after each unlink and kill/restart after intent and every destructive phase.

### 9.4 Qoder deletion algorithm to implement

Create `qoder-mutations.ts` with a strict discovery planner, apply function and reconciliation function. Do not put SQL deletion into the normalizer or add a broad “delete workspace directory” fallback. Reuse configured locations from `qoder-adapter.ts` and verified native ID validation; raw `enableAcp: false` behavior provides a useful precedent for avoiding live socket-generated ownership.

1. Acquire the Qoder source mutation lock and require a reliable stopped-writer state for supported desktop/CLI stores. If the machine cannot establish it, return mutation_conflict before writing. No ACP command is used to delete live remote state.
2. Open the existing configured global database with its schema checks. Strictly parse matching `ItemTable` values for `lingma.chat.localHistory.<...>.quest` and `aicoding.questTaskListSnapshot`. Malformed/unknown required structures stop the operation. Do not create an empty replacement database when the configured file is missing.
3. Resolve exact selected session IDs and documented aliases from `parseLocalHistoryRows`/`parseTaskSnapshotRows`: executionSessionId, designSessionId, task ID, and `.session.execution` aliases. Build an ownership graph of history records, task references, workspaceStorageId, persisted `chatEditingSessions/<id>/state.json`, and CLI transcript paths. Record every matched owner. Do not treat a task containing another independent design/execution session as exclusively selected.
4. Produce a mutation plan containing the exact JSON array/object locations to remove/update, original values/digests, owned native files, and unaffected sibling references. History arrays lose only selected exact records. Task snapshots retain a task while any unselected session still references it; remove only selected session references when the schema has a validated representation for that. If the current schema cannot represent that safe edit, fail before mutation with an ownership conflict and fixture evidence; do not silently delete the entire task. A task can be removed only when every owned conversation reference is within the explicit affected-ID set.
5. Re-read/compare the original values under a write transaction; reject concurrent modification. Write back only changed `ItemTable` entries, preserving other entries and unselected record fields. Do not delete a shared key merely because one history record matched. SQL callbacks stay synchronous; async file work occurs outside the transaction. A transaction covers only this database, not external files.
6. Persist the durable plan before the database mutation. Commit logical record updates, then unlink only captured, validated per-session state/CLI/checkpoint assets. Native state directory removal is allowed only if it is exclusively owned and empty after allowed file cleanup; never remove workspace storage or the whole shared SQLite file. Revalidate containment, regular-file identity and symlink/hardlink policy on every replay.
7. Invalidate Qoder inventory/list/detail/deferred caches after effects. If cleanup fails after logical commit, return cleanup_pending with the receipt. On restart, use the captured plan to finish without relying on vanished history/task rows. Already removed files are success. Replaced files/changed unselected references block replay rather than broadening deletion.
8. Expose through adapter, common single/batch action controller and confirmation UI. Confirmation names conversation count and whether multiple owned representations are removed. Workspace-wide conversation delete uses the same planner and never deletes a native Qoder project just because its group disappears.

This algorithm fixes the scope of the work; it does not assert that all Qoder native schema variants/alias ownership are proven from this archive. MUT-QD-01 must capture actual fixtures for each reader-supported variant before writes are enabled. Unrecognized ownership remains a runtime safety conflict, not a source-wide unsupported deletion capability or an excuse to skip the baseline work.

### 9.5 Preserve existing recovery behaviors

Codex: keep `.spiracha-deletions` intent semantics, attached-WAL caveat, saved rollout choice, history cleanup by requested ID even after state disappears, global-state cleanup, recovery lock and dry-run behavior from `docs/codex-deletion-recovery.md`.

Cursor: keep `.spiracha-cursor-operation.json`, mutation lock, restart discovery reconciliation, captured workspace/composer ownership, process checks, 8 MiB record bound and committed marker semantics from `docs/cursor-crash-recovery.md`. Do not suppress its recovery error merely to render an apparently empty inventory.

Grok Bot: keep account-specific durable receipts and fail-closed stopped-process checks, roster comparison, replica identity checks, same-ID retry and sibling/account preservation. Read-only inventory must not initiate a new deletion. Shared batching cannot run unrelated account cleanup from a request for one account-scoped ID.

OpenCode: preserve selector validation, shared project ownership, transaction rollback, desktop cleanup retry and empty-workspace behavior. A committed session delete with failed desktop cleanup is not total failure; retain enough worktree/session metadata for restart-safe retry without deleting the source worktree. Preserve specialized workspace recovery/merge logic separately.

## 10. Shared UI action boundary

Introduce the smallest compositional layer: `useConversationActions`, `ConversationRowActions`, `ConversationSelectionActions`, and `ConversationDetailActions`. Reuse `DataTable`, `SelectionActionsToolbar`, `ExportDialog`, `DeleteConfirmDialog`, `export-mutation.ts`, download lifecycle and workspace navigation helpers. Do not make every source use one generic table; keep source columns, trees, filters, analytics, recovery and deferred-body panels.

The controller input contains the literal source/surface descriptor, a stable row-ID accessor, a required query-key/invalidation binding, and typed operations derived from declarations. The UI binding must provide all applicable actions without optional callbacks that quietly disappear. Nonapplicable actions appear in the operation info/help metadata with a reason; menu placement can omit them, but a user must be able to understand why original raw/removal is unavailable. A supported action with runtime missing data is disabled with the runtime reason, not hidden as a nonexistent capability. The server still rejects unauthorized/impossible requests.

Selection is a set of canonical IDs scoped to source + workspace/account/in-memory inventory key. Sorting and pagination preserve it. Filtering preserves hidden selected IDs and visibly states `N selected (M outside this view)`; the user can clear all. Select-all means **currently visible selectable page rows** and is labeled that way, with indeterminate checkbox state. Do not silently select descendants in source trees; a separately labeled subtree action may select explicitly enumerated descendant IDs. Changing the inventory identity clears selection. A refreshed authoritative membership snapshot removes vanished IDs; a merely filtered page is not proof that an ID vanished.

At menu/dialog opening, capture candidate IDs. At confirmation, snapshot ID order, full expanded export/deletion options and source/scope identity into an immutable operation request. Later row changes cannot retarget it. For selected IDs that disappear before execution, report missing outcomes. Empty selection disables export/delete submission; double clicks, Enter repetition and overlapping menu submit cannot start duplicate mutations. Use an operation ref/ID in addition to React pending state. Keep cancellation/back actions available while permitted, but do not call cancellation a rollback after mutation begins.

Keyboard/accessibility: checkbox accessible name includes conversation title/ID, header checkbox explains visible-page semantics, menus support keyboard navigation, dialogs trap focus/restore it, cancellation is non-destructive, destructive confirmation has count/scope and focus defaults, errors and partial summaries use an announced status region. Preserve existing focus behavior from dialog primitives instead of hand-building modal overlays.

On settled mutation, invalidate source inventory, affected workspace/global lists, affected detail summaries, deferred transcript/artifact bodies, analytics/search summaries that include them, and any recovery state. Put query-key factories in each exhaustive UI binding; do not maintain a second heuristic prefix list in the controller. Remove deleted details from cache so Back cannot display stale body data. Keep failed/retryable IDs selected; remove fully deleted/missing IDs after authoritative refresh; cleanup-pending rows become a recovery state, not a normal undeleted conversation. Do not retry successful IDs through a “retry failed” button.

After workspace conversation deletion, refresh authoritative workspace inventory and use `workspace-delete-navigation.ts` to determine whether the group still exists. Do not navigate away solely because all rows on the current filtered page were selected. Native removal can navigate only when the native workspace result confirms removal; partial cleanup/recovery remains visible. Row, batch and detail actions all call this same boundary, including the currently duplicated Command Code flows and the new global Grok Bot toolbar.

## 11. Separate Web and Cloud surface policies

### Web imports

Keep `web-chat.ts`'s bounded process-memory store: current 128 MiB retention, 25 MiB/file, at most 20 files and 100 MiB per import request. Do not add local persistence, source registry membership, external provider-account deletion, or network fetching of tool/file URLs. Add in-memory remove-one/remove-many operations returning the same settled outcomes adapted to store IDs. They remove only Spiracha's imported record; never the user's original upload file or remote conversation. Evicted/import-replaced IDs return missing. Label the UI action `Remove imported conversation`.

Web inventory gains visible-page selection, batch normalized ZIP export, individual normalized export and artifact download. Full body reads use the already normalized import store; provider parsing happens once. Artifact content remains exact. Original raw is not applicable because original upload bytes are not retained as an authoritative export representation in this store. The detail Raw/debug tab, where present, is normalized diagnostic JSON, not original raw. Focused evidence can use canonical imported tool events with the same empty/omission behavior. Workspace removal/recovery is not applicable. Web stays on existing UI server functions and `POST /api/v1/conversation-payload` for portable conversion, not new local-source APIs.

### Codex Cloud

Cloud remains authenticated, read-only with the Codex CLI owning login refresh. Add common selection and normalized batch export to the existing environment/project task inventory using read-only task details; keep environment scope explicit in IDs/query keys. Single export uses the shared renderer and preserves task lifecycle/branch semantics. No local workspace deletion, remote conversation deletion, external account modification, or new raw download is introduced. The read-only Cloud surface contract—not a missing local adapter—supports static unsupported mutation metadata. Normalized diagnostic JSON is not original source bytes.

Use an exhaustive `SurfacePolicies` map for `web` and `codex_cloud`, separate from local `SourceCatalog`. UI action composition can accept a discriminated local/Web/Cloud context, but server dispatch must not accept a Cloud/Web context at local storage endpoints. Shared canonical/export types remain portable. Tests use fixture Cloud responses and the real server/browser read path without contacting personal Cloud accounts.

## 12. Release and closeout

The seed's shipped behavior change is limited to raw filename/byte transport and omission-failing registrations; current normalized defaults, deletion semantics, source membership and payload exclusions remain unchanged. Existing consumers that assumed `<source>-<id>.json` must use returned filename/MIME. Internal UI raw DTO callers now use `download_base64`, not `download` with text.

Treat the full target DTO/default/error/CLI migration as a proposed **3.0.0 hard cut**. Do not bump the supplied package version in this seed. When the full migration lands, update public declarations, README, CLI help, persisted export-preference version, release notes and tests in the same release. Reset old UI export preferences with an explanatory notice rather than silently mapping `includeCommentary` to reasoning or retaining both option contracts. Keep existing URL route names; remove superseded internal renderers/projections and aliases after callers migrate.

Completion requires every task/test gate in the implementation and test documents, 90% root and UI line coverage under existing gates, all applicable per-source real-browser fixture journeys, and packaging/portability checks. A catalog entry, compiler pass, source-table render test, or coverage percentage alone is not end-to-end parity. Record actual results and limits; do not mark source behavior verified from metadata or mocks alone.
