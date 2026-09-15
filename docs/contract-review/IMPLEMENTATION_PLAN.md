# Implementation work packages

## How to use this plan

The target contract is `docs/source-adapter-contract.md`; this file supplies dependency order, file ownership, edits, tests and exit criteria. `TEST_MATRIX.md` supplies independent expected behaviors. These are planned changes unless listed in the foundation section. Do not confuse a design decision with a verified native-storage behavior. Storage evidence comes from the supplied archive, not from a live installation or the upstream commit named in the older issue.

Work in dependency order. A phase can be developed on a branch while earlier tests remain unchanged, but do not release an intermediate build with both old and new generic export semantics. Do not delete a specialized source parser merely because its file also contains a renderer. Move the necessary pure parsing/phase logic first, migrate all callers, then delete the duplicate formatting layer. No compatibility exports or alias types remain at closeout.

## A. Seed work already included

| Foundation | Files | Actual effect | Not yet enforced |
| --- | --- | --- | --- |
| FND-01 identity catalog | `src/lib/conversation-data/source-catalog.ts`, `index.ts`, `adapter-helpers.ts`, all 13 adapters | One identity/route/scope/export-name record; route links and source metadata derived; adapter keys exhaustively checked and source literals preserved | Complete operation declarations, runtime availability, storage/UI capability bindings |
| FND-02 UI identity binding | `src/ui/lib/source-icons.ts`, `src/ui/components/app-shell.tsx` | Required icon per source; existing navigation order and Web separation preserved | Per-source action/controller and E2E fixture requirements |
| FND-03 payload registration | `conversation-payload-types.ts`, `conversation-payload.ts` | Required native parser for every currently payload-supported local source; current exclusions retained | Shared canonical normalization/export options across every parser |
| FND-04 capability type pattern | `capability.ts`, `src/type-tests/source-contracts.ts` | Discriminated declaration and literal supported-handler pattern; ten negative compiler fixtures | Runtime metadata matrix and action reachability |
| FND-05 raw fidelity | `raw-export-contract.ts`, `ui-export-archive.ts`, `conversation-api.ts`, `source-session-export-server.ts`, `download.ts`, `export-dialog.tsx` | Original names/extensions; byte-preserving single UI transport; extension-preserving collision-safe ZIP members; focused raw uses the shared path | Native file-set sources, complete resource-state errors, aggregate-byte reservations and every cancellation edge |
| FND-06 executable tests | New catalog/raw/type/integration tests; updated API/UI tests; `testing/verify-portable-contracts.mjs` | Regression tests and an offline subset verifier | Passing full Bun/UI/build/package/browser/coverage gates in this environment |

No mutation algorithm, source data location, normalizer, dependency version, generated route, payload artifact extraction or source membership was changed. No unsupported capability was invented to hide an unfinished operation. Raw/delete adapter members remain optional until REG-02 completes; this limitation is intentional and explicit, not a final design.

## B. Ordered work packages

### REC-01 — Reconcile the real checkout and establish a trustworthy baseline

**Prerequisite:** none. **Owner:** integrating agent before parallel code work.

Read the supplied `AGENTS.md` and `README.md`, then the current real checkout's versions. Compare its Command Code changes with the archive. Preserve any newer implementation and report conflicts file by file; do not use the old issue table as a patch instruction. Record real HEAD and dirty files before applying the seed. The archive lacks `.git`, `.github` and `bin/spiracha.ts`; locate those in the real checkout rather than reconstructing a CLI from documentation. Do not assume the audit commit is the archive version.

Apply either the full supplied source tree or `patches/foundations.patch`, never both. Run the seed tests with the supported Bun/dependency versions and repair any integration/type/lint issue before building on the foundation. Keep package lock/dependency declarations unchanged unless the real checkout requires an explicit dependency update. Capture baseline root/UI coverage and native package smoke outcomes in a versioned verification report.

**Exit:** actual Git baseline recorded; Command Code state reconciled; missing CLI/CI assets recovered or explicitly blocking packaging; no accidental overwrite of user edits; the foundation's own new tests pass in the real runtime. Tests: REG-01 through REG-10, RAW-01 through RAW-07, existing API/UI raw tests.

