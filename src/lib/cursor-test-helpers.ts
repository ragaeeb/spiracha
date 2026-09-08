import { Database } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export type FixtureBubble = {
    bubbleId: string;
    type: 1 | 2;
    text?: string;
    thinking?: string;
    toolCall?: {
        name: string;
        rawArgs?: string;
        result?: string;
        status?: string;
        toolCallId?: string;
    };
    createdAt?: number;
};

export type FixtureThread = {
    composerId: string;
    name?: string;
    createdAt?: number;
    lastUpdatedAt?: number;
    headRichText?: string;
    headText?: string;
    unifiedMode?: string;
    model?: string;
    reasoningEffort?: string;
    status?: string;
    bubbles: FixtureBubble[];
    omittedBubbleHeaders?: number;
};

export type FixtureBucket = {
    bucketId: string;
    folder?: string;
    workspace?: string;
    composerIds?: string[];
    threadsInComposerData?: boolean;
};

export type CursorFixtureSpec = {
    buckets: FixtureBucket[];
    threads: FixtureThread[];
    headerLinks?: Array<{ composerId: string; bucketId: string; uriPath?: string }>;
    composerTableHeaders?: Array<{
        composerId: string;
        bucketId: string;
        isSubagent?: boolean;
        isArchived?: boolean;
        moved?: boolean;
        parentComposerId?: string;
        sourceEnvironmentId?: string;
    }>;
    historyEntries?: Array<{ resource: string; timestamps?: number[] }>;
};

