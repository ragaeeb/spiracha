# Supplied-payload conversion reference

This describes the checked-in implementation.
`spiracha/payload` is the portable, compiled entrypoint; `spiracha/client` is
Bun-only even when its client uses HTTP. Conversion reads only supplied values:
it does not follow paths, query a database, contact a source app, or populate the
Web UI's import store.

## Inputs and support

`convertConversationPayload({ payload, source?, fileName?, messageSelector? })`
returns `Promise<ConvertedConversation[]>`. Supply a parsed JSON object/array,
JSON text, or JSONL text. `fileName` is a provider hint, not a path to open.
JSON text is attempted before JSONL. An initial BOM and blank JSONL lines are
tolerated; malformed JSONL records are not silently skipped.

Explicit native hints support Antigravity, Claude Code, Cline, Codex, Cursor, FX, Grok,
Grok Bot, Kiro, MiniMax Code, OpenCode, and Qoder, plus the payload-only `dot` and `web` parsers. **Command Code
is not a payload source.** Claude Web exports are separate and supported.

Claude Code payloads are the raw session JSONL lines (or the parsed array). Each
distinct `sessionId` becomes one conversation whose `id` is that session ID; lines
without a session ID attach to the preceding session. The local adapter and the
payload parser share `claude-code-events.ts`, so entry, phase, title, model and
workspace rules match. Without a hint, a payload containing Claude Code session events
is parsed as Claude Code before other inference, because those lines also fit Qoder's
broader session-ID shape. A live database path, encrypted store, or index without its required
message bodies is not a self-contained export.

Versioned dot exports are claimed before broad inference and malformed records fail closed.
Without a source hint, remaining native parsers run first: one match wins, multiple matches
are ambiguous, and no matches lead to Web inference. Native parser rejection
during inference is not a user-visible diagnostic for every attempted parser.
An explicit hint can expose why that particular parser rejects the payload; it
does not create support for missing records or unsupported sources.

## Supported input shapes

| Source | JSON data supplied by the caller |
| --- | --- |
| dot | Versioned `dot/transcript/v1` visible-message JSONL with a session header and coverage metadata; see the contract below. |
| Web | The same provider exports accepted by the Web tab: ChatGPT mappings, Claude `chat_messages`, native Grok exports, generic role/content messages, and multi-conversation exports. Gemini `raw_payload` retains embedded reports and citations. |
| Codex | Rollout JSONL records (`session_meta`, `response_item`, `event_msg`, `turn_context`), parsed record arrays, or a Codex Cloud task/turn containing transcript events. |
| Cline | Session JSON containing `session_id`, `workspace_root`, and `messages`; bare message arrays can use `source: 'cline'`. |
| Grok | CLI session JSON containing `chat_history`, or native typed transcript records. |
| Grok Bot | Schema 1 transcript replica JSON. Optional `roster` and `rosterRows` supply names/group membership; missing roster data remains unknown. A roster alone cannot supply a transcript. |
| Kiro | Session JSON with `history` and embedded message bodies, optionally including execution data. |
| Qoder | CLI message records with `parts` and native provider/session markers, or ACP `sessionUpdate` records. Generic CLI message arrays can use `source: 'qoder'`. |
| Cursor | Composer JSON with inline conversation bubbles; separate bubble records must be included in the supplied data. Bare role/content agent logs require `source: 'cursor'`. |
| Antigravity | Decoded trajectory entries/steps and any inline artifact bodies. Encrypted protobuf bytes or artifact paths alone are insufficient. |
| MiniMax Code | Session snapshots with `displayMessages`, or native message-log records; indistinct logs can use `source: 'minimax-code'`. |
| OpenCode | Session exports containing message metadata and inline parts, including tool state. |
| FX | Checkpoint/history and event data, with externally stored tool-result bodies included in a `toolResults` mapping. |

These are payload contracts, not new export formats. The SDK cannot recover content that is absent from the supplied JSON. Source-specific examples and negative cases live in the adjacent `src/lib/conversation-payload-*.test.ts` files; the installed-package matrix is in `src/lib/conversation-payload-test-helpers.ts`.

## Validation and size

The maximum is **25 MiB (26,214,400 UTF-8 bytes)**, both for a supplied string and
for the serialized parsed JSON value. Only JSON-representable values are accepted:
cycles, undefined values, functions, symbols, bigint, and non-finite numbers are
invalid. Parsing and serialization are in-memory operations; the byte limit is
not a promise of an equal heap limit.

HTTP `POST /api/v1/conversation-payload` separately limits its request envelope
to 64 MiB. JSON escaping and envelope fields count there. Passing that outer check
does not bypass the converter's 25 MiB check. Envelope overflow uses HTTP **413**;
converter failures use HTTP **400** with outer `validation_error` and the converter
code in `error.details`.

## Errors

Import `ConversationPayloadError` from the same entrypoint as the converter.
Catch by class/code rather than matching human messages.

