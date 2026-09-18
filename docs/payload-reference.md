# Supplied-payload conversion reference

This describes the implementation in the v2.9.0 source snapshot. The existing
[design and shape plan](payload-sdk-plan.md) provides additional background.
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

Explicit native hints support Antigravity, Cline, Codex, Cursor, FX, Grok, Grok Bot,
Kiro, MiniMax Code, OpenCode, and Qoder, plus the `web` parser. **Claude Code and
Command Code are not payload sources.** Claude Web exports are separate and
supported. A live database path, encrypted store, or index without its required
message bodies is not a self-contained export.

Without a source hint, native parsers run first: one match wins, multiple matches
are ambiguous, and no matches lead to Web inference. Native parser rejection
during inference is not a user-visible diagnostic for every attempted parser.
An explicit hint can expose why that particular parser rejects the payload; it
does not create support for missing records or unsupported sources.

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
| `unsupported_source` | Choose a supported source or a different export workflow. A source hint cannot enable Claude Code or Command Code. |
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
