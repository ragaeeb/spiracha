# Deletion safety and capabilities

This page describes the stable API and Bun client in v2.9.0. UI workspace deletion
and recovery have additional source-specific operations; they are not identical
to deleting one stable conversation ID.

## Before a destructive operation

Confirm the source, exact IDs, selected account, and resolved storage locations.
A Claude Code or Kiro parent ID can represent several physical continuation
files; a direct child ID addresses only that segment. Review the parent metadata
before authorizing deletion.

Preserve a restorable copy of the source application's relevant stores before
maintenance, using an application-supported backup or a coherent copy taken
while its writers are stopped. A Markdown export is not a database backup, and
a raw transcript does not necessarily include indexes, attachments, sibling
segments, or runtime database rows. Do not treat copying one live SQLite main
file, or deleting its WAL/SHM files, as a backup procedure.

Keep Codex stopped during destructive maintenance, and keep Cursor, Grok Bot,
and Qoder stopped throughout their delete/recovery operations. Command Code has
no documented process name in this checkout; Spiracha does not guess one. Set
`SPIRACHA_COMMAND_CODE_WRITER_PROCESS` to the exact `pgrep -x` name when it is
known. Unknown pgrep status fails closed. Spiracha's own mutation locks do not
prevent the source application from relaunching.

## Stable adapter capabilities

Every row supports normalized list/detail and Markdown/evidence export when its
source records are readable. Raw support means an adapter can return a standalone
file; individual records may still have no raw file.

| Source | Stable delete | Standalone raw export | `deleteSessionFiles` behavior |
| --- | --- | --- | --- |
| Antigravity | Yes | Conditional generated transcript | Not consulted by adapter |
| Claude Code | Yes; parent includes recognized lineage | Physical transcript file | Not consulted by adapter |
| Cline | Yes | Session JSON | Not consulted by adapter |
| Codex | Yes | Rollout JSONL | Adapter always requests rollout deletion |
| Command Code | Yes; durable sidecar/replica receipt | Session JSONL | Not consulted by adapter |
| Cursor | Yes; app must be stopped | No stable raw operation | Omitted/true removes transcript directories; false preserves them |
| FX | Yes | No stable raw operation | Not consulted by adapter |
| Grok | Yes | Standalone source JSON | Not consulted by adapter |
| Grok Bot | Yes; app must be stopped | Exact account replica `.blob` | Not consulted by adapter |
| Kiro | Yes; parent includes recognized lineage | Physical session JSON | Not consulted by adapter |
| MiniMax Code | Yes | Standalone session data where available | Not consulted by adapter |
| OpenCode | Yes | No stable raw operation | Not consulted by adapter |
| Qoder | Yes; app must be stopped; durable cleanup receipt | Conditional CLI transcript | Not consulted by adapter |

HTTP uses `delete_session_files`; the client uses `deleteSessionFiles`. In this
version only the Cursor stable adapter honors the preservation choice. In
particular, passing false to a Codex stable delete does **not** preserve its
rollout. Do not generalize UI-specific options to the stable API.

Preserved Cursor transcript files can make a conversation discoverable again.
Raw export does not merge a parent lineage into a synthetic source file.

## Interpret results before retrying

A successful result can include `cleanupFailures` and `receiptId`:
authoritative records may already be gone while secondary cleanup remains.
Inspect `deletedIds`, `deletedFiles`, per-item `outcomes` (`deleted`,
`missing`, `failed`, `cleanup_pending`, `cancelled`), and each cleanup phase
rather than checking only HTTP status.

Writer-running and concurrent-modification conflicts throw
`SourceMutationConflictError` (HTTP 409 `mutation_conflict`) with no-effect
semantics when they occur before commit. After a logical commit, file-identity
conflicts are retained as cleanup-pending results with the durable receipt.

Batch deletion is not one transaction. Mixed deleted, missing, failed, cleanup-pending, and cancelled outcomes return in a 200 envelope that retains every started item. A batch whose unique IDs are all missing returns 404. Abort stops only unstarted work. Re-read state and use the applicable recovery protocol before retrying.

Unsupported stable deletion returns HTTP 405 `unsupported_operation`. A missing
single record returns 404 `conversation_not_found`. The HTTP SDK maps these
recognized delete cases to null; local adapters can return empty result objects
for missing records. Do not infer one universal missing-record result shape.

## Recover an interrupted operation

Consult [Codex deletion recovery](codex-deletion-recovery.md),
[Cursor crash recovery](cursor-crash-recovery.md), or
[Grok Bot deletion recovery](grok-bot-deletion.md). Command Code resumes a private
`.spiracha-command-code-delete-*.json` receipt in the projects root by retrying the
same session ID; the receipt lists exact replica and sidecar identities and is not
an external Command Code writer lock. Qoder resumes `.spiracha-qoder-delete-*.json`
the same way. These protocols complete a previously authorized operation; they are
not an undo facility. Cursor discovery
can reconcile a pending operation before returning a workspace list. Grok Bot
resumes a receipt by retrying the same deletion, not by listing chats.

Do not remove or edit a pending intent/receipt merely to suppress an error.
Resolve the reported condition and retain the source application's offline
state. Changed identities or accounts must be investigated rather than forced
through recovery. No equivalent durable cross-store recovery guarantee is
asserted here for the other integrations.

Maintenance helpers imported from `src/lib/...` are internal checkout APIs, not
new supported package subpaths or legacy CLI commands.
