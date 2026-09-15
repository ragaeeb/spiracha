# Stable HTTP API reference

The packaged local server exposes `/api/v1`. Requests must target a loopback host;
browser Origins must pass the local-origin guard. There is no remote
authentication. JSON responses use `Cache-Control: no-store` and
`X-Content-Type-Options: nosniff`.

## Endpoints and bodies

| Method and path | Input | Success |
| --- | --- | --- |
| `GET /sources` | None | `{ data: ConversationSourceInfo[] }`; registry, not availability |
| `GET /conversations` | List query parameters below | `{ data: ConversationDetail[], meta }` |
| `POST /conversation-query` | JSON list options below | Same list envelope |
| `GET /conversations/:source/:id` | Optional `message_selector` | `{ data: ConversationDetail }` |
| `GET /conversations/:source/:id/export` | Optional `message_selector` | Markdown download |
| `GET` or `HEAD /conversations/:source/:id/raw` | No message selector | Original file bytes; HEAD omits the body |
| `POST /conversations/:source/:id/evidence` | `{ lens, generated_at? }` | `{ data: { markdown, meta } }` |
| `POST /conversation-payload` | `{ payload, source?, file_name?, message_selector? }` | `{ data: ConvertedConversation[] }` |
| `DELETE /conversations/:source/:id` | Optional `delete_session_files` | `{ data: DeleteConversationResult }` |
| `POST /conversations/delete` | `{ source, ids, delete_session_files? }` | `{ data: DeleteConversationsResult }` |
| `POST /conversations/export` | `{ source, ids, message_selector?, output_format? }` | ZIP download containing Markdown |
| `GET /resolve` | `ref` URL/deep link | `{ data: { source, id } }` |

The Codex UI event stream has a separate handler; it is not one of the
`ConversationClient` methods. The full DTO definitions are in
`src/lib/conversation-data/types.ts`. Required nullable fields are present as
null; optional extensions may be omitted. HTTP page metadata is
`{ has_next: boolean, next_cursor: string | null }`.

## List and query options

| HTTP GET field | POST field / alias | Meaning |
| --- | --- | --- |
| `cwd` | `cwd` | Nonempty absolute path, at most 4096 characters; workspace scope |
| `source` | `sources` / `source` | GET comma-separated source names; JSON also accepts an array or the string `all` |
| `include_messages` | `includeMessages` / `include_messages` | GET true only for `true` or `1`; JSON requires a boolean |
| `message_selector` | `messageSelector` / `message_selector` | `all`, `last_assistant`, or `last_final_answer` |
| `limit` | `limit` | Positive integer; default 100; values above 200 are clamped |
| `cursor` | `cursor` | Opaque cursor from the preceding page |
| `updated_after_ms` | `updatedAfterMs` / `updated_after_ms` | Inclusive lower epoch-millisecond bound |
| `updated_before_ms` | `updatedBeforeMs` / `updated_before_ms` | Inclusive upper epoch-millisecond bound |

JSON numbers must be actual finite numbers, not numeric strings. Timestamps must
be safe integers from 0 through 9,999,999,999,999. When both a camelCase field and
its snake_case alias are supplied, camelCase takes precedence. Unknown fields
are not a substitute for supported options; this version does not generally
reject every unknown list field.

Omit `source` for all sources in the requested scope. For GET, use omission rather
than `source=all`; the literal `all` is supported in JSON, not the comma-separated
GET parser. Omit `cwd` for global scope (currently Grok Bot). Explicit workspace
sources require cwd, and explicit global sources cannot be mixed into a workspace
query. The cwd absolute check uses the server host's path rules; lexical matching
does not resolve symlink aliases. Empty cwd is invalid, not global scope.

```bash
curl --fail-with-body 'http://127.0.0.1:3000/api/v1/conversation-query'    -H 'Content-Type: application/json'    --data '{"cwd":"/absolute/project","sources":["codex"],"includeMessages":true,"messageSelector":"all","limit":100}'
```

Lists default to `last_final_answer`; bodies are omitted unless requested. Grok
Bot lists remain roster-only even when bodies are requested. `last_assistant`
selects the assistant message with highest `order`; `last_final_answer` restricts
that search to `phase: final_answer`. It does not fall back to commentary or
reasoning. An empty selected array does not mean the conversation is absent.
Equal orders keep the first encountered candidate. `all` preserves input order.

## Pagination and completeness

Results sort by update time descending, then source and ID ascending. Timestamp
filtering treats a missing update time as zero; cursor ordering also normalizes
invalid/negative timestamps to zero and floors finite positive timestamps. Keep
the same filters and pass `next_cursor` unchanged until `has_next` is false.

```ts
import { createConversationClient } from 'spiracha/client';
const client = createConversationClient({ mode: 'http', baseUrl: 'http://127.0.0.1:3000' });
let cursor: string | null = null;
do {
    const page = await client.listConversations({
        cwd: '/absolute/project', sources: ['codex'], limit: 100, cursor,
    });
    for (const conversation of page.data) console.log(conversation.id);
    cursor = page.meta.nextCursor;
    if (!page.meta.hasNext) break;
} while (cursor !== null);
```

