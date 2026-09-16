# Contract conformance tests and independent oracles

## 1. Test status and rules

This is the detailed **implementation test plan**, not a report that these tests have all been implemented or passed. Section 11 identifies tests actually added in the seed. See `VERIFICATION.md` for executed commands/results. All storage mutation tests use temporary fixture stores; no personal conversation data is an acceptable acceptance environment.

Use `it('should ...')` descriptions. Unit tests live adjacent to production modules. Put reusable native fixture factories in `src/test-support/conversation-sources.ts`, outside published `src/lib/**/*.ts` files. UI fixtures stay test-only. Every source gets a factory in an exhaustive `satisfies` mapped record; test iteration derives from the tuple. Avoid `any`, double casts, `as unknown as ComponentType`, `.skip`, `.todo`, or an array that silently omits a source. Dedicated compiler fixtures alone use `@ts-expect-error` to test deliberate failures; production errors never get suppressed.

A metadata equality assertion is not proof of behavior. Each fixture has an independently authored expected canonical timeline, available/unsupported operations, filenames, byte arrays and mutation effects. Tests call the actual native parser/adapter and real shared action/export path. A source's native format may not represent every semantic event; encode a per-case evidence-backed absence in the fixture, not a global skip of that source. Common canonical tests still cover all semantic variants.

## 2. Fixture and harness contract

Target factory result fields: literal `source`; absolute `root`; complete explicit `locations`; inventory scope and workspace/account identifiers; at least two visible selectable conversation IDs plus one sibling; source-native bytes/files/SQL setup; independent expected canonical messages/artifacts; expected raw native files or explicit exception; a known absent ID; file/database fingerprints; and `dispose(): Promise<void>`. Return mutable temporary resources only from the factory, not a process-global shared fixture. Use fixed timestamps and stable IDs valid for the source, never current time. `create()` failure must clean partially created roots.

The test fixture type must constrain each source key to its source literal and its scope/capabilities. Require expected normalized export and mutation behavior for every applicable source, not optional callbacks. Test functions may call common helpers, but the helper must receive the actual registry adapter/server/controller under test. Do not implement a fake adapter inside the source fixture and count it as conformance.

Before each destructive scenario, assert every configured store and receipt path is inside that test's realpath-resolved root. Set an isolated home/export directory and explicitly override every relevant location; no falling back to a developer's source default if a location is missing. Create a source-code worktree sibling with sentinel bytes `DO NOT DELETE\r\nπ\n`, plus an unrelated conversation/native-store row. Capture hashes and SQL counts before mutation. Afterward assert selected effects and exact sibling/worktree preservation. Close SQLite handles, browser contexts, HTTP servers and child processes in finally; restore environment variables even on failure. Test runs must not read macOS Keychain or live ACP/Cloud services.

A browser harness starts the real built app/API with isolated locations, not just a component sandbox. Cloud reads use controlled native response fixtures and the existing auth boundary; Web imports use actual fixture uploads. Download assertions read browser-produced files and inspect ZIP entries with `fflate`, rather than trusting a click callback or displayed filename. Native process/crash cases launch isolated test children only and always reap them.

## 3. Registration, compiler and boundary gates

| ID | Arrange / action | Independent required result |
| --- | --- | --- |
| REG-01 | Add a temporary new literal source to the tuple in a compiler fixture without its descriptor | Catalog assignment fails; no successful empty inventory fallback |
| REG-02 | Omit an existing source from storage, UI icon/action or native fixture record | Each missing entry fails normal typecheck, with separate negative fixtures |
| REG-03 | Bind a Grok adapter under the Codex key | Literal source/key mismatch fails, even though handler signatures match |
| REG-04 | Remove required list/detail handler or supported raw/delete handler | Assignment fails at the corresponding operation, not merely a runtime missing callback |
| REG-05 | Put a callable handler on unsupported or not_applicable declaration | Assignment fails for both literal states |
| REG-06 | Supply only exception state, blank reason, nonexistent evidence path, or “not implemented” reason | Type/runtime policy tests reject it; no disabled production capability admitted |
| REG-07 | Omit route metadata or actual inventory/workspace/detail file/registration | Type fixture catches metadata omission; root/build route tests catch real route absence |
| REG-08 | Omit a native payload parser for a payload-supported source | Parser registry fails typecheck; Claude/Command remain explicit exclusions, Web explicit separate parser |
| REG-09 | Build catalog/payload/normalizer entry graph for browser/Worker | No node/Bun/SQLite/Keychain/storage/React/router import in portable graph; exact exclusions asserted |
| REG-10 | Read source metadata and construct deep links for all 13 IDs | Exact known labels/routes/scopes/aliases; each ID equals key; paths unique; Grok Bot only global source; no Web/Cloud/provider IDs |
| REG-11 | URI-encode legal source ID `a/b ?#é` and resolve UI/API/spiracha references | One encode/decode round trip; slash remains ID data where source allows; malformed encoding rejects |
| REG-12 | Change a catalog supported state without updating binding/fixture | Compiler or behavior gate fails; a test merely echoing changed catalog data is insufficient |
| REG-13 | Widen a supported literal to a Capability union inside a proposed builder | Dedicated type test exposes loophole; production builder keeps exact indexed literal |
| REG-14 | Run generated route/package graph with an otherwise unused source route deleted | Standard build/conformance fails; file existence alone cannot stand in for served route registration |

