import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listCursorWorkspaceGroups } from './cursor-db';
import { getCursorGlobalDbPath } from './cursor-exporter-types';
import { collectCursorThreadsForDeletion, pruneCursorThreads, recoverCursorWorkspaceGroup } from './cursor-recovery';
import { type CursorFixtureSpec, createCursorFixture } from './cursor-test-helpers';

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
            name: 'Unsafe thread',
            transcriptDirs: [transcriptDir],
            workspaceKey: '',
            workspaceLabel: '',
        };

        await expect(pruneCursorThreads([thread], true, userDir)).rejects.toThrow(
            `Unsafe Cursor transcript directory: ${transcriptDir}`,
        );
        expect(await Bun.file(path.join(externalTranscriptDir, 'sentinel.txt')).exists()).toBe(true);
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
        const [group] = await listCursorWorkspaceGroups(userDir);
        const failingBucket = group!.buckets.at(-1)!;
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