### REG-01 — Exhaustive identities, fixtures and import boundaries

**Prerequisite:** REC-01. **Files:** current catalog/types; new `src/test-support/conversation-sources.ts`; UI fixture registry; dedicated type fixtures.

Extend identity metadata with scope-discriminated workspace-route information where needed. Derive source validators/reference resolution and export platform names from the catalog; keep source tuple canonical. Add a root route-coverage test that checks every required file route against independently expected paths (seed includes inventory/detail); include workspace routes and actual generated route registration after normal generation. Do not generate a route file by concatenating an unchecked source string in production.

Create exhaustive actual-source fixture factories keyed by source, and UI bindings/fixture maps keyed by the same source type. Factories create isolated filesystem/database data, return explicit configured locations, and clean up deterministically. Use native fixtures already present in adjacent adapter/database tests as the starting schema; move reusable builders into test-only helpers. Do not put fixture imports into a production registry or npm package export graph. Keep independently written expected messages/routes/outcomes separate from catalog-derived iteration.

Add negative compiler fixtures for missing source, mismatched literal ID, absent inventory/detail/workspace binding, missing icon/controller, absent fixture and missing parser. Add portable import-graph tests that fail on storage/React/router dependencies in catalog/normalizer/payload graphs. Test both source and built payload graphs; TypeScript `import type` is acceptable only when compiled runtime graph stays clean.

**Exit:** adding an ID to the tuple makes normal typecheck fail until catalog, bindings, parser decision and root/UI fixtures are supplied. A missing route or new unsupported explanation fails a standard test. No developer-maintained parity list outside exhaustive records controls source coverage.

### REG-02 — Full operation declarations and source bindings

**Prerequisite:** REG-01; source exception evidence can be collected in parallel.

Implement `operation-types.ts`, declaration/value types, reviewed exception evidence, and `source-bindings.server.ts`. Migrate required reads first. Split provider-owned handlers from common orchestration; require literal-state operation bindings with key/source equality. Use `satisfies`, not a widening annotation or whole-registry cast. Add exact runtime validation of serialized catalog entries and a snapshot test of `/sources` derived metadata with independent expected source states.

Add full declarations according to the target matrix only as implementations and tests become available. Qoder delete, Cursor/FX raw, Grok Bot list actions and common exports cannot be marked unsupported to get through this phase. It is acceptable for this development branch not to typecheck until those applicable operations are implemented; it is not acceptable to commit production no-op handlers or `pending` states. For a manageable incremental branch, land required-read binding enforcement first and integrate full-operation enforcement with its dependent implementations in one change set.

Remove optional `getConversationRaw`/`deleteConversation` dispatch from the final adapter type. Replace `Partial`, optional chaining, null-as-unsupported and silent missing-registry fallbacks. Preserve `null` only for a documented *resource* absence where the operation result type permits it. Derive raw eligibility and UI dialog action metadata from declarations; delete the current `RAW_EXPORT_SOURCES`/`isRawExportSource` allowlists when their callers are migrated. Validate malformed operation requests before source I/O.

**Exit:** a supported operation without a provider/common/UI binding fails a compiler fixture; a declared exception with a callable handler fails; unsupported vs absent vs unavailable behavior is enforced by real dispatch tests. No fake exception appears in `/sources`.

### SEM-01 — Canonical type evolution and pure projection

**Prerequisite:** REG-01. **Files:** `types.ts`, `adapter-helpers.ts`, `conversation-events.ts` (new), `message-selector.ts`, evidence types/projector; UI `transcript-view.tsx`.

Add exact text/body-state/provenance/visibility/tool-state/artifact contracts specified in the target. Move generic event ownership out of the Codex-named file. Add canonical validation helpers and a single bucket classifier. Preserve separate supplemental lifecycle/search/token variants; do not flatten analytics events into assistant text. Change `createTextMessage` to preserve empty observed outputs and untrimmed bodies with unit tests before migrating callers. Introduce a full-read semantic boundary so exporters never select from a previously truncated/selected list DTO.