Seed coverage: REG-02 partially (storage), REG-03, required-read portion of REG-04, REG-05, reason-field part of REG-06, inventory/detail portions of REG-07, REG-08 and most REG-10/11. Full controller/capability/surface/fixture enforcement is planned, not yet implemented.

## 4. Semantic oracle and export golden cases

### 4.1 Shared semantic fixture

Author one canonical fixture solely for renderer/selector tests, **in addition to** actual native source fixtures. Use these independent IDs/order values and exact bodies:

| Order / ID | Semantic event | Body or evidence |
| --- | --- | --- |
| 0 / `u0` | User, unknown phase | `  keep leading\r\nline two  \n` |
| 1 / `c1` | Assistant commentary, model `model-a` | `Working on it.` |
| 2 / `r2` | Assistant reasoning, available-full | `Reasoning is separate.` |
| 3 / `tc3` | Assistant tool_call | name `exec`, namespace `functions`, call ID `call-1`, input string containing Unicode and embedded backticks |
| 4 / `to4` | Tool tool_output | call ID `call-1`, text `''`, status succeeded, exitCode 0, durationMs 0 |
| 5 / `to5` | Tool tool_output | call ID `orphan`, text `error\r\n`, failed, exitCode 2, no observed call |
| 6 / `f6` | Assistant final_answer, model `model-b` | `Final answer.` |
| 7 / `s7` | System | `System notice.` |
| 8 / `x8` | Unknown role/phase | `Unclassified native content.` |
| 9 / `c9` | Assistant commentary | `Later assistant event.` |

All message timestamps are null except explicit known values on `u0` and `f6`; no test accepts an invented timestamp. Add an artifact `{id:'artifact-1', title:'report.json', content:'{\r\n  "π": [1, 2]\r\n}\n\n'}` and a Markdown artifact containing nested fences and trailing spaces. Add lifecycle/token/search supplemental events separately with stable order coordinates.

Exact selector oracle: `all` selects all ten messages; `last_assistant` selects only `c9`; `last_final_answer` selects only `f6`. Excluding commentary after last_assistant produces no messages, **not f6**. Artifacts remain included when their flag is true, even then. Changing final-only filtering must not change tool evidence pairing or source order in the canonical input.

### 4.2 Canonical and renderer tests

