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

## Normalized data

- Required DTO fields are always present. Use `null` when the source has no value for a required nullable field.
- Optional fields use `undefined` only when the field itself is an optional capability or response extension.
- Collections are empty arrays rather than `null` when the collection is known and empty.
- Source adapters retain source-specific raw payloads only on contracts that explicitly expose them. Shared list DTOs stay bounded and do not gain source-native transport shapes.

## Errors and redaction

- Stable HTTP failures use the versioned JSON error envelope with a machine-readable code, a user-facing message, and bounded structured details where useful.
- Invalid input returns `validation_error`; unavailable records return `conversation_not_found`; unsupported source operations return `unsupported_operation`.
- Explicit source requests surface source failures. All-source collection tolerates missing optional integrations but does not turn malformed installed-source data into success.
- UI errors may name a path needed for local diagnosis, but must not include credentials, cookies, session headers, API keys, prompts, or raw provider result streams.

## Delete behavior

- Deletes are source-owned and fail closed when a required writable store cannot be opened.
- Cursor database deletion and transcript-directory deletion are separately controllable. The UI defaults to both; the stable API accepts `delete_session_files`. Preserving transcript directories can cause the conversation to be discovered again.
- Partial filesystem cleanup is reported through `cleanupFailures`; it is not silently treated as complete success.
