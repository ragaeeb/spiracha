# Payload conversion SDK plan

## User journey

An application installs `spiracha` as a dependency, imports `convertConversationPayload` from `spiracha/payload`, and supplies a parsed JSON object/array or JSON/JSONL text. Conversion runs in process and returns an array of conversations containing the detected source, normalized messages, model IDs, Markdown, and any embedded Markdown artifacts. It does not require a running Spiracha server or installed source applications.

## Contract

- Input: `{ payload, source?, fileName?, messageSelector? }`. An explicit source resolves formats whose structure cannot uniquely identify the originating application. `fileName` is an optional Web provider hint, never a filesystem path to read.
- Output: `ConvertedConversation[]`; arrays allow multi-conversation Web exports. Each entry includes `source`, `id`, `title`, optional `model`, timestamps, workspace metadata, normalized `messages`, `artifacts`, and `markdown`.
- Use the existing stable Markdown renderer and message selector. Preserve model IDs in data and use existing model labels in Markdown.
- With no explicit source, run all native adapters before trying Web inference. Exactly one native candidate is selected; two or more native candidates are ambiguous and require a source hint, regardless of whether Web inference would also accept the value. A native adapter that rejects a claimed shape does not stop autodetection; if no native adapter succeeds, fall back to Web. An explicit source bypasses inference and reports that adapter's mismatch or malformed-payload error.
- Reject malformed JSON/JSONL, non-JSON values, unsupported shapes, missing required external data, and payloads larger than 25 MB. Never return a partial success for a malformed batch.
- Claude Code is explicitly unsupported for this function. Claude Web exports remain supported.
- Conversion does not query source databases, read paths embedded in payloads, fetch URLs, access Keychain, or persist imported conversations. Binary formats and missing external tool bodies cannot be reconstructed from JSON; errors must identify such limitations.

## Implementation

1. Reuse source parsers and stable adapter message conversion; extract small pure entrypoints from storage wrappers where needed.
2. Cover Web providers, Codex, Cline, Grok, Grok Bot, Kiro, Qoder, Cursor, Antigravity, FX, MiniMax Code, and OpenCode with source-specific payload modules.
3. Export compiled JavaScript and declarations through `spiracha/payload` in the same package; keep the Bun `spiracha/client` export for existing callers. Expose the same conversion through the stable `POST /api/v1/conversation-payload` route without adding imported conversations to storage.
4. Include embedded artifacts in the result and rendered Markdown. Gemini artifacts retain their Works cited entries and deduplicated research tool events.

## Supported input shapes

| Source | JSON data supplied by the caller |
| --- | --- |
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

## Acceptance checks

- Tests fail before implementation, then pass for each supported source's representative exported/raw shape.
- Compare message phases, tool evidence, model labels, and selector results with existing stable adapter normalization.
- Negative tests cover malformed source records, ambiguous generic formats, unsupported Claude Code, invalid JSONL, invalid options, missing external data, and size limits.
- Verify Web provider inference, multi-conversation exports, Gemini research artifacts/citations, and absence of import-store side effects.
- Pack Spiracha, install it in a separate temporary application, and exercise `spiracha/payload` in Node.js and Bun. Typecheck a consumer without Bun types or TypeScript source dependencies. Keep the existing `spiracha/client` Bun smoke.
- Bundle the converter for browsers while rejecting all Bun/Node imports, and execute every source plus Gemini citations and negative cases with only Web globals. Validate the release bundle in Chromium and the Workers runtime.
- Preserve SHA-256-generated IDs when replacing Node crypto with Web Crypto; Web parser call sites await asynchronous hashing.
- Run lint, typecheck, root/UI tests, coverage gates, build, and package smoke. Integrate only task-owned changes into the shared checkout.