| ID | Arrange / action | Required assertions |
| --- | --- | --- |
| SEM-01 | Mixed text/tool/text native record | Three ordered canonical blocks, stable IDs, not tool content appended after final text |
| SEM-02 | Tool-only user wrapper | Semantic tool output with wrapper provenance; user inclusion flag does not control it |
| SEM-03 | Empty successful output, exit/duration zero | Retained as output; zero not replaced by null; explicit empty-output rendering |
| SEM-04 | Unpaired call; orphan/duplicate/streamed outputs | Each observed event retained; no fabricated call, no textual dedupe; pairing confidence explicit |
| SEM-05 | Two independent turns with identical bodies/native IDs | Both retained; duplicate native IDs disambiguated with stable occurrence; provenance retains native ID |
| SEM-06 | Branch/parent records and interrupted tool turn | Existing source-selected branch only with provenance; no fabricated final answer |
| SEM-07 | Known/equal/null timestamps, model switch | Native order preserved; null remains null; per-message model-a/model-b retained |
| SEM-08 | Full/summarized/encrypted/deferred reasoning | Distinct states; summary not labeled full; never user/final prose |
| SEM-09 | Bootstrap and synthetic records | Correct source classification; default filter documented; diagnostic preset includes them |
| SEM-10 | Malformed or truncated native tail | Parse errors/partial availability explicit; no fabricated message; earlier valid records preserved per source policy |
| SEM-11 | Actual native body >20,000 chars containing `AFTER_4000` and `AFTER_20000` | Full API/UI/export body contains both; preview may shorten but cannot mutate canonical data |
| SEM-12 | Lifecycle/search/token records | Typed supplemental events preserve known fields; token counts not invented from text length |
| SEM-13 | Unknown role/phase/tool status | Unknown remains unknown; no fallback final/user/success classification |
| SEM-14 | Normalize same native representation through storage and payload | Same semantic IDs/order/phase/body/evidence where native inputs are equivalent; machine paths/time not injected |
| EXP-01 | Shared semantic fixture, every individual inclusion flag off in turn | Only that semantic bucket removed; reasoning independent of commentary; tool calls independent of outputs |
| EXP-02 | last_assistant then commentary false | No selected message; f6 not backfilled; artifacts still exact when enabled |
| EXP-03 | last_final_answer on a fixture with no final phase | Empty selected messages; no interrupted-turn completion invented |
| EXP-04 | md and txt same complete options | Same included semantic events and exact body substrings; only wrapper grammar differs |
| EXP-05 | Body with triple/quad backticks, tildes and code strings | Valid wrapper fences longer than contained runs; no source content executed or rewritten |
| EXP-06 | Leading/trailing spaces, CRLF, Unicode, no final newline and two final newlines | No trim/normalization of source bodies; golden wrapper separators exact |
| EXP-07 | Model absent on some messages | Per-message observed model takes precedence; conversation model only fallback label |
| EXP-08 | Metadata false with incomplete/encrypted body | Metadata omitted but completeness disclosure retained; no full-content claim |
| EXP-09 | Deferred preview full-load success/failure | Success includes full source body; failure rejects require_available_full rather than exporting preview silently |
| EXP-10 | allow_partial explicit | Partial body plus concrete omission report; excluded counts separate from missing-body counts |
| EXP-11 | Enabled path transforms | Only normalized presentation changes; canonical DTO, raw bytes and artifact `.content` unchanged |
| EXP-12 | Conversation has no messages but has artifact(s) | Artifacts export/download regardless of selector; no false missing-conversation result |
| EXP-13 | JSON/Markdown artifact content from actual Web/Antigravity parser | DeepEqual exact source string incl whitespace/newlines; TextEncoder bytes identical in individual download/ZIP |
| EXP-14 | Selectors run on full-read data after list returned last_final_answer | Export last_assistant still selects actual c9 rather than the list's f6 |
| EXP-15 | Invalid format/filter boolean/unknown option | Shared validator rejects before store read in UI server/API/local SDK |
| EXP-16 | Same fixture/options through all exposed callers | UI/local SDK/HTTP SDK/API/CLI normalized semantic output and body strings agree; payload agrees where supported |
| EXP-17 | Tool input complete JSON string, output >4k/>20k | Full fields rendered with phase labels, not solely a lossy preformatted text summary |
| EXP-18 | Synthetic/diagnostic preset and supplemental flag combinations | No coupling to commentary or metadata; inclusion report accurately names diagnostic exclusions |

## 5. Actual-source fixture requirements

Every row runs the applicable shared semantic/export/error/list/deletion suites **through its real parser/adapter**. The named starting tests already exist in the archive. Reuse schema builders, not their assertions as the sole oracle. A source-native format without a variant uses a documented format exclusion for that individual variant, while common canonical tests still cover it.