Define stable IDs and ordering at provider normalization, not in the React renderer. Keep unknown timestamps null. Make UI preview projection read-only, including a display-only text truncation view that carries explicit original/body availability. Project tool evidence without dropping call IDs, input/output state, workdir, duration, exit code or model. Preserve existing source hidden bootstrap policy and phase heuristics in one pure owner.

**Exit:** canonical validator and projection tests demonstrate every role/phase, repeated/orphan/empty tools, interruption, model switch and partial body; generic UI imports no Codex-owned event/filter module. Existing source-specific analytics retain equivalent typed fields.

### SEM-02 — Migrate every native normalizer and portable parser

**Prerequisite:** SEM-01. Use the source-specific migration ledger below. Migrate one source end to end per reviewable commit: native parser → canonical → UI projection → normalized/evidence/payload output. Native parser and source-specific phase extraction survive; duplicate generic conversion does not.

Add actual native fixture goldens before changing normalizers. Compare API and UI canonical projections for the same fixture, including long output and null time fields. Payload-supported sources feed supplied JSON/JSONL into the same pure semantic function without filesystem/database/network/Keychain access. Do not silently add Claude/Command portable parsers; their explicit decision remains excluded until deliberately implemented. Web provider artifact strings retain exact body identity.

**Exit:** all 13 local sources, applicable Web providers and Cloud feed the common model; every parser registration has a native fixture and independently expected semantic outputs. There is no `*-transcript.ts` generic role/filter renderer left active alongside the common renderer.

### EXP-01 — One normalized options/parser/renderer

**Prerequisite:** SEM-01, enough SEM-02 fixtures to prove each semantic variant; final exit requires every source.

Implement strict portable option expansion, independent flags, named presets, selector-first/filter-second behavior, complete-body policy and omission report. Replace `conversation-data/markdown.ts` with the shared rendering implementation and an explicit md/txt dispatcher, not two different source pipelines. Reuse portable fence/model/path utilities where correct. Add exact-body/no-trim tests before deleting duplicated source renderers. Metadata display is separate from completeness warnings. Preserve artifacts independent of selectors and direct downloads byte-exact.

Thread options through UI/server/API/client/CLI and `convertConversationPayload`/the existing payload endpoint. Remove `includeCommentary`→reasoning coupling and tool preview caps from all export callers. UI compact toggles expand to independent underlying values. Document the target defaults and persisted preference reset in the proposed major release. Do not silently translate old API option names while claiming the old contract was removed.

**Exit:** exact options produce equivalent canonical inclusion and body content through UI download, local/HTTP SDK, direct HTTP and CLI. Golden md/txt outputs cover >4,000 and >20,000 characters, backticks, CRLF, Unicode, empty messages and artifacts even with no selected message.

### EXP-02 — Shared packaging, partial exports and bounded downloads

**Prerequisite:** EXP-01, REG-02 dispatch shape.

Make `conversation-zip-export.ts` and UI source-export helpers call one archive orchestrator with packaging and failurePolicy separate from normalized options. Consolidate Codex's useful partial-export manifest into the shared schema. Atomic publishes nothing on any failure; partial includes successes and every requested-item outcome; zero success returns an error. Preserve selected order independent of completion order and collision handling independent of filesystem case.

Add byte reservation/admission to `ui-export-files.ts` and existing runtime limits. Bound read concurrency and aggregate memory; honor cancellation before/after body loads, directory writes, ZIP creation and publication. Reuse existing TTL/private permissions; do not broaden access to arbitrary temp paths. Publish an export URL only after the complete archive is present. Remove partial files and reservations on failure; retain completed archives according to TTL. Object URLs revoke on all terminal paths, and stale/unmounted operations never trigger a download.

**Exit:** resource/cancellation tests cover every phase, quotas include concurrent in-flight exports, mixed failures retain names/diagnostics, native artifacts remain exact ZIP members, no source implements its own ZIP workflow. Existing download lifecycle tests and new browser download inspections pass.

### RAW-01 — Complete native raw policy and transport parity