const createKvTables = (db: Database) => {
    db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.exec('CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
};

const insertItem = (db: Database, key: string, value: unknown) => {
    db.run('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
};

const insertKv = (db: Database, key: string, value: unknown) => {
    db.run('INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
};

const buildBubblePayload = (bubble: FixtureBubble) => {
    return {
        bubbleId: bubble.bubbleId,
        createdAt: bubble.createdAt ?? null,
        text: bubble.text ?? '',
        thinking: bubble.thinking ? { signature: '', text: bubble.thinking } : undefined,
        toolFormerData: bubble.toolCall
            ? {
                  name: bubble.toolCall.name,
                  params: null,
                  rawArgs: bubble.toolCall.rawArgs ?? '{}',
                  result: bubble.toolCall.result ?? '',
                  status: bubble.toolCall.status ?? 'completed',
                  toolCallId: bubble.toolCall.toolCallId ?? `${bubble.bubbleId}-call`,
              }
            : undefined,
        type: bubble.type,
    };
};

const writeGlobalThread = (db: Database, thread: FixtureThread) => {
    const orderedHeaders = thread.bubbles.map((bubble) => ({
        bubbleId: bubble.bubbleId,
        type: bubble.type,
    }));
    const omitted = thread.omittedBubbleHeaders ?? 0;

    insertKv(db, `composerData:${thread.composerId}`, {
        composerId: thread.composerId,
        createdAt: thread.createdAt ?? null,
        fullConversationHeadersOnly: orderedHeaders,
        lastUpdatedAt: thread.lastUpdatedAt ?? null,
        modelConfig: thread.model
            ? {
                  modelName: thread.model,
                  selectedModels: [
                      {
                          modelId: thread.model,
                          parameters: thread.reasoningEffort ? [{ id: 'effort', value: thread.reasoningEffort }] : [],
                      },
                  ],
              }
            : undefined,
        name: thread.name ?? null,
        richText: thread.headRichText ?? '',
        status: thread.status,
        text: thread.headText ?? '',
        totalBubbleHeaderCount: orderedHeaders.length + omitted,
        unifiedMode: thread.unifiedMode ?? 'agent',
    });

    for (const bubble of thread.bubbles) {
        insertKv(db, `bubbleId:${thread.composerId}:${bubble.bubbleId}`, buildBubblePayload(bubble));
    }

    // Simulate Cursor's capped header index: stored bubbles that are not referenced by the ordered list.
    for (let index = 0; index < omitted; index += 1) {
        const bubbleId = `omitted-${index}`;
        insertKv(
            db,
            `bubbleId:${thread.composerId}:${bubbleId}`,
            buildBubblePayload({ bubbleId, text: `older message ${index}`, type: index % 2 === 0 ? 1 : 2 }),
        );
    }
};

const buildWorkspaceIdentifier = (bucketId: string, uriPath?: string) => {
    if (!uriPath) {
        return { id: bucketId };
    }

    return {
        id: bucketId,
        uri: { $mid: 1, external: `file://${uriPath}`, fsPath: uriPath, path: uriPath, scheme: 'file' },
    };
};

const buildHeaderEntry = (thread: FixtureThread, bucketId: string, uriPath?: string) => ({
    composerId: thread.composerId,
    createdAt: thread.createdAt ?? null,
    lastUpdatedAt: thread.lastUpdatedAt ?? null,
    name: thread.name ?? null,
    type: 'head',
    unifiedMode: thread.unifiedMode ?? 'agent',
    workspaceIdentifier: buildWorkspaceIdentifier(bucketId, uriPath),
});

const buildAgentLocation = (link: { bucketId: string; moved?: boolean; sourceEnvironmentId?: string }) => ({
    environment: { id: link.bucketId },
    sourceEnvironment: link.sourceEnvironmentId ? { id: link.sourceEnvironmentId } : undefined,
    type: link.moved ? 'worktree' : 'local',
});

const writeModernHeaders = (
    db: Database,
    links: NonNullable<CursorFixtureSpec['composerTableHeaders']>,
    threadsById: Map<string, FixtureThread>,
) => {
    db.exec(
        'CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, workspaceId TEXT, createdAt INTEGER, lastUpdatedAt INTEGER, isArchived INTEGER, isSubagent INTEGER, recency INTEGER, checkpointAt INTEGER, value TEXT)',
    );
    for (const link of links) {
        const thread = threadsById.get(link.composerId);
        if (!thread) {
            continue;
        }
        const header = {
            ...buildHeaderEntry(thread, link.bucketId),
            agentLocation: buildAgentLocation(link),
            agentLocationHistory: [{ reason: link.moved ? 'moved' : 'created' }],
            subagentInfo: link.parentComposerId
                ? {
                      parentComposerId: link.parentComposerId,
                      rootParentConversationId: link.parentComposerId,
                  }
                : undefined,
        };
        db.run(
            'INSERT INTO composerHeaders (composerId, workspaceId, createdAt, lastUpdatedAt, isArchived, isSubagent, recency, checkpointAt, value) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)',
            [
                link.composerId,
                link.bucketId,
                thread.createdAt ?? null,
                thread.lastUpdatedAt ?? null,
                link.isArchived ? 1 : 0,
                link.isSubagent ? 1 : 0,
                JSON.stringify(header),
            ],
        );
    }
};

const writeGlobalDb = async (userDir: string, spec: CursorFixtureSpec) => {
    const globalDir = path.join(userDir, 'globalStorage');
    await mkdir(globalDir, { recursive: true });
    const db = new Database(path.join(globalDir, 'state.vscdb'));
    try {
        createKvTables(db);
        for (const thread of spec.threads) {
            writeGlobalThread(db, thread);
        }

        const threadsById = new Map(spec.threads.map((thread) => [thread.composerId, thread]));
        const headers = (spec.headerLinks ?? [])
            .map((link) => {
                const thread = threadsById.get(link.composerId);
                return thread ? buildHeaderEntry(thread, link.bucketId, link.uriPath) : null;
            })
            .filter((entry): entry is ReturnType<typeof buildHeaderEntry> => entry !== null);
        insertItem(db, 'composer.composerHeaders', { allComposers: headers });

        if (spec.composerTableHeaders) {
            writeModernHeaders(db, spec.composerTableHeaders, threadsById);
        }
    } finally {
        db.close();
    }
};

const writeHistoryEntries = async (userDir: string, spec: CursorFixtureSpec) => {
    for (const [index, entry] of (spec.historyEntries ?? []).entries()) {
        const historyDir = path.join(userDir, 'History', `history-${index}`);
        await mkdir(historyDir, { recursive: true });
        await Bun.write(
            path.join(historyDir, 'entries.json'),
            JSON.stringify({
                entries: (entry.timestamps ?? []).map((timestamp, timestampIndex) => ({
                    id: `entry-${timestampIndex}`,
                    source: 'Undo Create Diff',
                    timestamp,
                })),
                resource: entry.resource,
                version: 1,
            }),
        );
    }
};

const writeBucket = async (userDir: string, bucket: FixtureBucket, threads: FixtureThread[]) => {
    const bucketDir = path.join(userDir, 'workspaceStorage', bucket.bucketId);
    await mkdir(bucketDir, { recursive: true });

    const workspaceJson = bucket.workspace
        ? { workspace: bucket.workspace }
        : { folder: bucket.folder ?? `file:///tmp/${bucket.bucketId}` };
    await Bun.write(path.join(bucketDir, 'workspace.json'), JSON.stringify(workspaceJson));

    const db = new Database(path.join(bucketDir, 'state.vscdb'));
    try {
        createKvTables(db);
        if (bucket.threadsInComposerData) {
            const composerIds = new Set(bucket.composerIds ?? []);
            const allComposers = threads
                .filter((thread) => composerIds.has(thread.composerId))
                .map((thread) => ({
                    composerId: thread.composerId,
                    createdAt: thread.createdAt ?? null,
                    lastUpdatedAt: thread.lastUpdatedAt ?? null,
                    name: thread.name ?? null,
                    type: 'head',
                    unifiedMode: thread.unifiedMode ?? 'agent',
                }));
            insertItem(db, 'composer.composerData', {
                allComposers,
                hasMigratedComposerData: true,
            });
        }
    } finally {
        db.close();
    }
};

export const createCursorFixture = async (userDir: string, spec: CursorFixtureSpec): Promise<void> => {
    await mkdir(userDir, { recursive: true });
    for (const bucket of spec.buckets) {
        await writeBucket(userDir, bucket, spec.threads);
    }

    await writeGlobalDb(userDir, spec);
    await writeHistoryEntries(userDir, spec);
};

type CursorWriteLockOptions = {
    durationMs?: number;
    lockingMode?: 'normal' | 'exclusive';
};

export const holdCursorWriteLock = async (dbPath: string, options: CursorWriteLockOptions = {}) => {
    const durationMs = options.durationMs ?? 180;
    const lockingMode = options.lockingMode ?? 'normal';
    if (!Number.isFinite(durationMs) || durationMs < 0) {
        throw new Error(`Invalid Cursor lock duration: ${durationMs}`);
    }

    const script = `
import { Database } from 'bun:sqlite';

const dbPath = Bun.env.CURSOR_LOCK_DB_PATH;
const durationMs = Number(Bun.env.CURSOR_LOCK_DURATION_MS);
const lockingMode = Bun.env.CURSOR_LOCKING_MODE;
if (!dbPath || !Number.isFinite(durationMs) || durationMs < 0 || !['normal', 'exclusive'].includes(lockingMode ?? '')) {
    throw new Error('Invalid Cursor SQLite lock helper environment');
}

const db = new Database(dbPath, { create: false, readwrite: true });
if (lockingMode === 'exclusive') {
    db.exec('PRAGMA locking_mode = EXCLUSIVE');
}
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 0');
db.exec('BEGIN IMMEDIATE');
console.log('CURSOR_LOCK_READY');
await Bun.sleep(durationMs);
db.exec('COMMIT');
db.close();
`;
    const childProcess = Bun.spawn([process.execPath, '-e', script], {
        env: {
            ...process.env,
            CURSOR_LOCK_DB_PATH: dbPath,
            CURSOR_LOCK_DURATION_MS: String(durationMs),
            CURSOR_LOCKING_MODE: lockingMode,
        },
        stderr: 'pipe',
        stdout: 'pipe',
    });
    const stdoutReader = childProcess.stdout?.getReader();
    const stderrReader = childProcess.stderr?.getReader();
    if (!stdoutReader || !stderrReader) {
        childProcess.kill();
        await childProcess.exited;
        throw new Error('Cursor SQLite lock helper did not expose stdout and stderr');
    }

    const decoder = new TextDecoder();
    let stdout = '';
    let stderr = '';
    let ready = false;
    let resolveReady: (() => void) | undefined;
    const readyPromise = new Promise<void>((resolve) => {
        resolveReady = resolve;
    });
    const capture = async (reader: ReadableStreamDefaultReader<Uint8Array>, stream: 'stdout' | 'stderr') => {
        while (true) {
            const next = await reader.read();
            const text = decoder.decode(next.value ?? new Uint8Array(), { stream: !next.done });
            if (stream === 'stdout') {
                stdout += text;
                if (stdout.includes('CURSOR_LOCK_READY')) {
                    ready = true;
                    resolveReady?.();
                }
            } else {
                stderr += text;
            }
            if (next.done) {
                return;
            }
        }
    };

    const stdoutTask = capture(stdoutReader, 'stdout');
    const stderrTask = capture(stderrReader, 'stderr');
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            childProcess.kill();
            reject(new Error(`Timed out waiting for Cursor SQLite lock helper. stdout: ${stdout} stderr: ${stderr}`));
        }, 5_000);
    });
    try {
        await Promise.race([
            readyPromise,
            childProcess.exited.then(() => {
                if (!ready) {
                    throw new Error(
                        `Cursor SQLite lock helper exited before locking. stdout: ${stdout} stderr: ${stderr}`,
                    );
                }
            }),
            timeoutPromise,
        ]);
        return childProcess;
    } catch (error) {
        childProcess.kill();
        await childProcess.exited;
        throw error;
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        stdoutReader.releaseLock();
        stderrReader.releaseLock();
        void stdoutTask.catch(() => undefined);
        void stderrTask.catch(() => undefined);
    }
};