| Source / fixture ID | Native fixture construction and starting tests | Source-specific mandatory assertions |
| --- | --- | --- |
| Antigravity / SRC-AG | Temporary transcript/trajectory stores and artifact records using `antigravity-db.test.ts`, `antigravity-trajectory.test.ts`, adapter/payload tests | Trajectory steps authoritative over generated JSONL; report/artifact strings exact; unknown encryption key surfaced; preview20000/full-body distinction; sibling conversation/project metadata survives delete |
| Claude Code / SRC-CL | Two workspace transcript JSONL sessions and continuation/tool records from `claude-code-db.test.ts` and adapter tests | Tool-only user wrappers not user text; thinking independent; merged lineage IDs/order preserved; raw is physical file; coalesced-session delete scope and siblings; no payload parser accidentally registered |
| Cline / SRC-CN | Temporary task directories and native message/history files from `cline-db.test.ts` and adapter tests | Ask/say/system/unknown distinctions retained; empty/error tool outputs; task deletion preserves sibling task and worktree; original file bytes unchanged |
| Codex / SRC-CX | State/history SQLite + rollout/session-index/global-state fixture from existing adapter/deletion journal tests | Response/event duplicate handling; lifecycle/search/token fields; final vs commentary; fallback/deferred rollout; journal replay and retained-rollout option; project removal never deletes cwd |
| Command Code / SRC-CC | Native session, meta and checkpoints JSONL in two project directories via `command-code-db.test.ts` and adapter tests | Existing select/export/delete controls survive; valid parent chain; same ID replicas correctly scoped; sidecar failures retain prior unlink effects; restart when main transcript vanished; no Claude/Command payload widening |
| Cursor / SRC-CU | Workspace/global SQLite plus agent-transcripts/native replay fixture from `cursor-db.test.ts`, adapter and recovery tests | Native+DB merge duplicates only by supported replay evidence; tool input preserved; CLI-only session; complete deferred bodies; native raw file set not DB dump; journal/recovery preserves other composers/workspaces |
| FX / SRC-FX | Session directory with checkpoint, events and referenced external tool results from `fx-db.test.ts`, adapter/payload tests | Correct checkpoint/event reconciliation; tool markers past20k survive; raw assets exact and contained; missing referenced file explicit; deleting session leaves adjacent data and project checkout |
| Grok / SRC-GR | Native transcript fixtures from `grok-db.test.ts`, adapter and phase tests | Reasoning/commentary distinction, multiple tool blocks, actual final heuristic; extension/MIME preserved; scoped delete and rollback/cleanup behavior documented |
| Grok Bot / SRC-GB | Temporary account roster, replica `.blob`, second chat and second account from `grok-bot-db.test.ts` | Global inventory needs no cwd; account IDs never collapse; real batch toolbar; raw `.blob` bytes/MIME; fail-closed process check; durable same-ID recovery; sibling/account roster preservation |
| Kiro / SRC-KI | History plus nested execution continuation stores from `kiro-db.test.ts`, adapter and phase tests | Integrated transcript retains history/execution provenance; nested discovery; final semantics; raw physical-file coverage; deletion preserves unrelated continuation/session ownership |
| MiniMax Code / SRC-MM | Native session files via `minimax-code-db.test.ts`, adapter/payload/phase tests | Mixed blocks/model switches/complete tool inputs+outputs; source order; exact raw; selected deletion and sibling preservation |
| OpenCode / SRC-OC | Multi-project/session/message/part/event SQLite + desktop-state fixtures from `opencode-db.test.ts`, adapter/payload tests | Think-tag parsing and part order; per-source tool status; raw rejects without exporting shared DB; cascade/coveredBy results; transaction rollback; desktop cleanup retry; shared project/worktree preserved |
| Qoder / SRC-QD | Strict ItemTable history arrays/task snapshots, persisted state, CLI and mock ACP via `qoder-db.test.ts`, transcript/adapter tests | Exact aliases/ownership; live ACP not original raw; reasoning/final semantics; two sessions sharing task retained correctly; malformed shared JSON refuses writes; committed logical delete + file failure returns receipt and replays safely |

Use three selectable IDs only where the source's native schema can represent them; choose native-valid IDs from existing helpers. The common suite refers to them as `first`, `second`, and `sibling`, not by assuming every source accepts arbitrary UUID strings. Add source IDs with special characters specifically in parsing/reference tests where that native format permits them. All workspace fixtures include a descendant cwd and unrelated cwd; Grok Bot runs the corresponding global scope/error cases.

### Source list/query oracle

QUERY-01: includeMessages false does not hydrate bodies or invoke ACP/Keychain; counts/summary fields stay meaningful. QUERY-02: exact cwd matches itself, descendant mode matches only real descendants, never a string-prefix sibling such as `/repo2`; path case/platform rules follow existing helper. QUERY-03: inclusive time boundaries and null timestamp policy consistent across native list implementations; check Command Code specifically rather than assuming generic index filtering compensates. QUERY-04: keyset pagination with tied update times and special IDs returns every item once and respects stable cursor order. QUERY-05: explicit global source plus cwd and explicit workspace source without cwd reject wrong scope; `sources:'all'` selects applicable scope only. QUERY-06: missing optional application does not crash unrelated source enumeration, but an explicit unavailable-store read returns availability/error rather than fabricated empty content. QUERY-07: cancelled list/full-read frees limiter slots and closes handles. QUERY-08: source removed while paginating yields documented omission, not duplicate/backfilled IDs.

## 6. Original raw, artifacts, archives and resource tests

