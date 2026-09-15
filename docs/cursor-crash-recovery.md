# Cursor crash recovery

Cursor workspace deletion spans separate SQLite databases, transcript directories,
workspace buckets, and file history. These stores are not one atomic transaction.
Spiracha uses a small durable intent record to finish an interrupted operation.
Keep Cursor stopped until reconciliation completes; Cursor itself does not acquire
Spiracha's operation lock.

The Cursor User directory contains `.spiracha-cursor-operation.json` and
`.spiracha-mutation-lock.sqlite`. The latter holds a SQLite writer lock
throughout each operation, preventing concurrent Spiracha processes from applying
conflicting operations. Process exit releases this lock automatically.

## State machine

1. **No record:** no pending operation. Validate the target and acquire the lock.
2. **Intent:** write a version 1 record to a temporary file, fsync it, rename it,
   and fsync the parent directory before changing any conversation store.
   The record preserves the operation, selected composer IDs, original workspace
   buckets, and requested transcript deletion policy.
3. **Applying:** execute the existing database and filesystem phases. Database
   exceptions still trigger runtime rollback. Any exception or partial cleanup
   leaves intent on disk; a rollback does not cancel the user's deletion request.
4. **Committed:** after every phase succeeds, atomically write and fsync a
   committed marker. Remove the record and fsync its directory. A crash during
   this final cleanup only requires removing the committed record.

On the first Cursor workspace discovery after restart, Spiracha checks the record
before returning results. Pending intent is replayed with the same idempotent
operations. This includes cases where workspace metadata has already disappeared:
the saved workspace and composer IDs remain available. Repeating reconciliation
has no further effect after completion. Recovery/merge operations similarly replay
the captured workspace group into its original selected target.

Unsafe paths, malformed or unsupported records, a running Cursor process, and
unresolved cleanup failures stop reconciliation. Errors include the journal path
and the underlying unresolved path or database failure. The record remains for
the next attempt. Fix the reported condition, quit Cursor, and refresh the Cursor
workspace list to retry. The UI cleanup retry also reconciles pending intent before
performing its own serialized cleanup, and clears the record on success. Do not discard a pending record just to dismiss an error:
that abandons the remaining phases of the operation.

Records are bounded at 8 MiB. A larger intent fails before store mutation. Existing
installations need no migration: the record is created on the first write. There
is no legacy record reader, compatibility shim, or automated repair of operations
that crashed before this journal existed. Retained JSON backups remain separate
from reconciliation and are not a cross-store rollback guarantee.

Tests kill child processes after intent, bucket update, global deletion, transcript
cleanup, bucket removal, and history removal, then start a fresh process to reconcile
twice. They assert that sibling SQLite data, transcript files, buckets, and history
survive. Existing runtime rollback and symlink checks remain in the recovery suite;
additional restart tests retain and report unsafe transcript paths.
