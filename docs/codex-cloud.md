# Codex Cloud operational contract

Cloud UI browsing makes authenticated remote requests; it is not an offline
filesystem read. The stable `codex` source continues to represent local history.
Cloud project/task UI helpers are internal, not new `spiracha/client` methods.

Authentication is read from the configured Codex auth file. On an HTTP 401 the
client cancels the response body, attempts a login refresh, rereads authentication,
and retries that request once. The refresh path can invoke the Codex CLI and
update local authentication state. A repeated 401 reports an authentication
error; do not place auth tokens or auth.json contents in bug reports. Cloud task
browsing does not imply remote task creation/deletion is implemented.

Each underlying HTTP request has a 30-second timeout; this is not a total
deadline for a multi-page inventory plus refresh. List collection deduplicates
task IDs and bounds pages/tasks, tracks repeated cursors, and exposes `partial`.
Treat partial inventories as incomplete rather than authoritative absence. Project
grouping propagates that partial state. Network, auth, and malformed-response
failures must remain distinguishable from a successful empty account.

Troubleshoot the configured auth path and CLI availability first, then the
reported status/message. Avoid adding infinite login retries. The configuration
reference in this directory explains the separate Codex database and auth paths.

Implementation: `src/lib/codex-cloud.ts` and `src/ui/lib/codex-cloud-server.ts`.