| ID | Setup / action | Exact expected result |
| --- | --- | --- |
| RAW-01 | Native transport bytes `[0,255,192,65,13,10]` (`AP/AQQ0K`) | Byte equality after base64 decode/Blob; no U+FFFD replacement round trip |
| RAW-02 | Raw names `messages.jsonl`, `replica.blob`, Windows/path traversal/control prefixes | Sanitized native basename, suffix retained; MIME from adapter independent of suffix |
| RAW-03 | Repeated names, case/NFC collisions, preexisting generated `name-2` | Unique deterministic full filenames with suffix before extension; no overwrite; distinct extensions can coexist |
| RAW-04 | Actual API `/raw` GET and local/HTTP client | Same original bytes/native name/MIME; HTTP error mappings distinct; HEAD has no body |
| RAW-05 | Single UI raw server-function response through browser download helper | Exact Blob/FileReader bytes and native filename; no conversion to text |
| RAW-06 | Batch raw ZIP with two `.blob` files and `.jsonl` | Real unzip yields exact native bytes and extension-preserving unique member names |
| RAW-07 | Single raw exceeds configured inline threshold | ZIP download URL, same native member bytes; no unbounded base64 response |
| RAW-08 | Raw request with messageSelector/filter/path transform/lens | 400 before original bytes read; no ignored transformation options |
| RAW-09 | Supported source, existing conversation but native file absent | 409 original_representation_unavailable, not unsupported or conversation404 |
| RAW-10 | OpenCode multi-session SQLite fixture, raw request | 422 exception, no database/file read to export whole store, sibling content never disclosed |
| RAW-11 | Cursor native multi-JSONL files + DB-only conversation | File-set ZIP contains every discovered original; DB-only yields representation unavailable; no bubble JSON synthesis |
| RAW-12 | FX checkpoint/events/referenced tool files | Original members exact; outside-session path rejected; missing referenced asset requires explicit partial-original handling |
| RAW-13 | File changes or is replaced during read | source_changed; no publication claiming consistent snapshot; pre/post identity tracked |
| RAW-14 | Empty original file vs absent file | Empty raw body allowed with native name; absent body reported unavailable, never empty success |
| RAW-15 | Invalid base64, URL creation or anchor failure | Failed once; no fabricated download; object URL revoked whenever created |
| RAW-16 | Filename >180 UTF-8 bytes, reserved Windows name, trailing dots/spaces, HTML/header-like text | Safe bounded basename, preserved legitimate extension/suffix; no header injection/path traversal |
| ARC-01 | Two normalized conversations with equal titles/IDs needing collision resolution | Both entries retained, deterministic request-order names; manifest maps each requested ID |
| ARC-02 | Atomic batch with second conversation missing | No downloadable ZIP published; temp files/reservations gone; complete failure diagnostics |
| ARC-03 | Partial batch with success+missing+failure | Successful members only plus manifest for every requested ID; UI shows partial result, no false total success |
| ARC-04 | Partial batch with zero successes | Error/outcomes, not empty success ZIP; no stale downloadable path |
| ARC-05 | Artifact JSON/Markdown exact strings incl Unicode/CRLF/trailing LF | Direct artifact and ZIP member TextEncoder bytes match; combined transcript adds wrapper only |
| ARC-06 | Large exports concurrently near quota | Admission reserves bytes; no oversubscription; releases reservation on every terminal outcome |
| ARC-07 | Abort before load/during write/ZIP/publication/HEAD backoff | Started work settles, no late anchor, no partial archive leak, all limit slots/paths released |
| ARC-08 | Expired or missing download URL | Existing download lifecycle reports unavailable/expired; never fetch arbitrary filesystem path |
| ARC-09 | URL traversal, symlink export path, token reuse across scope where applicable | Serving layer rejects; authorization/TTL same for HEAD and GET |
| ARC-10 | Create files/directories and inspect permissions on supported platforms | Private permission policy preserved; logs omit body/base64/key content |
| ARC-11 | ZIP read/compression failure | Incomplete ZIP and workdir removed; primary cause preserved; no dangling success URL |
| ARC-12 | Full-body limiter saturation then cancellation | Subsequent requests proceed; no leaked permit or permanently pending UI |

Bun's invalid-UTF-8 fixture tests the transport boundary, not semantic parsing of corrupted JSON. Semantic malformed-input tests use source-specific expected rejection/partial behavior separately.

## 7. Mutation and recovery tests

