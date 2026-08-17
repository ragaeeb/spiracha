import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readdir, rename, rm, symlink, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    CURSOR_MAX_HISTORY_ENTRIES_BYTES,
    CURSOR_SQLITE_RETRY_DELAYS_MS,
    listCursorWorkspaceGroups,
    withCursorWriteTransaction,
} from './cursor-db';
import { getCursorGlobalDbPath } from './cursor-exporter-types';
import {
    collectCursorThreadsForDeletion,
    deleteCursorWorkspaceBuckets,
    deleteCursorWorkspaceHistory,
    pruneCursorThreads,
    recoverCursorWorkspaceGroup,
    retryCursorWorkspaceCleanup,
} from './cursor-recovery';
import { type CursorFixtureSpec, createCursorFixture, holdCursorWriteLock } from './cursor-test-helpers';

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

const makeUserDir = async (prefix: string): Promise<string> => {
    const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
};

const readHeaders = (globalDbPath: string) => {
    const db = new Database(globalDbPath, { readonly: true });
    try {
        const row = db.query("SELECT value FROM ItemTable WHERE key = 'composer.composerHeaders'").get() as {
            value?: string;
        } | null;
        return JSON.parse(row?.value ?? '{"allComposers":[]}').allComposers as Array<{
            composerId?: string;
            workspaceIdentifier?: { id?: string };
        }>;
    } finally {
        db.close();
    }
};

const recoverySpec = (): CursorFixtureSpec => ({
    buckets: [
        {
            bucketId: 'bucket-old',
            composerIds: ['thread-1'],
            folder: 'file:///Users/test/workspace/demo',
            threadsInComposerData: true,
        },
        { bucketId: 'bucket-new', folder: 'file:///Users/test/workspace/demo' },
    ],
    headerLinks: [{ bucketId: 'bucket-old', composerId: 'thread-1' }],
    threads: [
        {
            bubbles: [
                { bubbleId: 'b1', text: 'request', type: 1 },
                { bubbleId: 'b2', text: 'reply', type: 2 },
            ],
            composerId: 'thread-1',
            lastUpdatedAt: 10,
            name: 'Demo thread',
        },
    ],
});

