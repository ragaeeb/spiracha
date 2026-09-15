import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    deleteCommandCodeSession,
    isCommandCodeWriterRunning,
    planCommandCodeDeletion,
} from './command-code-mutations';
import { SourceMutationConflictError } from './conversation-data/operation-types';

const tempRoots: string[] = [];
const stoppedWriter = { isWriterRunning: async () => false };

const makeRoot = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'command-code-mutations-'));
    tempRoots.push(root);
    return root;
};

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

const writeSessionFiles = async (root: string, project: string, sessionId: string, extras: string[] = []) => {
    const directory = path.join(root, project);
    await mkdir(directory, { recursive: true });
    const jsonl = path.join(directory, `${sessionId}.jsonl`);
    const meta = path.join(directory, `${sessionId}.meta.json`);
    const checkpoints = path.join(directory, `${sessionId}.checkpoints.jsonl`);
    await Bun.write(jsonl, `${JSON.stringify({ cwd: '/workspace/project', id: sessionId, type: 'session' })}\n`);
    await Bun.write(meta, '{"title":"owned"}');
    await Bun.write(checkpoints, '{"checkpoint":true}');
    await Promise.all(extras.map((name) => Bun.write(path.join(directory, name), JSON.stringify({ keep: true }))));
    return { checkpoints, jsonl, meta };
};

describe('planCommandCodeDeletion', () => {
    it('should plan exact three suffixes for the same id in two projects and ignore suffix lookalikes', async () => {
        const root = await makeRoot();
        const first = await writeSessionFiles(root, 'project-a', 'session-a', ['session-a-extra.jsonl']);
        const second = await writeSessionFiles(root, 'project-b', 'session-a');
        const sibling = await writeSessionFiles(root, 'project-a', 'other-session');

        const plan = await planCommandCodeDeletion(root, 'session-a');

        expect(plan.ownedFiles.map((file) => file.path)).toEqual([
            first.meta,
            first.checkpoints,
            first.jsonl,
            second.meta,
            second.checkpoints,
            second.jsonl,
        ]);
        expect(plan.ownedFiles.every((file) => file.nlink === 1)).toBe(true);
        expect(await Bun.file(path.join(root, 'project-a', 'session-a-extra.jsonl')).exists()).toBe(true);
        expect(await Bun.file(sibling.jsonl).exists()).toBe(true);
    });

    it('should not treat another session as owned because a record parentId references it', async () => {
        const root = await makeRoot();
        const childDir = path.join(root, 'project-a');
        await mkdir(childDir, { recursive: true });
        const childPath = path.join(childDir, 'child-session.jsonl');
        const parentPath = path.join(childDir, 'parent-session.jsonl');
        await Bun.write(
            childPath,
            `${JSON.stringify({ id: 'child-session', parentId: 'parent-session', type: 'message' })}\n`,
        );
        await Bun.write(parentPath, `${JSON.stringify({ id: 'parent-session', type: 'session' })}\n`);

        const plan = await planCommandCodeDeletion(root, 'child-session');
        expect(plan.ownedFiles.map((file) => file.path)).toEqual([childPath]);
    });
});