| ID | Arrange / inject | Required result |
| --- | --- | --- |
| MUT-01 | Valid empty/malformed/oversized/invalid-ID batch | Reject validation before any mutation; max200 applies to input before dedupe |
| MUT-02 | Duplicate IDs in request | One source mutation per unique ID, first-occurrence order preserved; request metadata discloses dedupe |
| MUT-03 | First succeeds, second throws, third missing | All started outcomes retained in order; summary counts correct; failed effect not falsely none |
| MUT-04 | Logical commit succeeds, auxiliary cleanup fails | cleanup_pending with affected IDs/files/receipt; not total failure or unqualified deleted |
| MUT-05 | Cancel before scheduling / after first commit | Unstarted cancelled only; committed result retained; no rollback claim |
| MUT-06 | Parent/child both selected and native authorized cascade | Every requested ID has outcome, coveredBy identifies real cascade; no double count/no arbitrary parent-prefix deletion |
| MUT-07 | Concurrent Spiracha processes on same store | Real source lock honored; bounded wait/retry; no in-memory-only coordination |
| MUT-08 | External source running, process check unavailable/unexpected | Destructive operation refuses where policy requires stopped writer; no guessed success |
| MUT-09 | Symlink/hardlink/replaced owned file, unsafe path | No target outside intended ownership changed; fail closed with actionable conflict |
| MUT-10 | Before-primary SQL failure | Transaction rollback leaves native logical store consistent; retained intent semantics follow source protocol |
| MUT-11 | Kill after intent, logical commit and each auxiliary phase | Fresh process reconciles intended work; second reconciliation is no-op; siblings/worktree unchanged |
| MUT-12 | Corrupt/unknown-version/oversized journal | No broad mutation; concrete failure; valid other intents can proceed only per existing source policy |
| MUT-13 | Main row/file absent but durable receipt pending | Reconcile captured cleanup, not missing; retained receipt on unresolved path |
| MUT-14 | Primary already gone and no receipt | missing, not new broad cleanup based on guessed path |
| MUT-15 | Query refresh/Back navigation after logical delete | No stale normal detail body; cleanup/recovery state visible; retry targets exact |
| MUT-16 | Workspace-wide delete from filtered/paginated UI | Enumerates authoritative group, clearly separate from selected rows; no source-code path removal |
| MUT-17 | Native workspace removal with other group's shared records | Only source-owned selected metadata removed; other group/project/session remains |
| MUT-18 | Source has single-store atomic mutation and declared N/A reconciliation | Fixture demonstrates no postcommit external phases; absence of a retry helper is not sufficient |

Command Code specifics: CC-01 exact three suffixes and same-ID replicas across two projects; CC-02 missing meta/checkpoint idempotent; CC-03 unrelated `id-suffix` session preserved; CC-04 invalid parent chain not treated as ownership; CC-05 unlink failure after each sidecar retains exact earlier deletedFiles; CC-06 main transcript gone + intent resumes; CC-07 changed inode/nlink/symlink refuses replay; CC-08 external-writer check limitations explicitly reflected in error/docs; CC-09 real UI controls reach the already-existing delete operation through the new shared boundary.

Qoder specifics: QD-01 remove one matching history object from a multi-record ItemTable JSON array; QD-02 unselected fields/records byte/semantic preservation outside the changed container; QD-03 shared task design/execution sessions keep unselected session/task; QD-04 task may be removed only when every owned selected reference is captured; QD-05 aliases resolve to correct actual affected IDs without broad suffix matching; QD-06 workspaceStorageId/state path containment; QD-07 CLI-only/persisted-only/both/live-ACP-only ownership states; QD-08 malformed shared JSON causes zero writes; QD-09 compare-and-write rejects source value changes; QD-10 rollback prior to commit; QD-11 file cleanup failure after commit returns durable receipt; QD-12 restart after rows disappear still finishes exact cleanup; QD-13 missing global DB does not create a replacement DB; QD-14 shared project/task metadata and unrelated source-code directory survive; QD-15 no socket/network deletion or app kill is attempted.

Codex preservation: CX-01 keep rollout when requested and preserve choice on replay; CX-02 delete history by requested ID after state row gone; CX-03 simulated split attached-WAL commit repaired by receipt; CX-04 dry-run does not create journal or take mutation action; CX-05 project recovery serialized with pending deletion; CX-06 malformed intents isolated and reported.

Cursor preservation: CU-01 pending workspace removal/recovery replays from captured bucket/composer IDs; CU-02 committed marker cleanup after restart; CU-03 unsafe transcript directory refuses replay; CU-04 own lock plus stopped-app policy, not a claim of external atomicity; CU-05 8 MiB intent bound enforced before writes; CU-06 sibling DB/history/transcript and workspace preserved.

Grok Bot preservation: GB-01 receipt account-scoped; GB-02 process check fails closed; GB-03 original roster row/replica identity compared; GB-04 selected account only; GB-05 normal inventory/read does not start deletion; GB-06 same-ID retry resumes absent-roster cleanup without touching sibling replica.

OpenCode preservation: OC-01 shared project retained while another session owns it; OC-02 native cascade reflected in results; OC-03 transaction rollback; OC-04 desktop cleanup failures retained in retry plan and restart-safe receipt; OC-05 empty workspace removal and recovery preserve source checkout.

## 8. API, SDK, CLI, payload and package tests

