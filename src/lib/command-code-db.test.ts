import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    deleteCommandCodeSession,
    listCommandCodeSessionSummaries,
    listCommandCodeWorkspaceGroups,
    readCommandCodeSessionTranscript,
} from './command-code-db';

const tempRoots: string[] = [];

const makeRoot = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'command-code-db-test-'));
    tempRoots.push(root);
    return root;
};

const sessionRecord = (id: string, cwd: string, timestamp: string) => ({
    cwd,
    id,
    timestamp,
    type: 'session',
    version: 3,
});

const messageRecord = (
    id: string,
    parentId: string | null,
    role: 'assistant' | 'user',
    content: unknown[],
    timestamp: string,
    model?: string,
    source?: string,
) => ({
    id,
    parentId,
    timestamp,
    type: 'message',
    ...(model ? { model } : {}),
    message: {
        content,
        meta: {
            ...(source ? { source } : {}),
            createdAt: Date.parse(timestamp),
            messageId: id,
        },
        role,
    },
});

const writeSession = async (
    root: string,
    projectDirectory: string,
    sessionId: string,
    records: unknown[],
    fileName = `${sessionId}.jsonl`,
) => {
    const directory = path.join(root, projectDirectory);
    await mkdir(directory, { recursive: true });
    const filePath = path.join(directory, fileName);
    await Bun.write(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
    return filePath;
};

const makeLinearRecords = (sessionId: string, cwd: string, records: Array<Record<string, unknown>>) => {
    let parentId: string | null = null;
    return [
        sessionRecord(sessionId, cwd, '2026-09-14T18:57:42.119Z'),
        ...records.map((record) => {
            const next = { ...record, parentId };
            parentId = String(record.id);
            return next;
        }),
    ];
};

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('Command Code filesystem reader', () => {
    it('should normalize linear sessions, bind tools, and select final answers per user turn', async () => {
        const root = await makeRoot();
        const cwd = '/Users/rhaq/workspace/harfbench';
        const sessionId = 'LWorY3lITj6RS3TR_BP3y';
        const records = makeLinearRecords(sessionId, cwd, [
            messageRecord(
                'user-1',
                null,
                'user',
                [{ text: 'performing an independent review', type: 'text' }],
                '2026-09-14T18:57:45.580Z',
                undefined,
                'user',
            ),
            messageRecord(
                'assistant-1',
                null,
                'assistant',
                [
                    { text: 'I will inspect the repository first.', type: 'text' },
                    { id: 'call-1', input: { file_path: 'AGENTS.md' }, name: 'read_file', type: 'tool_use' },
                ],
                '2026-09-14T18:57:45.580Z',
                'meta/muse-spark-1.3-contributor',
            ),
            messageRecord(
                'tool-1',
                null,
                'user',
                [
                    {
                        content: [{ text: 'Read the repository instructions.', type: 'text' }],
                        tool_use_id: 'call-1',
                        type: 'tool_result',
                    },
                ],
                '2026-09-14T18:57:45.580Z',
                undefined,
                'tool',
            ),
            messageRecord(
                'assistant-2',
                null,
                'assistant',
                [
                    { thinking: 'The remaining checks are bounded.', type: 'thinking' },
                    { text: 'baseline can never be restored', type: 'text' },
                ],
                '2026-09-14T19:16:08.481Z',
                'meta/muse-spark-1.3-contributor',
            ),
            messageRecord(
                'user-2',
                null,
                'user',
                [{ text: 'Continue with the second pass.', type: 'text' }],
                '2026-09-14T19:16:09.481Z',
                undefined,
                'user',
            ),
            messageRecord(
                'assistant-3',
                null,
                'assistant',
                [{ text: 'The second pass is complete.', type: 'text' }],
                '2026-09-14T19:16:10.481Z',
                'meta/muse-spark-1.3-contributor',
            ),
        ]);

        const filePath = await writeSession(root, 'users-rhaq-workspace-harfbench', sessionId, records);
        const transcript = await readCommandCodeSessionTranscript(root, sessionId);

        expect(transcript?.session).toMatchObject({
            cwd,
            filePath,
            model: 'meta/muse-spark-1.3-contributor',
            modelLabel: 'Muse Spark 1.3 Contributor',
            sessionId,
            title: 'performing an independent review',
            workspaceKey: expect.stringContaining('command-code:'),
        });
        expect(transcript?.messages.map(({ phase, role, text }) => ({ phase, role, text }))).toEqual([
            { phase: 'unknown', role: 'user', text: 'performing an independent review' },
            { phase: 'commentary', role: 'assistant', text: 'I will inspect the repository first.' },
            { phase: 'tool_call', role: 'tool', text: expect.stringContaining('read_file') },
            { phase: 'tool_output', role: 'tool', text: 'Read the repository instructions.' },
            { phase: 'reasoning', role: 'assistant', text: 'The remaining checks are bounded.' },
            { phase: 'final_answer', role: 'assistant', text: 'baseline can never be restored' },
            { phase: 'unknown', role: 'user', text: 'Continue with the second pass.' },
            { phase: 'final_answer', role: 'assistant', text: 'The second pass is complete.' },
        ]);
        expect(transcript?.messages[2]?.toolEvidence).toMatchObject({
            callId: 'call-1',
            inputText: JSON.stringify({ file_path: 'AGENTS.md' }),
            name: 'read_file',
            status: 'unknown',
        });
        expect(transcript?.messages[3]?.toolEvidence).toMatchObject({
            callId: 'call-1',
            name: 'read_file',
            outputText: 'Read the repository instructions.',
            status: 'succeeded',
        });
    });

    it('should read a targeted session without parsing unrelated malformed files', async () => {
        const root = await makeRoot();
        const sessionId = 'targeted-session';
        const sessionPath = await writeSession(
            root,
            'target',
            sessionId,
            makeLinearRecords(sessionId, '/workspace/target', [
                messageRecord(
                    'target-message',
                    null,
                    'user',
                    [{ text: 'Target', type: 'text' }],
                    '2026-09-14T10:00:00Z',
                ),
            ]),
        );
        const brokenDirectory = path.join(root, 'broken');
        await mkdir(brokenDirectory, { recursive: true });
        await Bun.write(path.join(brokenDirectory, 'unrelated.jsonl'), '{not json\n');

        await expect(readCommandCodeSessionTranscript(root, sessionId)).resolves.toMatchObject({
            session: { filePath: sessionPath, sessionId },
        });
    });

    it('should reject an oversized targeted session before reading its contents', async () => {
        const root = await makeRoot();
        const sessionPath = path.join(root, 'target', 'oversized-session.jsonl');
        await mkdir(path.dirname(sessionPath), { recursive: true });
        await Bun.write(sessionPath, new Uint8Array(25 * 1024 * 1024 + 1));

        await expect(readCommandCodeSessionTranscript(root, 'oversized-session')).rejects.toThrow(
            'larger than 26214400 bytes',
        );
    });

    it('should group sessions by exact recorded cwd and ignore bookkeeping files', async () => {
        const root = await makeRoot();
        const firstId = 'session-one';
        const secondId = 'session-two';
        const firstCwd = '/Users/rhaq/workspace/harfbench';
        const secondCwd = '/Users/rhaq/workspace/harfbench/packages';
        await writeSession(
            root,
            'project-a',
            firstId,
            makeLinearRecords(firstId, firstCwd, [
                messageRecord('user-1', null, 'user', [{ text: 'First', type: 'text' }], '2026-09-14T10:00:00Z'),
            ]),
        );
        await writeSession(
            root,
            'project-a',
            secondId,
            makeLinearRecords(secondId, secondCwd, [
                messageRecord('user-2', null, 'user', [{ text: 'Second', type: 'text' }], '2026-09-14T11:00:00Z'),
            ]),
        );
        await Bun.write(
            path.join(root, 'project-a', `${firstId}.checkpoints.jsonl`),
            JSON.stringify({ id: 'checkpoint-only' }),
        );
        await Bun.write(path.join(root, 'project-a', 'notes.json'), JSON.stringify({ id: 'not-a-session' }));

        const summaries = await listCommandCodeSessionSummaries(root);
        const groups = await listCommandCodeWorkspaceGroups(root);

        expect(summaries.map((summary) => summary.sessionId)).toEqual([firstId, secondId]);
        expect(groups.map(({ worktree, sessionCount }) => ({ sessionCount, worktree }))).toEqual([
            { sessionCount: 1, worktree: firstCwd },
            { sessionCount: 1, worktree: secondCwd },
        ]);
    });

    it('should preserve an epoch-zero workspace timestamp', async () => {
        const root = await makeRoot();
        const sessionId = 'epoch-zero';
        await writeSession(root, 'epoch', sessionId, [
            sessionRecord(sessionId, '/workspace/epoch', '1970-01-01T00:00:00.000Z'),
            messageRecord(
                'epoch-message',
                null,
                'user',
                [{ text: 'Epoch zero', type: 'text' }],
                '1970-01-01T00:00:00.000Z',
            ),
        ]);

        await expect(listCommandCodeWorkspaceGroups(root)).resolves.toEqual([
            expect.objectContaining({ lastActiveAtMs: 0, worktree: '/workspace/epoch' }),
        ]);
    });

    it('should delete a session and its matching sidecars without deleting sibling sessions', async () => {
        const root = await makeRoot();
        const cwd = '/workspace/project';
        const sessionId = 'delete-session';
        const siblingId = 'keep-session';
        const sessionPath = await writeSession(
            root,
            'project-a',
            sessionId,
            makeLinearRecords(sessionId, cwd, [
                messageRecord(
                    'delete-message',
                    null,
                    'user',
                    [{ text: 'Delete me', type: 'text' }],
                    '2026-09-14T10:00:00Z',
                ),
            ]),
        );
        const siblingPath = await writeSession(
            root,
            'project-a',
            siblingId,
            makeLinearRecords(siblingId, cwd, [
                messageRecord(
                    'keep-message',
                    null,
                    'user',
                    [{ text: 'Keep me', type: 'text' }],
                    '2026-09-14T11:00:00Z',
                ),
            ]),
        );
        const metadataPath = sessionPath.replace(/\.jsonl$/u, '.meta.json');
        const checkpointsPath = sessionPath.replace(/\.jsonl$/u, '.checkpoints.jsonl');
        await Bun.write(metadataPath, JSON.stringify({ title: 'Delete me' }));
        await Bun.write(checkpointsPath, JSON.stringify({ checkpoint: true }));

        await expect(deleteCommandCodeSession(root, sessionId)).resolves.toEqual({
            deletedFiles: [metadataPath, checkpointsPath, sessionPath],
            deletedSessionIds: [sessionId],
        });
        expect(await Bun.file(sessionPath).exists()).toBe(false);
        expect(await Bun.file(metadataPath).exists()).toBe(false);
        expect(await Bun.file(checkpointsPath).exists()).toBe(false);
        expect(await Bun.file(siblingPath).exists()).toBe(true);
        await expect(deleteCommandCodeSession(root, '../delete-session')).resolves.toEqual({
            deletedFiles: [],
            deletedSessionIds: [],
        });
    });

    it('should delete every identical copy of a session', async () => {
        const root = await makeRoot();
        const sessionId = 'duplicate-session';
        const records = makeLinearRecords(sessionId, '/workspace/project', [
            messageRecord(
                'duplicate-message',
                null,
                'user',
                [{ text: 'Delete every copy', type: 'text' }],
                '2026-09-14T10:00:00Z',
            ),
        ]);
        const firstPath = await writeSession(root, 'project-a', sessionId, records);
        const secondPath = await writeSession(root, 'project-b', sessionId, records);

        await expect(deleteCommandCodeSession(root, sessionId)).resolves.toEqual({
            deletedFiles: [firstPath, secondPath],
            deletedSessionIds: [sessionId],
        });
        expect(await Bun.file(firstPath).exists()).toBe(false);
        expect(await Bun.file(secondPath).exists()).toBe(false);
    });

    it('should delete a malformed target and recover sidecars after the main file is gone', async () => {
        const root = await makeRoot();
        const sessionId = 'recoverable-delete';
        const directory = path.join(root, 'project');
        await mkdir(directory, { recursive: true });
        const sessionPath = path.join(directory, `${sessionId}.jsonl`);
        const metadataPath = path.join(directory, `${sessionId}.meta.json`);
        const checkpointsPath = path.join(directory, `${sessionId}.checkpoints.jsonl`);
        await Bun.write(sessionPath, '{not json\n');
        await Bun.write(metadataPath, '{"title":"Delete me"}');
        await Bun.write(checkpointsPath, '{"checkpoint":true}');

        await expect(deleteCommandCodeSession(root, sessionId)).resolves.toEqual({
            deletedFiles: [metadataPath, checkpointsPath, sessionPath],
            deletedSessionIds: [sessionId],
        });

        await Bun.write(metadataPath, '{"retry":true}');
        await expect(deleteCommandCodeSession(root, sessionId)).resolves.toEqual({
            deletedFiles: [metadataPath],
            deletedSessionIds: [sessionId],
        });
        expect(await Bun.file(sessionPath).exists()).toBe(false);
    });

    it('should fail closed when a matching sidecar is unsafe', async () => {
        const root = await makeRoot();
        const sessionId = 'unsafe-sidecar-session';
        const sessionPath = await writeSession(
            root,
            'project-a',
            sessionId,
            makeLinearRecords(sessionId, '/workspace/project', [
                messageRecord(
                    'unsafe-sidecar-message',
                    null,
                    'user',
                    [{ text: 'Keep me safe', type: 'text' }],
                    '2026-09-14T10:00:00Z',
                ),
            ]),
        );
        const metadataPath = sessionPath.replace(/\.jsonl$/u, '.meta.json');
        const outsidePath = path.join(root, 'outside.json');
        await Bun.write(outsidePath, '{}');
        await symlink(outsidePath, metadataPath);

        await expect(deleteCommandCodeSession(root, sessionId)).rejects.toThrow('Unsafe Command Code session file');
        expect(await Bun.file(sessionPath).exists()).toBe(true);
        expect(await Bun.file(metadataPath).exists()).toBe(true);
        expect(await Bun.file(outsidePath).exists()).toBe(true);
    });

    it('should fail closed for malformed, mismatched, non-linear, and conflicting sessions', async () => {
        const root = await makeRoot();
        const cwd = '/workspace/project';
        const brokenDirectory = path.join(root, 'broken');
        await mkdir(brokenDirectory, { recursive: true });
        await Bun.write(
            path.join(brokenDirectory, 'bad-json.jsonl'),
            `${JSON.stringify(sessionRecord('bad-json', cwd, '2026-09-14T10:00:00Z'))}\n{not json\n`,
        );
        await expect(listCommandCodeSessionSummaries(root)).rejects.toThrow('invalid JSONL');

        const mismatchRoot = await makeRoot();
        await writeSession(
            mismatchRoot,
            'mismatch',
            'header-id',
            [sessionRecord('different-id', cwd, '2026-09-14T10:00:00Z')],
            'header-id.jsonl',
        );
        await expect(listCommandCodeSessionSummaries(mismatchRoot)).rejects.toThrow('does not match its filename');

        const parentRoot = await makeRoot();
        await writeSession(parentRoot, 'non-linear', 'linear-check', [
            sessionRecord('linear-check', cwd, '2026-09-14T10:00:00Z'),
            messageRecord(
                'message-1',
                'wrong-parent',
                'user',
                [{ text: 'Nope', type: 'text' }],
                '2026-09-14T10:00:01Z',
            ),
        ]);
        await expect(listCommandCodeSessionSummaries(parentRoot)).rejects.toThrow('parent');

        const duplicateRoot = await makeRoot();
        const duplicateId = 'duplicate-session';
        const duplicateRecords = makeLinearRecords(duplicateId, cwd, [
            messageRecord('message-1', null, 'user', [{ text: 'one', type: 'text' }], '2026-09-14T10:00:01Z'),
        ]);
        await writeSession(duplicateRoot, 'a', duplicateId, duplicateRecords);
        await writeSession(
            duplicateRoot,
            'b',
            duplicateId,
            makeLinearRecords(duplicateId, cwd, [
                messageRecord('message-1', null, 'user', [{ text: 'different', type: 'text' }], '2026-09-14T10:00:01Z'),
            ]),
        );
        await expect(listCommandCodeSessionSummaries(duplicateRoot)).rejects.toThrow('conflicting copies');
    });
});
