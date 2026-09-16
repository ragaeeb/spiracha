# UI export, settings, and live loading

These are internal browser/server-function workflows, not additional stable
`/api/v1` options or public package subpaths.

## Export preferences

Initial UI defaults are Markdown, metadata included, tools included, commentary
excluded, and no ZIP. Path conversion and username redaction initially default
to false. Submitted export choices persist across dialog openings; canceled
drafts do not replace them. Preferences are normalized and stored in the
`spiracha-settings` HttpOnly, SameSite=Lax, path `/` cookie with a one-year max age.
They contain settings, not arbitrary evidence lens JSON or conversation bodies.

The provider updates UI state optimistically, queues cookie writes, broadcasts
successful saves, and ignores stale focus-refresh reads. Failed saves are logged
without rolling back displayed state. A different tab or a later reload can
therefore differ after a persistence failure. This is not server-side per-user
authentication or a universal export-redaction policy.

Stable Markdown options/selectors are a separate contract. Do not invent stable
`includeTools`, `includeCommentary`, or UI archive-manifest behavior just because
a source's export dialog has those controls. Source Raw/Parsed JSON views may be
normalized objects, while stable raw downloads preserve a standalone file's bytes.

Large transcript downloads can use temporary zipped files rather than large
initial responses. Temporary links can be pruned and are not durable backups.
Current ZIP helpers still read/compress content in memory; disk staging does not
imply a streaming heap bound. Stable multi-conversation ZIP is Markdown-only and
uses its own all-or-error retrieval contract, not a UI partial-success manifest.

## Metadata-first and deferred transcripts

Cursor and Antigravity detail routes fetch large bodies after hydration. Web
detail fetches normalized imported events after hydration. Oversized Codex
rollouts offer deferred preview/full loading. A lightweight initial route response
is therefore not evidence of missing content. Inspect the subsequent query state
before changing source parsers or eagerly embedding all data in SSR output.

Preserve Bun-only dynamic imports in server functions. Browser-safe DTOs/parsers
must not pull database or filesystem modules into the client dependency graph.
Regenerate the route tree through the build rather than editing it manually.

## Codex live updates

The browser uses a SharedWorker hub when available, otherwise a per-tab
EventSource. A worker combines subscribed thread IDs into one stream. Membership
changes replace that stream; obsolete callbacks are ignored. Browser ports send
heartbeats every 15 seconds, and the hub expires a client lease after ten minutes.
Cleanup must close ports/streams and clear heartbeats when the view disconnects.

The SSE response begins with `connected` and retry interval 2000 ms. Subsequent
`transcript-changed` events contain `threadId` plus a wall-clock revision hint.
They invalidate data, not deliver the new transcript. There are no durable SSE
event IDs, replay cursor, or periodic heartbeat in the server response. Refetch
thread, transcript-preview, and transcript query keys after notification.

For stale views, inspect live status, the follow-up refetch, and source file
readability separately. `reconnecting` is not proof of deleted data. Do not
assume a proxy preserves unbuffered SSE or implement app-level replay by sorting
the wall-clock revision field.

Implementation: `src/ui/lib/settings-store.tsx`, `src/ui/lib/export-options.ts`,
`src/ui/lib/codex-thread-live.ts`, `src/ui/lib/codex-thread-live-hub.ts`, and
`src/lib/codex-thread-events.ts`.