**Prerequisite:** seed; target metadata/error portions depend on REG-02 and EXP-02.

Keep the seed's byte/base64 path and native filename fix. Add bound/reserved-name sanitization and traversal/header edge tests. Introduce raw file collection only for sources that actually have multiple native assets. Cursor factors native JSONL discovery out of `cursor-db.ts` and never exports shared DB rows. FX enumerates only source-owned session assets actually used by the parser; treat missing references explicitly. Preserve original file bytes in native-file ZIPs, with the generated manifest separately identified. OpenCode's raw exception receives a concrete multi-session SQLite fixture proving that the whole DB must not be exported and no native original exists in this reader format.

Wire raw operations through typed capability checks, including UI runtime availability on supported sources without a file. Extend raw MIME/representation metadata deliberately. Reject all normalized selectors/transforms. Check source file identity before/after read and fail on changes rather than claiming snapshot consistency. Retain raw/no-ACP behavior for Qoder, account scope for Grok Bot, and resource-specific Antigravity/Claude/Kiro coverage.

**Exit:** byte array equality for single API/local/HTTP client/UI Blob and ZIP members; `.jsonl` and `.blob` unchanged; native multi-file members faithful; unsupported OpenCode distinct from resource-unavailable Cursor; no reconstructed JSON or entire shared DB advertised as raw.

### MUT-01 — Settled mutation boundary

**Prerequisite:** REG-02 result types. Can be developed independently of normalized rendering.

Implement a bounded settled executor, per-item mutation outcomes, effect tracking, receipts and request-order aggregation. Validate the whole batch before scheduling. Preserve current per-source concurrency values and locks. On abort, await started operations and report unstarted ones cancelled; never discard successful mutations because a sibling threw. Normalize source cascade/alias results under the owning source lock and record coveredBy rather than counting deletion twice.

Adapt existing provider results without losing cleanup failures, deleted files/IDs, native retry plans or receipt identities. Keep source-specific mutation functions authoritative. Remove generic AggregateError-as-public-result handling from UI routes; convert only private errors to the new DTO at one source boundary. Add full local/HTTP parity tests including thrown failures after a successful item.

**Exit:** single/batch result fields unambiguously distinguish deleted, missing, failed/partial/unknown, cleanup_pending and cancellation; retry controls never repeat successful targets or broaden scope.

### MUT-02 — Per-source safety/recovery audit and Command Code hardening

**Prerequisite:** MUT-01. **Files:** source mutation modules, existing deletion docs and tests.

For every source, write the owned-store phase map: logical primary store, auxiliary stores, lock/process policy, commit point, precommit rollback, postcommit cleanup, restart replay and worktree/sibling exclusions. Mark a recovery exception only when a fixture proves there is no non-atomic follow-up phase. Preserve Codex/Cursor/Grok Bot durable journals and OpenCode recovery semantics. Add missing durable cleanup retention when the audit discovers an independently committed later store.

Command Code is not a missing feature to recreate. Add strict ownership planning, stopped-writer checks that can be reliably evidenced, a private durable intent and per-unlink effects to the existing function. Fail closed on unknown writer state; never guess process commands. Cover duplicate session ID replicas across project directories, sidecar absence, invalid parent chain and sibling sessions. Resume from intent when transcript discovery no longer finds the main JSONL. Use the target protocol; do not replace its file-mutation lock with an in-memory mutex.

**Exit:** source phase map has no unknown release cells; crash/failure tests prove all declared reconciliation promises. A source-code worktree sentinel remains byte-identical after every destructive fixture scenario.

### MUT-QD-01 — Qoder strict ownership fixtures before writes

**Prerequisite:** REC-01; before MUT-QD-02.

Use existing `qoder-db.test.ts`, storage readers, session transcript tests and adapter fixtures to materialize each reader-supported native structure: shared history arrays, task snapshot folders/tasks, execution/design aliases, persisted state and CLI transcripts. Add an ownership-only planner test suite without writes. Expected plans list exact selected records/files and exact preserved siblings. Unknown schema, malformed shared JSON, shared task with an unrepresentable partial edit, inconsistent aliases or source changes must fail safely.

