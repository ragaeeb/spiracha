# Data and runtime conventions

These rules define the boundary between source-specific discovery and Spiracha's shared API/UI layers.

## Paths

- Adapters own source-specific path inference. A source path may be absolute, encoded, absent, or meaningful only to its native client.
- Shared path matching is lexical and separator-aware. It supports exact and descendant matching without filesystem access, canonicalization, or symlink resolution.
- Portable display helpers may recognize POSIX, Windows drive, and UNC forms. They must not reinterpret a source path using the host operating system's path rules.
- Stable API `cwd` filters are absolute-path selectors. Callers that require symlink equivalence must provide the canonical source-recorded path.

## Configuration

- Environment variables are reserved for operational controls users may need to change across installations: source locations, diagnostics, ports, cache lifecycle, and export lifecycle.
- Parser limits, concurrency ceilings, cache entry counts, retry timing, and schema versions remain code constants unless they represent a supported operational contract.
- Boolean environment flags use exact `0` and `1` values. Numeric lifecycle controls are non-negative safe integers. Invalid configured values fail loudly.
- Development cache bypass disables both reads and writes. It does not delete existing entries; `clearUiCache()` is the explicit programmatic reset.

## Collection and pagination

- `include_messages` is opt-in for list requests. When message bodies are requested, `message_selector` defaults to `last_final_answer`; detail requests default to `all`.
- List limits are positive integers capped at 200. Pagination uses opaque keyset cursors ordered by update time, source, and conversation ID; clients must pass `next_cursor` back with the same filters.
- `updated_after_ms` and `updated_before_ms` are applied before the final page is returned. `cwd` matching is lexical and does not inspect the filesystem.
- All-source collection may skip unavailable optional integrations. An explicit `source` request preserves that source's failure so callers can distinguish absence from a broken requested integration.

## Normalized data

- Required DTO fields are always present. Use `null` when the source has no value for a required nullable field.
- Optional fields use `undefined` only when the field itself is an optional capability or response extension.
- Collections are empty arrays rather than `null` when the collection is known and empty.
- Source adapters retain source-specific raw payloads only on contracts that explicitly expose them. Shared list DTOs stay bounded and do not gain source-native transport shapes.
- Raw transcript export passes through a standalone source `.json` or `.jsonl` file byte-for-byte. It does not apply message selection, continuation merging, filtering, normalization, formatting, or redaction. Database-only sources return no raw export because constructing one would violate this contract.
- Normalized messages always carry `toolEvidence`; use `null` for messages without structured tool data. Evidence pairing must report `exact`, `ordered_fallback`, or `unpaired` rather than inventing call IDs.

## Web imports

- Web imports are a UI-only workflow. They are not members of `CONVERSATION_SOURCES`, the stable API, the CLI, or focused-evidence inputs.
- The parser accepts mapping-based ChatGPT-style exports, native Claude and Grok shapes, and generic role/content message arrays. Provider labels use content and model metadata before file-name hints and may resolve to ChatGPT, Claude, Gemini, Grok, Qwen, GLM, Amazon Nova, DeepSeek, Mistral, or Perplexity; otherwise the label is `Unknown`.
- Assistant reasoning is retained as separate normalized reasoning events. Embedded provider tool and research records become normalized tool-call/tool-output events only when the source exposes enough structure; the parser does not invent missing identifiers.
- The UI validates at most 20 files per import, 25 MB per file, and 100 MB total. Successful files remain available when another selected file is malformed or unsupported.
- Imported normalized conversations are retained in process memory up to 128 MB, with oldest entries evicted first. A server restart clears them. Detail IDs are generated opaque values; a source-provided conversation ID is retained separately as metadata.
- Web detail loading is split: metadata is available first and normalized transcript events load after browser hydration. The Parsed JSON tab exposes normalized data, not a byte-for-byte copy of the uploaded source file.

## Errors and redaction

- Stable HTTP failures use the versioned JSON error envelope with a machine-readable code, a user-facing message, and bounded structured details where useful.
- Invalid input returns `validation_error`; unavailable records return `conversation_not_found`; unsupported source operations return `unsupported_operation`.
- Explicit source requests surface source failures. All-source collection tolerates missing optional integrations but does not turn malformed installed-source data into success.
- UI errors may name a path needed for local diagnosis, but must not include credentials, cookies, session headers, API keys, prompts, or raw provider result streams.

## Caching and loading

- UI JSON caches are private, versioned, age/byte bounded, and safe to invalidate by key prefix. `SPIRACHA_UI_CACHE_BYPASS=1` bypasses both reads and writes; it does not remove existing entries.
- Claude Code, Kiro, and Cursor discovery use bounded indexes with in-flight request coalescing. Transcript caches are keyed by source-file identity and invalidated after source mutations or changed-file detection. Raw provider payloads are not persisted in these caches.
- Large UI documents are not part of the initial metadata path for Cursor and Antigravity detail routes. Web detail routes likewise load normalized transcript events after hydration. Codex rollout metadata reports `available`, `deferred`, or `missing` so the UI can choose a bounded preview, full load, or export path.
- Temporary UI export files are private downloads subject to age and total-byte pruning. Export and cache lifecycle settings are operational controls; parsing and safety limits remain code constants.

## Package and server boundaries

- The root `#package-metadata` import is the validated package metadata boundary for the UI. Missing or malformed homepage/version metadata fails loudly.
- TanStack server functions keep Bun-only database imports on the server boundary. Browser-safe transcript phase/filter modules may be imported by client adapters; database readers must not cross into browser bundles.
- The `spiracha` CLI is an API-driven thin client. Use `spiracha serve`, `spiracha list --cwd <path>`, `spiracha get <ref>`, `spiracha export <ref> [--raw] [--output <path>]`, and `spiracha evidence <ref> --lens <file> [--output <path>]`; no arguments print help. Applications should import the Bun SDK from `spiracha/client` instead of shelling out.
- Bun 1.4.0 or newer is required. `bun start` is the UI development server; `bun run build` emits bundled client/server output consumed by `spiracha serve`. The package has one runtime dependency (`fflate`); UI/build/test tooling is development-only.
- Markdown remains deterministic generation and domain parsing. Bun 1.4's `Bun.markdown` was evaluated but is unstable for this contract and is not used.

## Delete behavior

- Deletes are source-owned and fail closed when a required writable store cannot be opened.
- Codex deletion removes database rows, session-index entries, and structural Codex Desktop Recent/sidebar references together. It preserves unrelated text that merely mentions a deleted ID and sets a deleted-thread write-block flag so the desktop client does not recreate the reference.
- Cursor database deletion and transcript-directory deletion are separately controllable. The UI defaults to both; the stable API accepts `delete_session_files`. Preserving transcript directories can cause the conversation to be discovered again.
- Cursor writes require Cursor to be closed. Workspace cleanup can return a bounded opaque retry target after the database mutation commits; filesystem paths stay server-side and retry targets expire after a short TTL.
- Partial filesystem cleanup is reported through `cleanupFailures`; it is not silently treated as complete success.