API-01: `/sources` metadata for all IDs matches independently reviewed declarations and has no callback/private store path. API-02: supported detail404 vs raw representation409 vs unsupported422 vs runtime503 vs wrong method405. API-03: local/HTTP client returns the same error code, operation, source, ID, retryability and details. API-04: invalid request never invokes adapter. API-05: ID length 2048/2049, batch200/201, path4096/4097, timestamp bounds and invalid numeric booleans. API-06: duplicate/unknown fields, malformed percent encoding, double-encoded traversal, raw transforms rejected. API-07: actual request handler exports md/txt/raw/evidence/ZIP with correct content type/name/bytes. API-08: real mixed deletion route returns all outcomes, not a thrown aggregate that loses success. API-09: abort before scheduling and during an operation reports only what is known. API-10: local locations remain local-only; HTTP cannot request arbitrary server store roots.

PAY-01: every registered native parser calls its pure normalizer; Claude/Command explicit source hints reject as current parser policy. PAY-02: automatic inference chooses correct known input or returns ambiguous/unsupported rather than fabricating records. PAY-03: Web provider payload fixtures cover current Gemini, Meta/Muse, GLM, Qwen, Claude Web and ChatGPT formats actually handled by `web-chat.ts`, including branch/hidden/thinking/tool variants. PAY-04: artifacts are exact strings, not JSON pretty-printing, and survive selectors. PAY-05: supplied path/URL/Keychain-looking strings never trigger I/O. PAY-06: direct portable conversion and POST `/api/v1/conversation-payload` have equal normalized semantic output/defaults. PAY-07: 25 MiB payload converter bound and 64 MiB request-body streaming bound enforce actual bytes even without Content-Length; cancel closes readers. PAY-08: built payload runs in Node/browser/Worker with banned I/O globals/imports trapped. PAY-09: source-native model/ID/report references preserved; malformed payload does not invent final content.

CLI-01: real restored `bin/spiracha.ts` help documents all shared normalized options and raw/evidence differences. CLI-02: stdout raw bytes exactly include invalid UTF-8/NUL; `--output` writes same bytes and never coerces to string. CLI-03: selector/filter conflicts on raw reject before source I/O. CLI-04: list/get/export/evidence run through SDK, no legacy exporter invocation. CLI-05: partial ZIP exit status and diagnostics do not hide written successful members; atomic failure publishes no archive. CLI-06: missing source, invalid scope, and mixed deletion (where CLI exposed) match API contract. PKG-01: package install in a fresh isolated fixture context, public entrypoints/declarations resolve. PKG-02: packaged `serve` serves every registered actual route and API. PKG-03: excluded source/UI test helpers are not published accidentally. PKG-04: CLI and UI import only supported built/source entrypoints, no compatibility shim needed.

The archive's CLI/CI files are absent; these are not tests that can be truthfully marked passed from this packet. Recover real files before implementing/testing this work.

## 9. UI controller tests

| ID | Interaction | Expected controller + backend + UI effect |
| --- | --- | --- |
| UI-01 | Render each source list and detail with its real UI binding | Row/detail normalized export reachable; declared raw/evidence/artifact actions correct; native columns/tree remain |
| UI-02 | Select two rows; sort and change page | Stable selected IDs retained; selected count not tied to row index |
| UI-03 | Filter so one selected row is hidden | Selection retained and hidden count announced; clear-all clears hidden selection too |
| UI-04 | Header checkbox with paging/filter/tree | Only visible selectable page rows selected; indeterminate state; no implicit subtree/all-results selection |
| UI-05 | Change source/workspace/account inventory identity | Selection resets; old dialog/request cannot retarget new source |
| UI-06 | Open dialog, then data changes; confirm | Immutable ID/options snapshot submitted; disappeared item returns missing outcome |
| UI-07 | Empty selection or repeated click/Enter | Empty cannot submit; one operation request only while pending |
| UI-08 | Cancel confirmation | No mutation/backend delete; focus restored to initiating action |
| UI-09 | Confirm mixed batch deletion | Shared operation invoked with exact IDs; successes removed; failed/retryable IDs retained; cleanup receipt visible |
| UI-10 | Retry failed/cleanup-pending | Only intended targets/receipt retried; successful IDs not re-deleted |
| UI-11 | Successful delete invalidation | Inventory/list/detail/deferred/artifact/search/analytics/recovery keys that include target invalidated; stale detail removed |
| UI-12 | Last visible filtered rows deleted but workspace still has hidden records | Stays on existing workspace after authoritative refresh; no premature navigation |
| UI-13 | Actual virtual workspace disappears / native removal confirmed | Correct source-index navigation; empty workspace/recovery result handled, not merely page count |
| UI-14 | Supported operation unavailable at runtime / declared exception | Distinct explanation and disabled/omitted control policy; direct server invocation still rejects appropriately |
| UI-15 | Unmount/abort while export pending | No late anchor or state update; download resources released; mutation effects not falsely rolled back |
| UI-16 | Keyboard/screen reader interaction | Checkbox names, visible-page label, menu traversal, focus trap/restore, destructive count/scope and live status correct |
| UI-17 | Deferred source detail page | Initial summary renders without full hydration; later body/artifact controls preserve states; export explicitly loads full |
| UI-18 | Existing Command Code/Grok Bot/OpenCode/Cursor specialized panels | No regression to export/selection already present; global Grok Bot gains shared actions without workspace; recovery panels remain |