Explicitly test one task with two independently owned sessions and two workspaces sharing a project record. Planning must not delete the shared task/project to remove one conversation. Require exact validated task-edit shape before permitting a shared record update; this is a focused native-schema evidence gate, not a hand-waved parser fallback.

**Exit:** plans for every known variant are deterministic, bounded, explainable and independently asserted. Ambiguity yields a typed runtime conflict and zero writes. Store identities and containment checks are captured before deletion is enabled.

### MUT-QD-02 — Qoder transaction, cleanup, recovery and actions

**Prerequisite:** MUT-QD-01, MUT-01.

Implement the algorithm in the target contract in a dedicated `qoder-mutations.ts`. Persist intent before mutation, compare original shared values under transaction, update only selected native record references, commit, then clean captured native files. Preserve unrelated JSON fields/records and entire shared database/workspace storage. Add restart replay based on intent, not on rows already deleted. Bind the adapter and shared row/detail/batch controls. A reliable process/ownership conflict remains a runtime refusal; no source-level unsupported excuse is added.

**Exit:** real temporary SQLite/filesystem tests, crash/replay tests, backend errors and complete Qoder browser journey pass. Ordinary supported fixture sessions can actually be deleted; a blanket refusal is not a valid implementation.

### UI-01 — Compose common actions and selection semantics

**Prerequisite:** REG-02 operation metadata; EXP/MUT services ready for integration.

Build controller and row/selection/detail action components with required typed bindings. Migrate one representative workspace source (Command Code already has the relevant controls) and Grok Bot's global inventory first. This proves the boundary handles both scopes without fake workspaces. Move only orchestration; retain table columns, trees and source-specific panels. Map current query-key factories from `src/ui/lib/*-queries.ts` into exhaustive invalidation bindings. Grok Bot's route-local keys must gain the same explicit binding.

Then migrate every source's workspace/global list and detail routes. Selection uses stable source/context IDs, visible-page select-all, coherent hidden selection counts, immutable confirmation snapshots, duplicate-submit guards, accessible menus/dialogs and retry-only targets. Preserve source-specific pending/recovery panels. Native workspace removal binds only its allowed sources; authoritative inventory refresh decides empty-workspace navigation. Do not use current-page emptiness as proof of workspace removal.

**Exit:** exhaustive UI fixture map covers all local sources; actual controls invoke actual shared controllers/typed source operations; no optional action callback hides an applicable operation; all UI-xxx tests pass.

### SUR-01 — Web and Cloud surface migration

**Prerequisite:** SEM/EXP services and UI controller.

Web: implement in-memory remove-one/remove-many, common single/batch normalized export and selection; retain bounded import store and exact artifacts. Use imported IDs rather than original provider IDs for store lookup. Eviction races yield missing. Raw source upload and external deletion remain not applicable; no persistence/network fetch is added.

Cloud: bind read-only detail and batch normalized export to current task/environment lists. Preserve CLI-owned auth refresh, task lifecycle/branch/provenance and Cloud query keys. Represent mutation/raw exceptions explicitly with reachable explanations, not an absent UI callback. Fixture HTTP responses must model auth absent, environment mismatch, deferred task data and disappeared task. No live Cloud destructive calls exist.

**Exit:** separate exhaustive surface policy map, both surface UI journeys, payload-provider no-I/O tests, and no new entries in `CONVERSATION_SOURCES`.

### API-01 — API/SDK/CLI/public declarations and package

**Prerequisite:** canonical/export/mutation services integrated; actual CLI recovered.

Move request option validation and operation error mapping into shared portable helpers. Derive source metadata; retain current endpoint paths. Implement shared normalized format/options on existing normalized routes and payload conversion route. Local SDK and HTTP SDK share full options/results/errors; malformed input tests reach real handlers, not fetch mocks only. Preserve scope and pagination semantics.

Update thin CLI to call `spiracha/client` only, map flags to shared options, validate raw-vs-normalized conflicts before I/O, and write raw bytes directly to stdout/file without implicit text decoding. Batch outputs return ZIP and meaningful partial outcome exit behavior: success 0, request/setup failure nonzero, partial batch with failures nonzero while preserving any written archive and outcome summary. Document exact selected exit code constants in CLI tests rather than scattering literals. Do not reintroduce removed legacy/MCP/plugin commands.