| Code | Interpretation and next step |
| --- | --- |
| `invalid_input` | Check option types, selector, JSON-representable values, and size. Reduce or correct the supplied value. |
| `invalid_json` | Repair JSON/JSONL syntax; a broken line is not a partial import. |
| `unsupported_source` | Choose a supported source or a different export workflow. A source hint cannot enable Command Code. |
| `unsupported_format` | No supported payload shape was found. Supply a supported self-contained export. |
| `ambiguous_source` | More than one native adapter matches. Supply the known native `source`. |
| `malformed_payload` | A recognized shape lacks valid required contents. Re-export or include the missing message/tool data. |

```ts
import { ConversationPayloadError, convertConversationPayload } from 'spiracha/payload';

try {
    const results = await convertConversationPayload({
        payload: { messages: [{ role: 'assistant', content: 'Hello' }] },
        source: 'web',
    });
    for (const result of results) console.log(result.markdown);
} catch (error) {
    if (error instanceof ConversationPayloadError) {
        console.error(error.code, error.message);
    } else {
        throw error;
    }
}
```

## Identity, selection, and fidelity

Result IDs reuse a source ID when available; otherwise the implementation hashes
`JSON.stringify` of the parsed value plus the conversation index. Object key
ordering and changes to a multi-conversation input can therefore change generated
IDs. They are opaque identifiers, not canonical semantic-content hashes.

`messageSelector` defaults to `all`. Selection acts on normalized message order,
not timestamps. `last_final_answer` can produce an empty message array. Artifacts
remain in `artifacts` and are appended to Markdown independently of this message
selection. An empty selected transcript is not an artifact-redaction control.

`artifacts[].content` is the embedded report body; `markdown` includes conversation
material as well. The converter does not provide a general secret scrubber.
Preserve an original export separately when exact source-file fidelity matters:
normalization is not a round-trip serialization of every source field.

Implementation: `src/lib/conversation-payload.ts`,
`src/lib/conversation-payload-types.ts`, and the source-specific `src/lib/conversation-payload-*.ts` modules.

## dot visible transcript exports

`source: 'dot'` accepts a supplied `dot/transcript/v1` JSONL export (or the same
records as a JSON array). This is a payload-only format, available through
`spiracha/payload`, the Bun client converter, and `POST /api/v1/conversation-payload`.
It does not register a local source, discover transcript stores, fetch attachments,
read credentials, or retain a UI import. Obtain records through a supported
user-visible conversation export. It is not an export of hidden/internal history.

The first record is a session header:

```json
{"schemaVersion":"dot/transcript/v1","type":"session","source":"dot","sessionId":"room-id","name":"Example Dot","model":"configured-model","modelSource":"user-configured","exportedAt":"2026-10-14T20:00:00Z","coverage":{"scope":"visible-room-messages","complete":false,"messageCount":1,"earliestMessageId":"message-id","latestMessageId":"message-id","description":"Only available messages exported"}}
```

Subsequent records are messages:

```json
{"schemaVersion":"dot/transcript/v1","type":"message","sessionId":"room-id","id":"message-id","role":"assistant","timestamp":"2026-10-14T19:00:00Z","text":"Visible reply","replyToId":"parent-message-id","attachments":[{"id":"file-id","name":"report.pdf"}]}
```

Header `name` is required. The optional `model` must be paired with
`modelSource: "user-configured"`; `coverage` must be an object
and is preserved without asserting completeness. Coverage requires exactly `scope`,
`complete`, `messageCount`, `earliestMessageId`, `latestMessageId`, and `description`.
Session, message, and attachment records reject unrecognized fields; attachment
metadata permits only `id`, `name`, `mimeType`, and `size`, never content or blobs. `messageCount` must match the supplied records;
`earliestMessageId` and `latestMessageId` match timestamp/ID-sorted boundaries.
`scope` must be `visible-room-messages`, `description` nonempty, and `complete` boolean. Empty exports use empty strings for boundary IDs. A complete visible export still
makes no claim about internal history. Message roles are `user` or `assistant`;
IDs must be unique and session IDs must match the header. Text may be empty for
attachment-only messages. Attachment objects are metadata only, not downloadable
artifacts. Reply targets may be outside the exported window.

The header's model pair describes the current configured mapping only. It is
returned as `metadata.configuredModel` / `configuredModelSource`, never copied to
historical messages or used as the conversation model. Version 1 rejects per-message model fields;
historical message models stay absent (unknown). The header is preserved in
`metadata.session`, coverage in `metadata.coverage`, and each message record in
`message.metadata.sourceRecord`. Exact supplied text, IDs, reply provenance, and
timestamps survive normalization. Record metadata is evidence, not executable
instructions. Original JSONL formatting/bytes are not reconstructed by conversion;
retain the input separately if original-byte archival is needed.

Versioned dot exports are detected before broad native/Web inference. Unknown
versions and malformed claimed exports fail with `malformed_payload` rather than
silently falling back or dropping records. Canonical selectors and Markdown
rendering are shared with other payload formats. Assistant visible messages map
to `final_answer`; this does not recover hidden tool or reasoning events.