Use an exhaustive fixture record and rendered actual components; do not cast an arbitrary array of source components to a common prop type. Prefer adapter functions that construct each source's real props from the common fixture contract and satisfy a typed binding. A visible button test is necessary but insufficient: assert the exact operation payload and resulting cache/navigation state.

## 10. Real browser journeys and outcome ledger

For each local source: start isolated app → navigate its sidebar entry → open workspace or global list → select first+second → open batch export → choose complete available md ZIP → confirm → inspect actual downloaded ZIP members/manifest and both distinctive body markers → open first detail → export txt and inspect body → exercise raw if supported and inspect bytes or verify explicit exception → cancel delete and compare fixture hashes → confirm first delete → inspect actual source store and refreshed list/detail/cache state → retry a controlled cleanup failure where applicable. Finish with source-specific workspace removal/recovery only for supported native operations, asserting checkout sentinel survives.

The browser harness derives cases from source IDs and requires a per-source native factory and route/action binding at compile time. Do not use arbitrary personal installation directories. Repeat selection with sort/filter/page changes in shared controller/browser cases. Inspection of a downloaded member is mandatory; merely capturing a download event is not enough. Cloud/Web are separate journeys with their declared exceptions, not skipped local-source rows.

| Surface | Required journey | Status at seed delivery |
| --- | --- | --- |
| Antigravity | Full local journey + deferred/encrypted/artifact state | NOT RUN |
| Claude Code | Full local journey + merged physical raw coverage | NOT RUN |
| Cline | Full local journey + task ownership | NOT RUN |
| Codex | Full local journey + project removal/journal recovery | NOT RUN |
| Command Code | Full local journey preserving existing controls + sidecar failure/retry | NOT RUN |
| Cursor | Full local journey + raw native set + workspace recovery | NOT RUN |
| FX | Full local journey + complete tool output/native assets | NOT RUN |
| Grok | Full local journey + independent reasoning | NOT RUN |
| Grok Bot | Global list select/export/delete + account/process/receipt policy | NOT RUN |
| Kiro | Full local journey + integrated history/execution provenance | NOT RUN |
| MiniMax Code | Full local journey + model/tool preservation | NOT RUN |
| OpenCode | Full local journey + raw exception/backend rejection + workspace recovery | NOT RUN |
| Qoder | Full local journey + newly implemented scoped deletion/restart | NOT RUN |
| Web | Import two real payloads → selection ZIP → exact artifact download → cancel/remove imported record; no persistent/remote delete | NOT RUN |
| Codex Cloud | Fixture-authenticated list/detail/batch read exports; mutation/raw explanations and rejection; no external-account write | NOT RUN |

## 11. Seed tests actually supplied

New Bun tests: `source-catalog.test.ts` (3 cases), `raw-export-contract.test.ts` (3), `raw-export-integration.test.ts` (4). Integration cases exercise actual archive creation, real ZIP member bytes, production GET/HEAD download serving, inline threshold behavior and empty selection; they were **not executed here** because Bun/dependencies are absent. Updated `conversation-api.test.ts` adds binary original-raw HTTP regression and changes native-name expectations. Existing source-server/export-dialog UI tests now expect base64/native names; `download.vitest.ts` adds two raw Blob lifecycle regressions. These UI/API/Bun tests need execution in the real environment.

Dedicated `src/type-tests/source-contracts.ts` contains ten compiler-negative assertions plus positives. The supplemental `testing/verify-portable-contracts.mjs` compiled the portable subset and these fixtures with available TypeScript 5.8.3, checked all 13 actual inventory/detail route files and encoded IDs, and tested invalid UTF-8 byte/Blob fidelity plus collision/naming behavior under Node 22.16.0. This is useful executable evidence, but not the repository's declared compiler/Bun, not React/TanStack integration, not native source conformance, and not a coverage result.