Update built declarations/import exports. `spiracha/payload` must execute in Node, browser and Worker with I/O traps; packaging smoke must run the published entrypoint and its real routes from an isolated installation. Never use personal default source directories in smoke fixtures.

**Exit:** packaged CLI/serve/API smoke and public import/declaration fixtures pass; all gateways expose identical semantics; new error/default changes have release notes; restored CLI provenance recorded.

### GATE-01 — Browser conformance, cleanup and release closure

**Prerequisite:** every prior package.

Add a real-server/browser fixture harness driven by the exhaustive source map. Install/use a browser-test runner only through the repository's supported Bun dependency workflow; the supplied archive has no existing browser parity runner or CI config to assume. Add `test:conformance` for native/service conformance and `test:e2e` for real browser journeys; wire them into CI and document commands in AGENTS. `bun test` and `typecheck` must already enforce registry fixtures, independent of optional E2E invocation.

Run every registered source's navigate → list → select two → ZIP inspection → detail export → cancel delete → confirm delete → refreshed-state journey. Include source-specific safe workspace/recovery cases, raw/native-set/error cases and Web/Cloud policies. Close every started browser/server/child process in finally and verify isolated fixture roots. Coverage alone is not a substitute.

Search and remove superseded registries, renderers, generic filtering code, action orchestration, export options and raw allowlists; use the retirement checklist below. Run final gates, review all diffs and reread the original issue. Record per-source outcomes and actual coverage. No unresolved applicable matrix cell or skipped parity fixture qualifies as completion. Propose the major version only when this release is complete.

## C. Source-by-source semantic migration ledger

All adapter paths are `src/lib/conversation-data/<source>-adapter.ts`. Retain the native reader and pure source interpretation, but route their results into the one canonical model.

| Source | Native/canonical starting points | Specific semantics that must survive | UI/export paths to consolidate |
| --- | --- | --- | --- |
| antigravity | `antigravity-db.ts`, `antigravity-transcript-contract.ts`, `antigravity-transcript-events.ts`, `antigravity-message-normalizer.ts` | Trajectory authority, step ordering, generated transcript merge, artifact IDs/report references, encryption state, deferred/full bodies | Detail deferred queries/projection and export callbacks; do not lose artifact controls |
| claude-code | Adapter's block conversion, `claude-code-db.ts`, `claude-code-transcript-phase.ts` | Coalesced sessions, tool-only user wrappers, thinking, source phase heuristics, branch/model provenance | `claude-code-transcript.ts`, UI transcript-events helper and list/detail export mutations |
| cline | `cline-db.ts`, adapter conversion, native message/task parsing | Ask/say distinctions, tool statuses, task metadata, unknown/system entries | `cline-transcript.ts` and source-specific event/export wiring |
| codex | `codex-messages.ts`, `codex-transcript-records.ts`, `codex-thread-parser.ts` | Hidden bootstrap, response/event duplicates, task lifecycle/search/tokens, phase-aware final answers, interrupted turns | Generic ownership in `codex-browser-types.ts`, `codex-transcript-renderer.ts`, `codex-browser-export.ts`; retain analytics/source extraction |
| command-code | `command-code-db.ts` already emits normalized messages | Valid parent chain, stable native IDs, session/checkpoint sidecars, independent phase filtering, complete tools | `command-code-transcript.ts`, `src/ui/lib/command-code-transcript-events.ts`; preserve current action/deletion work |
| cursor | `cursor-db.ts`, `cursor-message-normalizer.ts`, `cursor-transcript-phase.ts` | Shared bubbles/native replay merge, source-specific dedupe only, tool evidence, CLI-only sessions, deferred bodies | `cursor-transcript.ts`, UI event conversion and source export callbacks; preserve recovery |
| fx | `fx-db.ts`, `fx-messages.ts`, `fx-transcript-phase.ts` | Checkpoint + event reconciliation, external tool outputs, original turn order, partial raw payload markers | `fx-transcript.ts`, UI event/projection/export logic |
| grok | `grok-db.ts`, adapter conversion, `grok-transcript-phase.ts` | Reasoning versus commentary, mixed tool blocks, tool result identity, native phase behavior | `grok-transcript.ts`, source event and route exports |
| grok-bot | `grok-bot-db.ts`, adapter conversion, payload parser | Global/account-scoped identity, replica/roster association, original blob, no workspace fabrication | Global index actions and detail exports; keep stopped-process deletion/receipt UX |
| kiro | `kiro-db.ts`, adapter conversion, `kiro-transcript-phase.ts` | History/execution separate origins and integrated lineage, nested execution discovery, actual final-phase logic | `kiro-transcript.ts`, UI conversion and duplicated route export logic |
| minimax-code | `minimax-code-db.ts`, `minimax-code-messages.ts`, phase helper | Mixed native blocks, native tool status, complete output, model switches | `minimax-code-transcript.ts`, source UI event/route export logic |
| opencode | `opencode-db.ts`, `opencode-message-normalizer.ts`, `opencode-think-tags.ts`, phase helper | Message/part ordering, thinking tags, tool call/output evidence, parent/child session scope | `opencode-transcript.ts`, `src/ui/lib/opencode-transcript-events.ts`; preserve workspace recovery/cleanup |
| qoder | `qoder-storage.ts`, `qoder-session-transcript.ts`, `qoder-transcript-parser.ts`, phase helper | Persisted/CLI/ACP provenance, task aliases, available versus live-only bodies, final-phase heuristic | `qoder-transcript.ts`, UI conversion/export; add safe deletion without losing ACP read behavior |

