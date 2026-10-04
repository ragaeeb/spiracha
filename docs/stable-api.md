# Stable API contract summary

Request/field detail lives in [api-reference.md](api-reference.md) and [client-reference.md](client-reference.md). This page records package surface, routes, and defaults.

The package exposes:
- `spiracha/client`
  - `createConversationClient({ mode: 'local' })` for serverless local access
  - `createConversationClient({ mode: 'http', baseUrl })` for a running UI server
- `spiracha/types`
  - normalized conversation DTO types
- `spiracha/payload`
  - in-memory JSON/JSONL conversion in Bun, Node.js 22+, browsers, and Workers; no storage imports or I/O
  - built with `bun run build:payload`, included in the release build

The local UI server exposes:
- `GET /api/v1/sources`
- `GET /api/v1/conversations[?cwd=<absolute-path>][&source=...]`
- `POST /api/v1/conversation-query`
- `POST /api/v1/conversation-payload`
- `GET /api/v1/conversations/:source/:id`
- `GET /api/v1/conversations/:source/:id/export`
- `GET /api/v1/conversations/:source/:id/raw` (also supports `HEAD`)
- `POST /api/v1/conversations/:source/:id/evidence`
- `DELETE /api/v1/conversations/:source/:id`
- `POST /api/v1/conversations/delete`
- `POST /api/v1/conversations/export`
- `GET /api/v1/resolve?ref=<url-or-deeplink>`

Defaults:
- list endpoints default to `message_selector=last_final_answer`; workspace sources require `cwd`, while global sources such as Grok Bot omit it
- all-source collection with `cwd` is workspace-scoped and excludes global sources; all-source collection without `cwd` is global-scoped
- detail endpoints default to `message_selector=all`
- list endpoints omit message bodies unless `include_messages=true`; positive `limit` values are bounded at 200. Grok Bot list results remain roster-only and load transcript messages only on detail
- list pagination uses opaque keyset cursors ordered by update time, source, and conversation ID
- `updated_after_ms` and `updated_before_ms` constrain collection before pagination
- `source=codex,claude-code,...` may scope collection
- omitted source means all installed/available integrations
- all-source collection should tolerate missing optional integrations
- explicit source requests should surface source-specific failures
- `delete_session_files` is accepted for single-delete query strings and batch-delete JSON; Cursor uses it to keep or remove transcript directories
- Web imports are intentionally UI-only: they are not members of `CONVERSATION_SOURCES` and are not exposed through the stable API or CLI
- Supplied payload conversion is separately exposed through `spiracha/payload` and the Bun `spiracha/client`; it reuses Web and native normalization without adding imported conversations to the stable source registry. Claude Code payload conversion is unsupported.
- Grok Bot is a global source backed by the installed macOS app's account-scoped persistence directory. List reads the validated roster only, detail reads one exact replica, and raw export returns the original `.blob` bytes. Deletion calls the authenticated Grok Bot gateway to delete the exact bot/group ID and leaves app persistence untouched; see `docs/grok-bot-deletion.md`.

Do not bake review semantics into Spiracha.
