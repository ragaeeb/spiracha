# Bun client reference

Import `createConversationClient` and `SpirachaClientError` from
`spiracha/client`. This entrypoint imports Bun storage modules even in HTTP mode;
it is not a browser SDK. Use `spiracha/payload` for portable in-memory conversion,
or call HTTP directly from a runtime that cannot load Bun modules.

```ts
import { createConversationClient, SpirachaClientError } from 'spiracha/client';

const local = createConversationClient({ mode: 'local' });
const http = createConversationClient({
    mode: 'http',
    baseUrl: 'http://127.0.0.1:3000',
});

try {
    const page = await http.listConversations({
        cwd: '/absolute/project',
        sources: ['codex'],
        includeMessages: true,
        messageSelector: 'all',
        limit: 100,
    });
    console.log(page.data, page.meta.nextCursor);
} catch (error) {
    if (error instanceof SpirachaClientError) {
        console.error(error.status, error.message);
    } else {
        throw error;
    }
}
```

The factory defaults to local mode. It does not start a server. HTTP `baseUrl`
must be an http/https URL; the client appends `/api/v1/...` beneath any existing
path prefix. Pass the server root, not an already suffixed `/api/v1` URL. The
client has no configurable request timeout, AbortSignal, credentials, or custom
fetch option in this version. The packaged server remains loopback-only and has
no remote authentication.

## Operations

| Method | Successful result | Missing or unsupported result |
| --- | --- | --- |
| `listSources()` | `ConversationSourceInfo[]` | Static registry, not an installation check |
| `listConversations(options)` | `{ data, meta: { hasNext, nextCursor } }` | Empty page; source failures may throw or be suppressed in all-source mode |
| `getConversation(options)` | `ConversationDetail` | null for recognized missing conversation |
| `exportConversationMarkdown(options)` | Markdown string | null for recognized missing conversation |
| `exportConversationRaw(options)` | `{ blob, fileName, mimeType }` using the native name and original MIME (`application/json`, `application/x-ndjson`, `application/octet-stream`, or `application/zip`) | null if no standalone original exists; HTTP `original_representation_unavailable` is mapped to null |
| `exportConversationEvidenceMarkdown(options)` | `{ markdown, meta }` | null for recognized missing conversation |
| `exportConversationsZip(options)` | `{ blob, fileName, mimeType: 'application/zip' }` | null if any requested conversation is missing |
| `deleteConversation(options)` | Delete result with IDs/files and optional cleanup failures | See mode distinction below |
| `deleteConversations(options)` | Aggregate and per-ID delete results | See mode distinction below |
| `resolveConversationRef(ref)` | `{ source, id }` | null for an unrecognized reference |

There are ten methods on `ConversationClient`; `convertConversationPayload` is a
separate named export, not a client method. `listSources()` returns the supported
registry without testing whether any application is installed or readable, and
without advertising raw/delete capabilities.

List selection defaults to `last_final_answer`, list bodies are opt-in, and the
default page size is 100 (maximum 200). Detail and Markdown default to `all`.
Focused evidence always loads all messages and applies its lens; it does not use
`messageSelector` as a pre-filter. ZIP export accepts one source, explicit IDs,
`exportConversationsZip` is atomic for the requested ID set: any missing id
yields no archive (HTTP 404 / local null). Partial UI batches are a different
producer and record mixed `entries` in `spiracha-manifest.json`. An empty
`sources: []` list filter is an empty page in both local and HTTP modes and is
not serialized as `source=`.

A returned download contains a Blob, not a Blob alone:

```ts
const result = await local.exportConversationRaw({ source: 'codex', id: 'example-id' });
if (result !== null) {
    // Choose the destination deliberately; exports can contain sensitive text.
    await Bun.write('/absolute/private-destination/transcript.jsonl', result.blob);
}
```

## Locations and mode differences

Factory `locations` supply defaults for local operations. A per-call `locations`
object replaces that default object; fields are not merged. Unspecified fields
in the replacement fall back to each source resolver. HTTP rejects `locations`;
configure the running server's environment instead. SDK options use camelCase,
while HTTP query parameters use snake_case. Page metadata is normalized back to
camelCase by the SDK.

Operation parity does not mean identical validation. HTTP validates route IDs,
batch size/shape, booleans, timestamps, and absolute cwd, and deduplicates batch
IDs. Local calls enter storage adapters directly and can have different error
classes or missing-record results. Always supply valid IDs, a positive integer
limit, and the correct workspace/global scope; do not depend on local coercion.

HTTP deletion maps recognized 404 `conversation_not_found` and 405
`unsupported_operation` responses to null. A local missing delete can return an
empty delete-result object instead; unsupported local deletion returns null.
Batch deletion can fail after side effects, so neither null nor an exception is
a universal rollback signal.

## Errors and references

HTTP network failures, malformed response JSON, missing required envelope fields,
and unrecognized HTTP errors throw `SpirachaClientError`. Its public fields are
`name`, `message`, and `status`; status may be null when there is no meaningful
HTTP status. It does not preserve API `error.code` or structured `details`.
Local adapter exceptions are not uniformly wrapped in this class. A random 404
HTML page is an error, not a missing-conversation null.

Reference resolution only parses recognized URL/deep-link shapes. It does not
fetch the URL, authorize its host, or prove the referenced record exists. Read the
resolved conversation separately. Bare IDs and relative UI paths are not accepted
as references. Raw export is byte-preserving and does not apply settings or
message selection; its availability is not guaranteed merely because detail
loading succeeds.

Implementation: `src/client.ts` and `src/lib/conversation-data/types.ts`.