For each row, adapt the existing `conversation-payload-<source>.ts` parser when present. A pure normalizer may need to be moved out of a storage-heavy module first. Do not import an entire DB module into payload merely because it exports a convenient parser function. Web and Cloud use their own native readers and the same semantic/export contracts without local adapter membership.

## D. Retirement and hard-cut checklist

Delete repeated labels/scopes/routes/export-name maps already replaced by the seed; do not reintroduce them. At final integration remove the raw allowlists, optional supported callbacks, source-specific generic render/filter functions, generic Codex-owned event aliases, separate API/UI normalization branches, route-local selection/mutation/download/invalidation orchestration, and the old UI export option shape. Keep only source-specific native parsing, metadata extraction, safety, analytics, columns/tree layout and deferred/recovery panels.

Search anchors before closure: `Partial<Record<ConversationSource`, `getConversationRaw?.`, `deleteConversation?.`, `TOOL_OUTPUT_PREVIEW_LIMIT`, `4000`, `4_000`, `includeCommentary`, `includeTools`, `rawExport`, `sourceFromSessionRoute`, `ThreadEvent`, `render*Transcript`, `zipArchive`, `as unknown as ComponentType`. A search hit is not automatically wrong: display-only preview limits and genuinely source-specific types can remain, but each retained hit needs a documented owner/reason. Production suppressions and compatibility aliases are not acceptable retention reasons.

Update README's current behavior, AGENTS onboarding, source exception evidence, API/SDK declarations, CLI help, payload examples, download names, artifact identity, cancellation and deletion recovery docs. Add a breaking-change document describing default inclusion, independent reasoning/tools, raw return names/representation, unsupported/missing HTTP distinction, mutation result union and batch failurePolicy. Do not advertise the full contract in the release until source fixtures and browser journeys prove it.

## E. Verification commands and evidence format

Required inherited gates:

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

After GATE-01 adds the new scripts, also run `rtk bun run test:conformance` and `rtk bun run test:e2e`. Record exact command, runtime/dependency versions, exit code, log path, fixture-root isolation, root/UI coverage and all 13 source + Web/Cloud outcomes. “Not run” is not “passed.” A mocked UI assertion does not prove downloaded bytes or backend mutation. A current missing CLI/runtime is an environmental/input blocker, not a reason to assert package success. The seed's verification record is separate and intentionally reports these limits.
