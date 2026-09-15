# Codex deletion recovery

Codex deletion saves a private intent under the selected Codex home's
`.spiracha-deletions/` before changing any store. The intent contains the exact
state database path, requested thread IDs, rollout paths captured before SQL
removes them, and the explicit rollout-deletion choice. A temporary intent is
flushed, atomically renamed to `.json`, and the directory is flushed before
mutation begins. Temporary files alone never authorize deletion.

A dedicated SQLite write lock serializes deletion, intent reconciliation, and
project-thread recovery across processes for the selected Codex home, including
filesystem cleanup. Project recovery acquires it before reading or backing up
shared state, so it cannot restore a pre-deletion snapshot. The operating system
releases it if the process exits; no stale PID lock needs manual removal. Lock
contention waits asynchronously with a bounded retry budget. Dry-run reads do not
create or lock the journal.

Every single, batch, and project deletion uses this protocol:

1. Reconcile earlier pending intents before accepting a new deletion.
2. Validate rollout paths and persist the new intent.
3. Delete state rows and attached history rows in the existing SQLite transaction.
4. Remove requested rollout files, session-index entries, local catalog rows,
   and references in both Desktop global-state files.
5. Invalidate UI caches, remove the intent, and flush the journal directory.

The intent's presence is the recovery marker; its removal is the completion
marker. Recovery repeats all phases rather than trusting a phase counter. This
also repairs a process crash that committed only one of the attached WAL stores.
History rows are deleted by requested ID even when the state row is already gone.
Missing rollout files are successful cleanup, and saved rollout paths are
validated again before replay. Unrelated IDs and rollouts are retained. A false
`deleteSessionFiles` choice continues to preserve rollout files during recovery.

Runtime SQL failures still roll back the local transaction. Any failure after
intent publication retains the intent, including a SQL failure: a later recovery
will retry that explicitly requested deletion. A normal failed deletion includes
the intent path in its error; it must not be interpreted as no changes having
occurred. Recovery reports each intent as pending, completed, or failed and leaves
failed intents for retry. Malformed intent files receive individual failure
reports without replay; other valid intents can still finish. Unsafe journal
directories fail closed before replay.

For maintenance from this checkout, use the exported recovery function:

```ts
import { reconcileCodexDeletions } from './src/lib/codex-thread-mutations';

const report = await reconcileCodexDeletions(process.env.CODEX_DB_PATH!);
console.log(report); // default dry run: no stores or journal files change

const result = await reconcileCodexDeletions(process.env.CODEX_DB_PATH!, {
    dryRun: false,
});
console.log(result);
```

A second completed recovery has no work. No recovery daemon or legacy CLI alias
is needed: the next deletion request runs recovery, and maintenance can invoke
it explicitly. Keep Codex stopped during destructive maintenance so the app
cannot restore deleted data from its own in-memory state. This protocol handles
process interruption; SQLite ATTACH is not crash-atomic across WAL files, and
this does not claim an atomic transaction with Desktop or power-loss atomicity
for every external store.

Tests kill real deletion processes immediately after intent publication, SQL
commit, rollout removal, index replacement, catalog cleanup, and global-state
replacement. Additional simulated split-store states exercise partial WAL commit
recovery. Tests also cover competing processes deleting different IDs, malformed
intents, dry-run preservation, repeated recovery, unsafe paths, and request-time
retry. Existing transaction rollback tests remain applicable.
