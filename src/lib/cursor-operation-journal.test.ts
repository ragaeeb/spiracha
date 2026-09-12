import { afterEach, beforeEach, expect, it, spyOn } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { reconcileCursorOperations, runCursorOperation } from './cursor-operation-journal';
import * as cursorRecovery from './cursor-recovery';

const directories: string[] = [];
let runningCheck: ReturnType<typeof spyOn<typeof cursorRecovery, 'isCursorRunning'>>;
beforeEach(() => {
    runningCheck = spyOn(cursorRecovery, 'isCursorRunning').mockResolvedValue(false);
});
const stoppedCursorFixture = `
    import { spyOn } from 'bun:test';
    import * as recovery from ${JSON.stringify(path.join(import.meta.dir, 'cursor-recovery.ts'))};
    spyOn(recovery, 'isCursorRunning').mockResolvedValue(false);
`;

afterEach(async () => {
    runningCheck.mockRestore();
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

it('should retain failed intent, replay it on restart, and reconcile idempotently', async () => {
    const userDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-journal-'));
    directories.push(userDir);
    const operation = { kind: 'test', value: 1 };
    await expect(
        runCursorOperation(userDir, operation, async () => {
            throw new Error('interrupted');
        }),
    ).rejects.toThrow('interrupted');
    const replayed: unknown[] = [];
    await reconcileCursorOperations(userDir, async (intent) => {
        replayed.push(intent);
    });
    await reconcileCursorOperations(userDir, async (intent) => {
        replayed.push(intent);
    });
    expect(replayed).toEqual([operation]);
});

it('should reject concurrent writers and leave unresolved intent available', async () => {
    const userDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-journal-lock-'));
    directories.push(userDir);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
        release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const first = runCursorOperation(userDir, { kind: 'test' }, async () => {
        entered();
        await blocked;
    });
    await started;
    try {
        await expect(runCursorOperation(userDir, {}, async () => {})).rejects.toThrow();
    } finally {
        release();
        await first;
    }
});

it('should recover a child process killed after each store phase without touching another workspace', async () => {
    const { createCursorFixture } = await import('./cursor-test-helpers');
    const { listCursorWorkspaceGroups } = await import('./cursor-db');
    const { getCursorGlobalDbPath } = await import('./cursor-exporter-types');
    const { Database } = await import('bun:sqlite');
    for (const phase of ['intent', 'bucket', 'global', 'transcripts', 'workspace', 'history']) {
        const userDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-crash-'));
        directories.push(userDir);
        await createCursorFixture(userDir, {
            buckets: [
                {
                    bucketId: 'target',
                    composerIds: ['target-thread'],
                    folder: 'file:///workspace/target',
                    threadsInComposerData: true,
                },
                {
                    bucketId: 'sibling',
                    composerIds: ['sibling-thread'],
                    folder: 'file:///workspace/sibling',
                    threadsInComposerData: true,
                },
            ],
            headerLinks: [
                { bucketId: 'target', composerId: 'target-thread' },
                { bucketId: 'sibling', composerId: 'sibling-thread' },
            ],
            historyEntries: [
                { resource: 'file:///workspace/target/file.ts' },
                { resource: 'file:///workspace/sibling/file.ts' },
            ],
            threads: [
                { bubbles: [{ bubbleId: 'b1', text: 'target', type: 1 }], composerId: 'target-thread' },
                { bubbles: [{ bubbleId: 'b2', text: 'sibling', type: 1 }], composerId: 'sibling-thread' },
            ],
        });
        const targetTranscript = path.join(
            userDir,
            'projects',
            'target',
            'agent-transcripts',
            'target-thread',
            'transcript.txt',
        );
        const siblingTranscript = path.join(
            userDir,
            'projects',
            'sibling',
            'agent-transcripts',
            'sibling-thread',
            'transcript.txt',
        );
        await mkdir(path.dirname(targetTranscript), { recursive: true });
        await mkdir(path.dirname(siblingTranscript), { recursive: true });
        await Bun.write(targetTranscript, 'target');
        await Bun.write(siblingTranscript, 'sibling');
        const worker = `
            import { Database } from 'bun:sqlite';
            import { listCursorWorkspaceGroups } from ${JSON.stringify(path.join(import.meta.dir, 'cursor-db.ts'))};
            import { runCursorOperation } from ${JSON.stringify(path.join(import.meta.dir, 'cursor-operation-journal.ts'))};
            import { collectCursorThreadsForDeletion, pruneCursorThreads, deleteCursorWorkspaceBuckets, deleteCursorWorkspaceHistory } from ${JSON.stringify(path.join(import.meta.dir, 'cursor-recovery.ts'))};
            const userDir = process.argv[1];
            const phase = process.argv[2];
            const group = (await listCursorWorkspaceGroups(userDir)).find(group => group.buckets.some(bucket => bucket.bucketId === 'target'));
            const crash = name => { if (phase === name) process.kill(process.pid, 'SIGKILL'); };
            await runCursorOperation(userDir, { kind: 'workspace', group, composerIds: ['target-thread'], deleteSessionFiles: true }, async () => {
                crash('intent');
                const db = new Database(group.buckets[0].dbPath);
                db.run("UPDATE ItemTable SET value = '{\\"allComposers\\":[]}' WHERE key = 'composer.composerData'");
                db.close();
                crash('bucket');
                const threads = await collectCursorThreadsForDeletion(['target-thread'], userDir);
                await pruneCursorThreads(threads, { apply: true, deleteSessionFiles: false }, userDir);
                crash('global');
                await pruneCursorThreads(threads, { apply: true, deleteSessionFiles: true }, userDir);
                crash('transcripts');
                await deleteCursorWorkspaceBuckets(group, userDir);
                crash('workspace');
                await deleteCursorWorkspaceHistory(group, userDir);
                crash('history');
            });
        `;
        const child = Bun.spawn([process.execPath, '--eval', stoppedCursorFixture + worker, userDir, phase], {
            stderr: 'pipe',
            stdout: 'pipe',
        });
        const errorText = await new Response(child.stderr).text();
        expect(await child.exited, errorText).not.toBe(0);
        expect(child.signalCode).toBe('SIGKILL');
        const restarted = Bun.spawn(
            [
                process.execPath,
                '--eval',
                stoppedCursorFixture +
                    `import { listCursorWorkspaceGroups } from ${JSON.stringify(path.join(import.meta.dir, 'cursor-db.ts'))}; await listCursorWorkspaceGroups(process.argv[1]); await listCursorWorkspaceGroups(process.argv[1]);`,
                userDir,
            ],
            { stderr: 'pipe', stdout: 'pipe' },
        );
        const restartError = await new Response(restarted.stderr).text();
        expect(await restarted.exited, restartError).toBe(0);
        expect(await Bun.file(targetTranscript).exists()).toBe(false);
        expect(await Bun.file(siblingTranscript).text()).toBe('sibling');
        expect(await Bun.file(path.join(userDir, 'History', 'history-0', 'entries.json')).exists()).toBe(false);
        expect(await Bun.file(path.join(userDir, 'History', 'history-1', 'entries.json')).exists()).toBe(true);
        const db = new Database(getCursorGlobalDbPath(userDir), { readonly: true });
        try {
            expect(db.query("SELECT key FROM cursorDiskKV WHERE key = 'composerData:target-thread'").get()).toBeNull();
            expect(
                db.query("SELECT key FROM cursorDiskKV WHERE key = 'composerData:sibling-thread'").get(),
            ).not.toBeNull();
        } finally {
            db.close();
        }
        expect(
            (await listCursorWorkspaceGroups(userDir)).some((group) =>
                group.buckets.some((bucket) => bucket.bucketId === 'sibling'),
            ),
        ).toBe(true);
    }
}, 30_000);

it('should retain unresolved paths and reject a transcript symlink after a crash', async () => {
    const { createCursorFixture } = await import('./cursor-test-helpers');
    const { collectCursorThreadsForDeletion, reconcilePendingCursorOperations } = await import('./cursor-recovery');
    const userDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-crash-symlink-'));
    directories.push(userDir);
    await createCursorFixture(userDir, { buckets: [], threads: [{ bubbles: [], composerId: 'target' }] });
    const transcriptDir = path.join(userDir, 'projects', 'workspace', 'agent-transcripts', 'target');
    const siblingDir = path.join(userDir, 'projects', 'workspace', 'agent-transcripts', 'sibling');
    await mkdir(transcriptDir, { recursive: true });
    await mkdir(siblingDir, { recursive: true });
    await Bun.write(path.join(siblingDir, 'transcript.txt'), 'keep');
    const threads = await collectCursorThreadsForDeletion(['target'], userDir);
    await expect(
        runCursorOperation(
            userDir,
            { kind: 'prune', options: { apply: true, deleteSessionFiles: true }, threads },
            async () => {
                throw new Error('crash');
            },
        ),
    ).rejects.toThrow();
    await rm(transcriptDir, { recursive: true });
    await symlink(siblingDir, transcriptDir);
    for (let attempt = 0; attempt < 2; attempt += 1) {
        await expect(reconcilePendingCursorOperations(userDir)).rejects.toThrow(
            `Unsafe Cursor transcript directory: ${transcriptDir}`,
        );
        expect(await Bun.file(path.join(userDir, '.spiracha-cursor-operation.json')).exists()).toBe(true);
        expect(await Bun.file(path.join(siblingDir, 'transcript.txt')).text()).toBe('keep');
    }
});

it('should retain partial cleanup intent and refuse unsupported journal versions', async () => {
    const userDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-crash-partial-'));
    directories.push(userDir);
    await runCursorOperation(
        userDir,
        { kind: 'test' },
        async () => ({ cleanupFailures: ['unresolved'] }),
        (result) => result.cleanupFailures.length === 0,
    );
    expect(await Bun.file(path.join(userDir, '.spiracha-cursor-operation.json')).exists()).toBe(true);
    await Bun.write(path.join(userDir, '.spiracha-cursor-operation.json'), JSON.stringify({ intent: {}, version: 2 }));
    let replayed = false;
    await expect(
        reconcileCursorOperations(userDir, async () => {
            replayed = true;
        }),
    ).rejects.toThrow('Unsupported Cursor recovery record');
    expect(replayed).toBe(false);
});

it('should finalize a committed marker without replaying destructive work', async () => {
    const userDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-committed-'));
    directories.push(userDir);
    await Bun.write(
        path.join(userDir, '.spiracha-cursor-operation.json'),
        JSON.stringify({ intent: { kind: 'test' }, state: 'committed', version: 1 }),
    );
    let replayed = false;
    await reconcileCursorOperations(userDir, async () => {
        replayed = true;
    });
    expect(replayed).toBe(false);
    expect(await Bun.file(path.join(userDir, '.spiracha-cursor-operation.json')).exists()).toBe(false);
});

it('should resume a workspace merge after a child dies with its target bucket updated', async () => {
    const { createCursorFixture } = await import('./cursor-test-helpers');
    const userDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-merge-crash-'));
    directories.push(userDir);
    await createCursorFixture(userDir, {
        buckets: [
            {
                bucketId: 'old',
                composerIds: ['thread'],
                folder: 'file:///workspace/merge',
                threadsInComposerData: true,
            },
            { bucketId: 'new', folder: 'file:///workspace/merge' },
        ],
        headerLinks: [{ bucketId: 'old', composerId: 'thread' }],
        threads: [{ bubbles: [], composerId: 'thread' }],
    });
    const worker = `
        import { Database } from 'bun:sqlite';
        import { listCursorWorkspaceGroups } from ${JSON.stringify(path.join(import.meta.dir, 'cursor-db.ts'))};
        import { runCursorOperation } from ${JSON.stringify(path.join(import.meta.dir, 'cursor-operation-journal.ts'))};
        const userDir = process.argv[1];
        const [group] = await listCursorWorkspaceGroups(userDir);
        group.buckets.sort((a, b) => a.bucketId === 'new' ? -1 : 1);
        group.buckets[0].mtimeMs = Date.now() + 1000;
        await runCursorOperation(userDir, { kind: 'recover', group }, async () => {
            const db = new Database(group.buckets[0].dbPath);
            db.run("INSERT OR REPLACE INTO ItemTable VALUES ('composer.composerData', ?)", [JSON.stringify({ allComposers: [{ composerId: 'thread' }] })]);
            db.close();
            process.kill(process.pid, 'SIGKILL');
        });
    `;
    const child = Bun.spawn([process.execPath, '--eval', stoppedCursorFixture + worker, userDir], {
        stderr: 'pipe',
        stdout: 'pipe',
    });
    await child.exited;
    expect(child.signalCode).toBe('SIGKILL');
    const restarted = Bun.spawn(
        [
            process.execPath,
            '--eval',
            stoppedCursorFixture +
                `
        import { listCursorWorkspaceGroups } from ${JSON.stringify(path.join(import.meta.dir, 'cursor-db.ts'))};
        import { recoverCursorWorkspaceGroup } from ${JSON.stringify(path.join(import.meta.dir, 'cursor-recovery.ts'))};
        const groups = await listCursorWorkspaceGroups(process.argv[1]);
        const result = await recoverCursorWorkspaceGroup(groups[0], false, process.argv[1]);
        if (result.mergedThreadCount !== 1) throw new Error('Thread lost');
    `,
            userDir,
        ],
        { stderr: 'pipe', stdout: 'pipe' },
    );
    const errorText = await new Response(restarted.stderr).text();
    expect(await restarted.exited, errorText).toBe(0);
    const { Database } = await import('bun:sqlite');
    const db = new Database(path.join(userDir, 'globalStorage', 'state.vscdb'), { readonly: true });
    try {
        const row = db.query("SELECT value FROM ItemTable WHERE key = 'composer.composerHeaders'").get() as {
            value: string;
        };
        expect(JSON.parse(row.value).allComposers[0].workspaceIdentifier.id).toBe('new');
    } finally {
        db.close();
    }
});

it('should treat a journal completed by a concurrent reconciler as a successful no-op', async () => {
    const userDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-concurrent-reconcile-'));
    directories.push(userDir);
    await expect(
        runCursorOperation(userDir, { kind: 'test' }, async () => {
            throw new Error('crash');
        }),
    ).rejects.toThrow();
    let replayCount = 0;
    const replay = async () => {
        replayCount += 1;
        await Bun.sleep(20);
    };
    await Promise.all([reconcileCursorOperations(userDir, replay), reconcileCursorOperations(userDir, replay)]);
    expect(replayCount).toBe(1);
});

it('should serialize an explicit cleanup retry and finish its pending journal', async () => {
    const { retryCursorWorkspaceCleanup } = await import('./cursor-recovery');
    const userDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-cleanup-retry-'));
    directories.push(userDir);
    const transcriptDir = path.join(userDir, 'projects', 'workspace', 'agent-transcripts', 'target');
    await mkdir(transcriptDir, { recursive: true });
    await Bun.write(path.join(transcriptDir, 'transcript.txt'), 'target');
    const target = {
        bucketPaths: [],
        composerIds: ['target'],
        folders: [],
        historyPaths: [],
        transcriptDirs: [transcriptDir],
        workspaceKey: 'workspace',
    };
    await expect(
        runCursorOperation(userDir, { kind: 'cleanup', target }, async () => {
            throw new Error('crash');
        }),
    ).rejects.toThrow();
    const result = await retryCursorWorkspaceCleanup(target, userDir);
    expect(result.cleanupFailures).toEqual([]);
    expect(await Bun.file(path.join(transcriptDir, 'transcript.txt')).exists()).toBe(false);
    expect(await Bun.file(path.join(userDir, '.spiracha-cursor-operation.json')).exists()).toBe(false);
    expect((await retryCursorWorkspaceCleanup(target, userDir)).cleanupFailures).toEqual([]);
});