describe('recoverCursorWorkspaceGroup', () => {
    it('should report the merge plan without writing during a dry run', async () => {
        const userDir = await makeUserDir('cursor-recover-dry-');
        await createCursorFixture(userDir, recoverySpec());
        const [group] = await listCursorWorkspaceGroups(userDir);

        const result = await recoverCursorWorkspaceGroup(group!, false, userDir);

        expect(result.mergedThreadCount).toBe(1);
        expect(result.threads[0]?.bubbleCount).toBe(2);
        expect(readHeaders(getCursorGlobalDbPath(userDir))[0]?.workspaceIdentifier?.id).toBe('bucket-old');
    });

    it('should relink headers to the newest bucket when applied', async () => {
        const userDir = await makeUserDir('cursor-recover-apply-');
        await createCursorFixture(userDir, recoverySpec());
        const [group] = await listCursorWorkspaceGroups(userDir);

        const expectedActiveBucket = group!.buckets[0]!.bucketId;
        const result = await recoverCursorWorkspaceGroup(group!, true, userDir);

        expect(result.activeBucketId).toBe(expectedActiveBucket);
        expect(result.relinkedHeaderCount).toBe(1);
        expect(readHeaders(getCursorGlobalDbPath(userDir))[0]?.workspaceIdentifier?.id).toBe(expectedActiveBucket);
    });

    it('should write merged threads into the active bucket composer.composerData for non-migrated layouts', async () => {
        const userDir = await makeUserDir('cursor-recover-bucket-');
        await createCursorFixture(userDir, recoverySpec());
        const [group] = await listCursorWorkspaceGroups(userDir);
        const activeBucket = group!.buckets[0]!;

        await recoverCursorWorkspaceGroup(group!, true, userDir);

        const db = new Database(activeBucket.dbPath, { readonly: true });
        try {
            const row = db.query("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").get() as {
                value?: string;
            } | null;
            const composerData = JSON.parse(row?.value ?? '{}') as {
                allComposers?: Array<{ composerId?: string }>;
            };
            const ids = (composerData.allComposers ?? []).map((entry) => entry.composerId);
            expect(ids).toContain('thread-1');
        } finally {
            db.close();
        }
    });

    it('should retry a same-database write transaction after a competing writer releases the lock', async () => {
        const userDir = await makeUserDir('cursor-recover-lock-');
        await createCursorFixture(userDir, recoverySpec());
        const globalDbPath = getCursorGlobalDbPath(userDir);
        const retryBudgetMs = CURSOR_SQLITE_RETRY_DELAYS_MS.reduce((total, delayMs) => total + delayMs, 0);
        const lockProcess = await holdCursorWriteLock(globalDbPath, {
            durationMs: Math.floor(retryBudgetMs / 2),
        });

        try {
            const changes = withCursorWriteTransaction(
                globalDbPath,
                (db) =>
                    db.run('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)', ['spiracha.retry-test', 'ok'])
                        .changes,
            );

            expect(changes).toBe(1);
        } finally {
            lockProcess.kill();
            await lockProcess.exited;
        }
    });

    it('should restore the target bucket when the global transaction exhausts its retry budget', async () => {
        const userDir = await makeUserDir('cursor-recover-lock-exhausted-');
        await createCursorFixture(userDir, recoverySpec());
        const [group] = await listCursorWorkspaceGroups(userDir);
        const targetBucket = group!.buckets[0]!;
        const globalDbPath = getCursorGlobalDbPath(userDir);
        const retryBudgetMs = CURSOR_SQLITE_RETRY_DELAYS_MS.reduce((total, delayMs) => total + delayMs, 0);
        const lockProcess = await holdCursorWriteLock(globalDbPath, {
            durationMs: retryBudgetMs + Math.max(...CURSOR_SQLITE_RETRY_DELAYS_MS),
        });

        try {
            await expect(recoverCursorWorkspaceGroup(group!, true, userDir)).rejects.toThrow(
                'SQLite operation failed after 4 attempts',
            );
        } finally {
            lockProcess.kill();
            await lockProcess.exited;
        }

        const targetDb = new Database(targetBucket.dbPath, { readonly: true });
        try {
            expect(targetDb.query("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").get()).toBeNull();
        } finally {
            targetDb.close();
        }
        expect(readHeaders(globalDbPath)[0]?.workspaceIdentifier?.id).toBe('bucket-old');
    });

    it('should fail closed without creating a missing Cursor database', async () => {
        const userDir = await makeUserDir('cursor-recover-missing-');
        const dbPath = path.join(userDir, 'missing', 'state.vscdb');

        expect(() => withCursorWriteTransaction(dbPath, () => undefined)).toThrow();
        expect(await Bun.file(dbPath).exists()).toBe(false);
    });
});