This is keyset traversal, not a frozen multi-request snapshot. Concurrent edits
can move records across the cursor boundary; use a new traversal when completeness
matters. Old offset cursors are unsupported. All-source collection logs and
suppresses adapter errors, including malformed installed data; query explicit
sources to diagnose incompleteness. `/sources` does not test installations.

## IDs, raw downloads, and batches

Read/detail, Markdown, evidence, and raw routes accept a decoded nonblank ID
of at most 2048 characters at their common option parser, followed by any source
validation. DELETE and batch ID sets additionally require an ASCII letter/digit
first, then ASCII letters, digits, `.`, `_`, `:`, or `-`, with at most 256 total
characters and no `..`. These are distinct contracts, not a universal ID rule.
Batch IDs are trimmed and deduplicated in first-occurrence order. The input array
must contain 1–200 entries before deduplication. Native storage identifiers can
have broader rules, so a value accepted internally is not automatically accepted
by the HTTP route.

Raw export rejects every query parameter (including message selectors) and returns
source bytes without parsing, merging, redaction, or selection.
Its Content-Type is `application/json` or `application/x-ndjson`, including a
Grok Bot replica whose native extension is `.blob`. HTTP filenames use
`<source>-<id>.json`; local client raw filenames can retain the native name.
Missing records and records without a supported standalone raw file both return
404 `conversation_not_found`. The UI Raw/Parsed JSON view can be normalized data
rather than this original-file contract.

```bash
curl --fail-with-body 'http://127.0.0.1:3000/api/v1/conversations/export'    -H 'Content-Type: application/json'    --data '{"source":"codex","ids":["example-a","example-b"],"message_selector":"all","output_format":"md"}'    --output conversations.zip
```

ZIP export accepts one source and Markdown only. Any missing ID returns 404 with
the missing IDs in `error.details`; no partial archive is returned. This is
all-or-error response behavior, not an atomic snapshot of mutable source files.
The source-specific Codex UI batch export is a different workflow and can produce
a partial archive with `spiracha-manifest.json`. Download names use UTF-8
`Content-Disposition` encoding. Review an error response before treating an output
file as a valid ZIP.

Batch deletion is not transactional. Normal mixed deleted/missing results return
200, all-missing results return 404, and an adapter exception can produce 500 after
earlier operations committed. Inspect cleanup results and source-specific durable
recovery state. `delete_session_files=false` is honored by the Cursor stable
adapter, not by every source; the Codex stable adapter always deletes rollouts.

## Conversion and evidence

The payload converter limits decoded/serialized payload data to 25 × 1024 × 1024
UTF-8 bytes. The HTTP JSON request envelope has a separate streamed cap of
64 × 1024 × 1024 bytes, allowing for string escaping and wrapper fields. A payload
below the envelope cap can still exceed the converter cap. Both currently return
400 `validation_error`, not 413. Converter errors include
`error.details: { field: 'payload', code: '<converter-code>' }`.

Payload field aliases include `fileName`/`file_name` and
`messageSelector`/`message_selector`, with camelCase precedence. Conversion is
independent of storage and does not add imported conversations to the Web UI.
Evidence takes a validated lens and loads the full normalized conversation.
The HTTP evidence body accepts only `lens` and optional `generated_at`; it rejects
unknown fields, including `generatedAt`. The SDK uses `generatedAt` and maps it
to HTTP `generated_at`. When supplied, this must be a canonical ISO timestamp;
keep it fixed when reproducible output is needed. Payload conversion also rejects
fields outside its documented allowlist. Do not generalize list/query alias or
unknown-field behavior to these endpoints.

## Error envelope

```json
{"error":{"code":"validation_error","message":"Request body must be JSON."}}
```

`details` is optional and depends on the failure. Do not parse human message text
as a stable machine protocol.

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `validation_error` | Invalid options, body, selector, source, ID, lens, or payload |
| 403 | `origin_not_allowed` | Stable handler rejected browser Origin/loopback URL |
| 404 | `conversation_not_found` | Missing conversation, unresolvable reference, unavailable raw file, or missing batch IDs |
| 404 | `not_found` | Unrecognized stable route shape |
| 405 | `method_not_allowed` | Known route with wrong method; `Allow` identifies handlers |
| 405 | `unsupported_operation` | Source has no stable delete operation |
| 500 | `internal_error` | Handler exception; client message is generic and server logs contain diagnostic context |

The production wrapper can reject an Origin with a plain-text 403 before the
stable handler runs, and non-API assets/download routes have their own responses.
Do not assume every server error is this JSON envelope. Only the raw stable route
explicitly adds HEAD here; do not infer OPTIONS/CORS support from the endpoint list.

## Reference resolution

Use absolute URLs, for example `http://127.0.0.1:3000/threads/example-id`,
`codex://threads/example-id`, or
`spiracha://conversation/codex/example-id`. Recognized source detail paths, the
`/conversations/<source>/<id>` shape, and supported stable detail/export/evidence
paths are also parsed. Optional `/app` path prefix handling exists. Bare IDs,
relative paths, Web-import IDs, and stable `/raw` URLs are not universal accepted
references. Resolution parses URL structure without fetching it, checking its host
identity, or proving the record exists. Retrieve the result separately.

Implementation: `src/lib/conversation-api.ts`, `src/lib/conversation-data/index.ts`,
and `src/lib/conversation-data/pagination.ts`.