describe('deleteCommandCodeSession', () => {
    it('should keep missing meta and checkpoint unlinks idempotent', async () => {
        const root = await makeRoot();
        const files = await writeSessionFiles(root, 'project-a', 'session-a');
        await unlink(files.meta);

        await expect(deleteCommandCodeSession(root, 'session-a', stoppedWriter)).resolves.toEqual({
            deletedFiles: [files.checkpoints, files.jsonl],
            deletedSessionIds: ['session-a'],
        });
        await expect(deleteCommandCodeSession(root, 'session-a', stoppedWriter)).resolves.toEqual({
            deletedFiles: [],
            deletedSessionIds: [],
        });
    });

    it('should retain earlier unlinks when a later sidecar fails', async () => {
        const root = await makeRoot();
        const files = await writeSessionFiles(root, 'project-a', 'session-a');
        const result = await deleteCommandCodeSession(root, 'session-a', {
            ...stoppedWriter,
            unlinkFile: async (filePath) => {
                if (filePath === files.checkpoints) {
                    throw new Error('injected unlink failure');
                }
                await unlink(filePath);
            },
        });

        expect(result.deletedFiles).toEqual([files.meta]);
        expect(result.deletedSessionIds).toEqual(['session-a']);
        expect(result.receiptId).toMatch(/^\.spiracha-command-code-delete-[0-9a-f]{16}\.json$/u);
        expect(result.cleanupFailures?.[0]).toMatchObject({ path: files.checkpoints, phase: 'file-cleanup' });
        expect(await Bun.file(files.meta).exists()).toBe(false);
        expect(await Bun.file(files.checkpoints).exists()).toBe(true);
        expect(await Bun.file(files.jsonl).exists()).toBe(true);
        expect(await Bun.file(path.join(root, result.receiptId!)).exists()).toBe(true);
    });

    it('should resume from intent after the main transcript disappears', async () => {
        const root = await makeRoot();
        const files = await writeSessionFiles(root, 'project-a', 'session-a');
        await expect(
            deleteCommandCodeSession(root, 'session-a', {
                ...stoppedWriter,
                afterIntent: async () => {
                    throw new Error('injected crash after intent');
                },
            }),
        ).rejects.toThrow('injected crash after intent');
        await unlink(files.jsonl);

        const retry = await deleteCommandCodeSession(root, 'session-a', stoppedWriter);
        expect(retry.deletedFiles.sort()).toEqual([files.checkpoints, files.meta].sort());
        expect(retry.deletedSessionIds).toEqual(['session-a']);
        expect(retry.receiptId).toBeUndefined();
        expect(await Bun.file(files.meta).exists()).toBe(false);
        expect(await Bun.file(files.checkpoints).exists()).toBe(false);
        expect(await Bun.file(files.jsonl).exists()).toBe(false);
    });

    it('should refuse replay when a captured file is replaced by a symlink', async () => {
        const root = await makeRoot();
        const files = await writeSessionFiles(root, 'project-a', 'session-a');
        const outside = path.join(root, 'outside.jsonl');
        await Bun.write(outside, 'replacement\n');

        const first = await deleteCommandCodeSession(root, 'session-a', {
            ...stoppedWriter,
            unlinkFile: async (filePath) => {
                if (filePath === files.jsonl) {
                    throw new Error('stop before transcript');
                }
                await unlink(filePath);
            },
        });
        await unlink(files.jsonl);
        await symlink(outside, files.jsonl);

        const retry = await deleteCommandCodeSession(root, 'session-a', stoppedWriter);
        expect(retry.deletedFiles).toEqual([files.meta, files.checkpoints]);
        expect(retry.cleanupFailures?.[0]).toMatchObject({ path: files.jsonl, phase: 'file-cleanup' });
        expect(retry.receiptId).toBe(first.receiptId);
        expect(await Bun.file(outside).text()).toBe('replacement\n');
        expect(await Bun.file(files.jsonl).exists()).toBe(true);
    });

    it('should refuse deletion while a configured writer is running', async () => {
        const root = await makeRoot();
        await writeSessionFiles(root, 'project-a', 'session-a');
        await expect(
            deleteCommandCodeSession(root, 'session-a', { isWriterRunning: async () => true }),
        ).rejects.toBeInstanceOf(SourceMutationConflictError);
        expect(await Bun.file(path.join(root, 'project-a', 'session-a.jsonl')).exists()).toBe(true);
    });

    it('should classify only pgrep statuses zero and one when a writer process is configured', async () => {
        const processWithExitCode = (exitCode: number) => () => ({ exited: Promise.resolve(exitCode) });
        await expect(isCommandCodeWriterRunning(processWithExitCode(0), '')).resolves.toBe(false);
        await expect(isCommandCodeWriterRunning(processWithExitCode(0), 'CommandCode')).resolves.toBe(true);
        await expect(isCommandCodeWriterRunning(processWithExitCode(1), 'CommandCode')).resolves.toBe(false);
        await expect(isCommandCodeWriterRunning(processWithExitCode(2), 'CommandCode')).rejects.toThrow(
            'Unable to verify whether Command Code is running: pgrep exited with status 2',
        );
    });
});