describe('pruneCursorThreads', () => {
    it('should reject transcript directories that escape through a symbolic link', async () => {
        const userDir = await makeUserDir('cursor-prune-symlink-');
        const externalDir = await makeUserDir('cursor-prune-external-');
        const projectsDir = path.join(userDir, 'projects');
        const projectDir = path.join(projectsDir, 'demo');
        const externalTranscriptDir = path.join(externalDir, 'thread-1');
        await mkdir(projectDir, { recursive: true });
        await mkdir(externalTranscriptDir, { recursive: true });
        await Bun.write(path.join(externalTranscriptDir, 'sentinel.txt'), 'keep');
        await symlink(externalDir, path.join(projectDir, 'agent-transcripts'));

        const transcriptDir = path.join(projectDir, 'agent-transcripts', 'thread-1');
        const thread = {
            bubbleBytes: 0,
            bubbleCount: 0,
            bucketId: null,
            composerId: 'thread-1',
            createdAtMs: null,
            lastUpdatedAtMs: null,
            mode: null,
            model: null,
            name: 'Unsafe thread',
            parentComposerId: null,
            reasoningEffort: null,
            transcriptDirs: [transcriptDir],
            workspaceKey: '',
            workspaceLabel: '',
        };

        await expect(pruneCursorThreads([thread], true, userDir)).rejects.toThrow(
            `Unsafe Cursor transcript directory: ${transcriptDir}`,
        );
        expect(await Bun.file(path.join(externalTranscriptDir, 'sentinel.txt')).exists()).toBe(true);
    });

    it('should reject a transcript symlink to another composer directory inside Cursor projects', async () => {
        const userDir = await makeUserDir('cursor-prune-internal-symlink-');
        const transcriptRoot = path.join(userDir, 'projects', 'demo', 'agent-transcripts');
        const targetDir = path.join(transcriptRoot, 'thread-2');
        const linkedDir = path.join(transcriptRoot, 'thread-1');
        await mkdir(targetDir, { recursive: true });
        await Bun.write(path.join(targetDir, 'sentinel.txt'), 'keep');
        await symlink(targetDir, linkedDir);

        const thread = {
            bubbleBytes: 0,
            bubbleCount: 0,
            bucketId: null,
            composerId: 'thread-1',
            createdAtMs: null,
            lastUpdatedAtMs: null,
            mode: null,
            model: null,
            name: 'Unsafe thread',
            parentComposerId: null,
            reasoningEffort: null,
            transcriptDirs: [linkedDir],
            workspaceKey: '',
            workspaceLabel: '',
        };

        await expect(pruneCursorThreads([thread], true, userDir)).rejects.toThrow(
            `Unsafe Cursor transcript directory: ${linkedDir}`,
        );
        expect(await Bun.file(path.join(targetDir, 'sentinel.txt')).exists()).toBe(true);
    });

    it('should preview deletion impact without applying', async () => {
        const userDir = await makeUserDir('cursor-prune-dry-');
        await createCursorFixture(userDir, recoverySpec());
        const [group] = await listCursorWorkspaceGroups(userDir);
        const { listCursorThreadsForGroup } = await import('./cursor-db');
        const threads = await listCursorThreadsForGroup(group!, userDir);

        const result = await pruneCursorThreads(threads, false, userDir);

        expect(result.bubblesDeleted).toBe(2);
        expect(result.composerIds).toEqual(['thread-1']);
    });

    it('should delete bubbles and headers when applied', async () => {
        const userDir = await makeUserDir('cursor-prune-apply-');
        await createCursorFixture(userDir, recoverySpec());
        const [group] = await listCursorWorkspaceGroups(userDir);
        const { listCursorThreadsForGroup } = await import('./cursor-db');
        const threads = await listCursorThreadsForGroup(group!, userDir);

        const result = await pruneCursorThreads(threads, true, userDir);

        expect(result.bubblesDeleted).toBe(2);
        expect(result.headersRemoved).toBe(1);
        const db = new Database(getCursorGlobalDbPath(userDir), { readonly: true });
        try {
            const row = db
                .query("SELECT COUNT(*) AS count FROM cursorDiskKV WHERE key LIKE 'bubbleId:thread-1:%'")
                .get() as { count: number };
            expect(row.count).toBe(0);
        } finally {
            db.close();
        }
    });

    it('should fully delete a thread from every bucket and the global store via composer ids', async () => {
        const userDir = await makeUserDir('cursor-delete-ids-');
        const spec: CursorFixtureSpec = {
            buckets: [
                {
                    bucketId: 'bucket-a',
                    composerIds: ['thread-1'],
                    folder: 'file:///Users/test/workspace/dup',
                    threadsInComposerData: true,
                },
                {
                    bucketId: 'bucket-b',
                    composerIds: ['thread-1'],
                    folder: 'file:///Users/test/workspace/dup',
                    threadsInComposerData: true,
                },
            ],
            headerLinks: [{ bucketId: 'bucket-b', composerId: 'thread-1' }],
            threads: [
                {
                    bubbles: [
                        { bubbleId: 'b1', text: 'request', type: 1 },
                        { bubbleId: 'b2', text: 'reply', type: 2 },
                    ],
                    composerId: 'thread-1',
                    name: 'Shared thread',
                },
            ],
        };
        await createCursorFixture(userDir, spec);

        const deletable = await collectCursorThreadsForDeletion(['thread-1'], userDir);
        expect(deletable[0]?.bubbleCount).toBe(2);

        const result = await pruneCursorThreads(deletable, true, userDir);

        expect(result.bubblesDeleted).toBe(2);
        // Removed from both bucket-a and bucket-b composer.composerData.
        expect(result.workspaceBucketsUpdated).toBe(2);
        const [group] = await listCursorWorkspaceGroups(userDir);
        expect(group?.threadCount).toBe(0);
    });

    it('should delete modern composer headers so removed threads are not rediscovered', async () => {
        const userDir = await makeUserDir('cursor-delete-modern-headers-');
        await createCursorFixture(userDir, {
            buckets: [
                {
                    bucketId: 'modern-bucket',
                    folder: 'file:///Users/test/workspace/modern',
                },
            ],
            composerTableHeaders: [{ bucketId: 'modern-bucket', composerId: 'thread-1' }],
            threads: [
                {
                    bubbles: [{ bubbleId: 'b1', text: 'delete me', type: 1 }],
                    composerId: 'thread-1',
                    name: 'Modern thread',
                },
            ],
        });

        const deletable = await collectCursorThreadsForDeletion(['thread-1'], userDir);
        const result = await pruneCursorThreads(deletable, true, userDir);
        const db = new Database(getCursorGlobalDbPath(userDir), { readonly: true });
        try {
            expect(db.query('SELECT COUNT(*) AS count FROM composerHeaders').get()).toEqual({ count: 0 });
        } finally {
            db.close();
        }

        const [group] = await listCursorWorkspaceGroups(userDir);
        await deleteCursorWorkspaceBuckets(group!, userDir);
        const groups = await listCursorWorkspaceGroups(userDir);
        expect(result.headersRemoved).toBe(1);
        expect(groups.find((group) => group.key === 'folder:/Users/test/workspace/modern')).toBeUndefined();
    });

    it('should physically remove every storage bucket for an already-empty workspace', async () => {
        const userDir = await makeUserDir('cursor-delete-empty-workspace-');
        await createCursorFixture(userDir, {
            buckets: [
                { bucketId: 'empty-a', folder: 'file:///Users/test/workspace/empty' },
                { bucketId: 'empty-b', folder: 'file:///Users/test/workspace/empty' },
            ],
            threads: [],
        });
        const [group] = await listCursorWorkspaceGroups(userDir);

        await expect(deleteCursorWorkspaceBuckets(group!, userDir)).resolves.toEqual({
            cleanupFailures: [],
            removedPaths: group!.buckets.map((bucket) => path.dirname(bucket.workspaceJsonPath)),
        });

        for (const bucket of group!.buckets) {
            expect(await Bun.file(bucket.workspaceJsonPath).exists()).toBe(false);
        }
        expect(await listCursorWorkspaceGroups(userDir)).toEqual([]);
    });

    it('should reject a bucket symlink even when its target is inside workspace storage', async () => {
        const userDir = await makeUserDir('cursor-delete-bucket-symlink-');
        await createCursorFixture(userDir, {
            buckets: [{ bucketId: 'bucket-link', folder: 'file:///Users/test/workspace/link' }],
            threads: [],
        });
        const [group] = await listCursorWorkspaceGroups(userDir);
        const bucketRoot = path.join(userDir, 'workspaceStorage', 'bucket-link');
        const targetRoot = path.join(userDir, 'workspaceStorage', 'bucket-target');
        await rename(bucketRoot, targetRoot);
        await symlink(targetRoot, bucketRoot);

        await expect(deleteCursorWorkspaceBuckets(group!, userDir)).rejects.toThrow(
            'Unsafe Cursor workspace bucket directory',
        );
        expect(await Bun.file(path.join(targetRoot, 'workspace.json')).exists()).toBe(true);
    });

    it('should remove matching file-history entries without deleting a sibling workspace', async () => {
        const userDir = await makeUserDir('cursor-delete-file-history-');
        await createCursorFixture(userDir, {
            buckets: [],
            historyEntries: [
                { resource: 'file:///Users/test/workspace/file-history/src/index.ts' },
                { resource: 'file:///Users/test/workspace/file-history-other/src/index.ts' },
                { resource: 'file:///Users/test/workspace/file-history/docs/notes.md' },
            ],
            threads: [],
        });
        const groups = await listCursorWorkspaceGroups(userDir);
        const group = groups.find((candidate) => candidate.key === 'folder:/Users/test/workspace/file-history');

        expect(group).toMatchObject({ buckets: [], threadCount: 0 });
        await expect(deleteCursorWorkspaceHistory(group!, userDir)).resolves.toEqual({
            cleanupFailures: [],
            removedPaths: expect.arrayContaining([
                path.join(userDir, 'History', 'history-0'),
                path.join(userDir, 'History', 'history-2'),
            ]),
        });

        expect(await Bun.file(path.join(userDir, 'History', 'history-0', 'entries.json')).exists()).toBe(false);
        expect(await Bun.file(path.join(userDir, 'History', 'history-1', 'entries.json')).exists()).toBe(true);
        expect(await Bun.file(path.join(userDir, 'History', 'history-2', 'entries.json')).exists()).toBe(false);
    });

    it('should diagnose corrupt history entries and continue deleting valid siblings', async () => {
        const userDir = await makeUserDir('cursor-delete-corrupt-history-');
        await createCursorFixture(userDir, {
            buckets: [],
            historyEntries: [
                { resource: 'file:///Users/test/workspace/corrupt/src/index.ts' },
                { resource: 'file:///Users/test/workspace/corrupt/src/other.ts' },
            ],
            threads: [],
        });
        await Bun.write(path.join(userDir, 'History', 'history-0', 'entries.json'), '{not-json');
        const [group] = await listCursorWorkspaceGroups(userDir);
        const warnings: unknown[][] = [];
        const originalWarn = console.warn;
        console.warn = (...args: unknown[]) => warnings.push(args);
        let result: Awaited<ReturnType<typeof deleteCursorWorkspaceHistory>>;
        try {
            result = await deleteCursorWorkspaceHistory(group!, userDir);
        } finally {
            console.warn = originalWarn;
        }

        expect(await Bun.file(path.join(userDir, 'History', 'history-0', 'entries.json')).exists()).toBe(true);
        expect(warnings.some((args) => String(args[0]).includes('invalid_history_entries_json'))).toBe(true);
        expect(result.removedPaths).toEqual([path.join(userDir, 'History', 'history-1')]);
        expect(result.cleanupFailures).toEqual([
            expect.objectContaining({
                path: path.join(userDir, 'History', 'history-0'),
                phase: 'workspace_history',
            }),
        ]);
    });

    it('should skip oversized history entries and report partial cleanup', async () => {
        const userDir = await makeUserDir('cursor-delete-oversized-history-');
        await createCursorFixture(userDir, {
            buckets: [],
            historyEntries: [
                { resource: 'file:///Users/test/workspace/oversized/src/index.ts' },
                { resource: 'file:///Users/test/workspace/oversized/src/other.ts' },
            ],
            threads: [],
        });
        await Bun.write(
            path.join(userDir, 'History', 'history-0', 'entries.json'),
            JSON.stringify({
                padding: 'x'.repeat(CURSOR_MAX_HISTORY_ENTRIES_BYTES),
                resource: 'file:///Users/test/workspace/oversized/src/index.ts',
            }),
        );
        const [group] = await listCursorWorkspaceGroups(userDir);
        const warnings: unknown[][] = [];
        const originalWarn = console.warn;
        console.warn = (...args: unknown[]) => warnings.push(args);
        let result: Awaited<ReturnType<typeof deleteCursorWorkspaceHistory>>;
        try {
            result = await deleteCursorWorkspaceHistory(group!, userDir);
        } finally {
            console.warn = originalWarn;
        }

        expect(result.removedPaths).toEqual([path.join(userDir, 'History', 'history-1')]);
        expect(await Bun.file(path.join(userDir, 'History', 'history-0', 'entries.json')).exists()).toBe(true);
        expect(warnings.some((args) => String(args[0]).includes('history_entries_oversized'))).toBe(true);
        expect(result.cleanupFailures).toEqual([
            expect.objectContaining({
                path: path.join(userDir, 'History', 'history-0'),
                phase: 'workspace_history',
            }),
        ]);
    });

    it('should create an atomic prune backup containing legacy global headers', async () => {
        const userDir = await makeUserDir('cursor-prune-backup-');
        await createCursorFixture(userDir, recoverySpec());
        const [group] = await listCursorWorkspaceGroups(userDir);
        const threads = await collectCursorThreadsForDeletion(['thread-1'], userDir);

        await pruneCursorThreads(threads, true, userDir);

        const backupFiles = (await readdir(path.join(userDir, 'globalStorage'))).filter(
            (entry) => entry.includes('.prunedThreads.') && entry.endsWith('.json'),
        );
        expect(backupFiles).toHaveLength(1);
        expect((await readdir(path.join(userDir, 'globalStorage'))).some((entry) => entry.includes('.tmp-'))).toBe(
            false,
        );
        const backup = (await Bun.file(path.join(userDir, 'globalStorage', backupFiles[0]!)).json()) as {
            headers?: { allComposers?: Array<{ composerId?: string }> };
        };
        expect(backup.headers?.allComposers?.map((header) => header.composerId)).toContain('thread-1');
        expect(group).toBeDefined();
    });

    it('should count unique transcript directories that were actually removed', async () => {
        const userDir = await makeUserDir('cursor-prune-partial-cleanup-');
        await createCursorFixture(userDir, recoverySpec());
        const transcriptDir = path.join(userDir, 'projects', 'demo', 'agent-transcripts', 'thread-1');
        await mkdir(transcriptDir, { recursive: true });
        const thread = (await collectCursorThreadsForDeletion(['thread-1'], userDir))[0]!;
        const result = await pruneCursorThreads(
            [{ ...thread, transcriptDirs: [transcriptDir, transcriptDir] }],
            true,
            userDir,
        );

        expect(result.transcriptDirsRemoved).toBe(1);
        expect(result.transcriptDirsRemovedPaths).toEqual([transcriptDir]);
    });

    it('should discover transcript directories when a deletion summary omits them', async () => {
        const userDir = await makeUserDir('cursor-prune-discover-transcript-');
        await createCursorFixture(userDir, recoverySpec());
        const transcriptDir = path.join(userDir, 'projects', 'demo', 'agent-transcripts', 'thread-1');
        await mkdir(transcriptDir, { recursive: true });
        await Bun.write(path.join(transcriptDir, 'messages.jsonl'), '{}\n');
        const thread = (await collectCursorThreadsForDeletion(['thread-1'], userDir))[0]!;

        const result = await pruneCursorThreads([{ ...thread, transcriptDirs: [] }], true, userDir);

        expect(result.transcriptDirsRemoved).toBe(1);
        expect(result.transcriptDirsRemovedPaths).toEqual([transcriptDir]);
        expect(await Bun.file(path.join(transcriptDir, 'messages.jsonl')).exists()).toBe(false);
    });

    it('should retry a failed transcript cleanup from its target after workspace discovery is gone', async () => {
        const userDir = await makeUserDir('cursor-retry-transcript-cleanup-');
        await createCursorFixture(userDir, recoverySpec());
        const transcriptDir = path.join(userDir, 'projects', 'demo', 'agent-transcripts', 'thread-1');
        await mkdir(transcriptDir, { recursive: true });
        await Bun.write(path.join(transcriptDir, 'messages.jsonl'), '{}\n');
        await rm(path.join(userDir, 'workspaceStorage'), { force: true, recursive: true });

        const result = await retryCursorWorkspaceCleanup(
            {
                bucketPaths: [],
                composerIds: ['thread-1'],
                folders: ['/Users/test/workspace/demo'],
                historyPaths: [],
                transcriptDirs: [transcriptDir],
                workspaceKey: 'folder:/Users/test/workspace/demo',
            },
            userDir,
        );

        expect(result.cleanupFailures).toEqual([]);
        expect(result.transcriptDirsRemovedPaths).toEqual([transcriptDir]);
        expect(await Bun.file(path.join(transcriptDir, 'messages.jsonl')).exists()).toBe(false);
    });

    it('should treat an already-missing workspace storage directory as an idempotent cleanup', async () => {
        const userDir = await makeUserDir('cursor-delete-missing-storage-');
        await createCursorFixture(userDir, recoverySpec());
        const [group] = await listCursorWorkspaceGroups(userDir);
        await rm(path.join(userDir, 'workspaceStorage'), { force: true, recursive: true });

        await expect(deleteCursorWorkspaceBuckets(group!, userDir)).resolves.toEqual({
            cleanupFailures: [],
            removedPaths: [],
        });
    });

    it('should restore earlier bucket updates when a later bucket mutation fails', async () => {
        const userDir = await makeUserDir('cursor-delete-bucket-rollback-');
        const spec = recoverySpec();
        spec.buckets.push({
            bucketId: 'bucket-second',
            composerIds: ['thread-1'],
            folder: spec.buckets[0]!.folder,
            threadsInComposerData: true,
        });
        await createCursorFixture(userDir, spec);
        await utimes(path.join(userDir, 'workspaceStorage', 'bucket-second', 'state.vscdb'), new Date(1), new Date(1));
        const [group] = await listCursorWorkspaceGroups(userDir);
        const failingBucket = group!.buckets.find((bucket) => bucket.bucketId === 'bucket-second')!;
        expect(failingBucket.bucketId).not.toBe(group!.buckets[0]!.bucketId);
        const triggerDb = new Database(failingBucket.dbPath);
        triggerDb.exec(`
            CREATE TRIGGER fail_bucket_update
            BEFORE UPDATE OF value ON ItemTable
            WHEN OLD.key = 'composer.composerData'
            BEGIN
                SELECT RAISE(ABORT, 'forced bucket update failure');
            END;
        `);
        triggerDb.close();
        const deletable = await collectCursorThreadsForDeletion(['thread-1'], userDir);

        await expect(pruneCursorThreads(deletable, true, userDir)).rejects.toThrow('forced bucket update failure');

        let bucketsContainingThread = 0;
        for (const bucket of group!.buckets) {
            const db = new Database(bucket.dbPath, { readonly: true });
            const row = db.query("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").get() as {
                value: string;
            } | null;
            db.close();
            if (!row) {
                continue;
            }
            const composerIds = (
                JSON.parse(row.value) as { allComposers: Array<{ composerId: string }> }
            ).allComposers.map((composer) => composer.composerId);
            expect(composerIds).toContain('thread-1');
            bucketsContainingThread += 1;
        }
        expect(bucketsContainingThread).toBe(2);

        const globalDb = new Database(getCursorGlobalDbPath(userDir), { readonly: true });
        expect(
            globalDb.query("SELECT COUNT(*) AS count FROM cursorDiskKV WHERE key LIKE 'bubbleId:thread-1:%'").get(),
        ).toEqual({ count: 2 });
        globalDb.close();
    });

    it('should restore earlier bucket updates when a later bucket remains locked', async () => {
        const userDir = await makeUserDir('cursor-delete-bucket-lock-');
        const spec = recoverySpec();
        spec.buckets.push({
            bucketId: 'bucket-second',
            composerIds: ['thread-1'],
            folder: spec.buckets[0]!.folder,
            threadsInComposerData: true,
        });
        await createCursorFixture(userDir, spec);
        await utimes(path.join(userDir, 'workspaceStorage', 'bucket-second', 'state.vscdb'), new Date(1), new Date(1));
        const [group] = await listCursorWorkspaceGroups(userDir);
        const failingBucket = group!.buckets.find((bucket) => bucket.bucketId === 'bucket-second')!;
        expect(failingBucket.bucketId).not.toBe(group!.buckets[0]!.bucketId);
        const retryBudgetMs = CURSOR_SQLITE_RETRY_DELAYS_MS.reduce((total, delayMs) => total + delayMs, 0);
        const lockProcess = await holdCursorWriteLock(failingBucket.dbPath, {
            durationMs: retryBudgetMs + Math.max(...CURSOR_SQLITE_RETRY_DELAYS_MS),
        });
        const deletable = await collectCursorThreadsForDeletion(['thread-1'], userDir);

        try {
            await expect(pruneCursorThreads(deletable, true, userDir)).rejects.toThrow(
                'SQLite operation failed after 4 attempts',
            );
        } finally {
            lockProcess.kill();
            await lockProcess.exited;
        }

        let bucketsContainingThread = 0;
        for (const bucket of group!.buckets) {
            const db = new Database(bucket.dbPath, { readonly: true });
            const row = db.query("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").get() as {
                value: string;
            } | null;
            db.close();
            if (!row) {
                continue;
            }
            const composerIds = (
                JSON.parse(row.value) as { allComposers: Array<{ composerId: string }> }
            ).allComposers.map((composer) => composer.composerId);
            expect(composerIds).toContain('thread-1');
            bucketsContainingThread += 1;
        }
        expect(bucketsContainingThread).toBe(2);
    });

    it('should treat underscores in composer ids as literals when deleting bubble keys', async () => {
        const userDir = await makeUserDir('cursor-delete-wildcard-');
        await createCursorFixture(userDir, {
            buckets: [
                {
                    bucketId: 'bucket-a',
                    composerIds: ['thread_1', 'threadX1'],
                    folder: 'file:///Users/test/workspace/wildcard',
                    threadsInComposerData: true,
                },
            ],
            headerLinks: [
                { bucketId: 'bucket-a', composerId: 'thread_1' },
                { bucketId: 'bucket-a', composerId: 'threadX1' },
            ],
            threads: [
                {
                    bubbles: [{ bubbleId: 'b1', text: 'delete me', type: 1 }],
                    composerId: 'thread_1',
                    name: 'Underscore thread',
                },
                {
                    bubbles: [{ bubbleId: 'b2', text: 'keep me', type: 1 }],
                    composerId: 'threadX1',
                    name: 'Literal thread',
                },
            ],
        });

        const deletable = await collectCursorThreadsForDeletion(['thread_1'], userDir);
        const result = await pruneCursorThreads(deletable, true, userDir);
        const db = new Database(getCursorGlobalDbPath(userDir), { readonly: true });
        try {
            const remaining = db
                .query("SELECT COUNT(*) AS count FROM cursorDiskKV WHERE key LIKE 'bubbleId:threadX1:%'")
                .get() as { count: number };

            expect(result.bubblesDeleted).toBe(1);
            expect(remaining.count).toBe(1);
        } finally {
            db.close();
        }
    });

    it('should count, back up, and delete only the requested composer when ids share a colon prefix', async () => {
        const userDir = await makeUserDir('cursor-delete-prefix-');
        await createCursorFixture(userDir, {
            buckets: [
                {
                    bucketId: 'prefix-bucket',
                    composerIds: ['thread', 'thread:child'],
                    folder: 'file:///Users/test/workspace/prefix',
                    threadsInComposerData: true,
                },
            ],
            headerLinks: [
                { bucketId: 'prefix-bucket', composerId: 'thread' },
                { bucketId: 'prefix-bucket', composerId: 'thread:child' },
            ],
            threads: [
                { bubbles: [{ bubbleId: 'parent-bubble', text: 'parent', type: 1 }], composerId: 'thread' },
                {
                    bubbles: [{ bubbleId: 'child-bubble', text: 'child', type: 1 }],
                    composerId: 'thread:child',
                },
            ],
        });

        const deletable = await collectCursorThreadsForDeletion(['thread'], userDir);
        expect(deletable[0]?.bubbleCount).toBe(1);

        const result = await pruneCursorThreads(deletable, true, userDir);
        expect(result.bubblesDeleted).toBe(1);

        const backupFiles = (await readdir(path.join(userDir, 'globalStorage'))).filter(
            (entry) => entry.includes('.prunedThreads.') && entry.endsWith('.json'),
        );
        const backup = (await Bun.file(path.join(userDir, 'globalStorage', backupFiles[0]!)).json()) as {
            threads?: Array<{ composerId: string; bubbles: Array<{ key: string }> }>;
        };
        expect(
            backup.threads?.map((thread) => ({
                bubbles: thread.bubbles.map((bubble) => bubble.key),
                composerId: thread.composerId,
            })),
        ).toEqual([{ bubbles: ['bubbleId:thread:parent-bubble'], composerId: 'thread' }]);

        const db = new Database(getCursorGlobalDbPath(userDir), { readonly: true });
        try {
            expect(db.query("SELECT key FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' ORDER BY key").all()).toEqual([
                { key: 'bubbleId:thread:child:child-bubble' },
            ]);
        } finally {
            db.close();
        }
    });

    it('should roll back global thread deletion when a later global mutation fails', async () => {
        const userDir = await makeUserDir('cursor-delete-transaction-');
        await createCursorFixture(userDir, recoverySpec());
        const globalDbPath = getCursorGlobalDbPath(userDir);
        const setupDb = new Database(globalDbPath);
        setupDb.exec(`
            CREATE TRIGGER fail_composer_delete
            BEFORE DELETE ON cursorDiskKV
            WHEN OLD.key = 'composerData:thread-1'
            BEGIN
                SELECT RAISE(ABORT, 'forced composer delete failure');
            END;
        `);
        setupDb.close();
        const deletable = await collectCursorThreadsForDeletion(['thread-1'], userDir);

        expect(pruneCursorThreads(deletable, true, userDir)).rejects.toThrow('forced composer delete failure');

        const db = new Database(globalDbPath, { readonly: true });
        try {
            const bubbles = db
                .query("SELECT COUNT(*) AS count FROM cursorDiskKV WHERE key LIKE 'bubbleId:thread-1:%'")
                .get() as { count: number };
            expect(bubbles.count).toBe(2);
            expect(readHeaders(globalDbPath).map((header) => header.composerId)).toContain('thread-1');
        } finally {
            db.close();
        }
    });
});
