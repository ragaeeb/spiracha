import { describe, expect, it } from 'bun:test';
import {
    type CodexRolloutContentError,
    type CodexRolloutIdentity,
    CodexRolloutMutationError,
    type CodexRolloutSourceError,
    copyStableCodexRollout,
} from './codex-rollout-snapshot';

const identity = (overrides: Partial<CodexRolloutIdentity> = {}) => ({
    changeTimeMs: 2,
    inode: 1,
    modificationTimeMs: 3,
    sizeBytes: 4,
    ...overrides,
});

describe('Codex rollout snapshots', () => {
    it('should copy and accept a rollout when source identity remains stable', async () => {
        const copied: string[] = [];

        const result = await copyStableCodexRollout(
            {
                attempt: 1,
                snapshotPath: '/tmp/attempt.jsonl',
                sourcePath: '/tmp/source.jsonl',
                threadId: 'thread-1',
            },
            {
                copy: async (sourcePath, snapshotPath) => {
                    copied.push(`${sourcePath}->${snapshotPath}`);
                    return 4;
                },
                hash: async () => 'stable-content',
                stat: async () => identity(),
            },
        );

        expect(copied).toEqual(['/tmp/source.jsonl->/tmp/attempt.jsonl']);
        expect(result).toMatchObject({ attempt: 1, threadId: 'thread-1' });
    });

    it('should reject a source that changes while the snapshot is copied', async () => {
        let statCall = 0;
        let hashCall = 0;

        await expect(
            copyStableCodexRollout(
                {
                    attempt: 2,
                    snapshotPath: '/tmp/attempt.jsonl',
                    sourcePath: '/tmp/source.jsonl',
                    threadId: 'thread-2',
                },
                {
                    copy: async () => 4,
                    hash: async () => {
                        hashCall += 1;
                        return hashCall === 3 ? 'changed-content' : 'stable-content';
                    },
                    stat: async () => {
                        statCall += 1;
                        return identity(statCall === 2 ? { sizeBytes: 5 } : {});
                    },
                },
            ),
        ).rejects.toBeInstanceOf(CodexRolloutMutationError);
    });

    it('should accept metadata churn when the source content still matches the snapshot', async () => {
        let statCall = 0;

        await expect(
            copyStableCodexRollout(
                {
                    attempt: 2,
                    snapshotPath: '/tmp/attempt.jsonl',
                    sourcePath: '/tmp/source.jsonl',
                    threadId: 'thread-metadata-churn',
                },
                {
                    copy: async () => 4,
                    hash: async () => 'stable-content',
                    stat: async () => {
                        statCall += 1;
                        return identity(statCall === 2 ? { inode: 9, modificationTimeMs: 8 } : {});
                    },
                },
            ),
        ).resolves.toMatchObject({ threadId: 'thread-metadata-churn' });
    });

    it('should reject a snapshot when the copy reports a byte mismatch', async () => {
        await expect(
            copyStableCodexRollout(
                {
                    attempt: 1,
                    snapshotPath: '/tmp/attempt.jsonl',
                    sourcePath: '/tmp/source.jsonl',
                    threadId: 'thread-truncated',
                },
                {
                    copy: async () => 3,
                    hash: async () => 'stable-content',
                    stat: async () => identity({ sizeBytes: 4 }),
                },
            ),
        ).rejects.toMatchObject({
            actualBytes: 3,
            code: 'CODEX_ROLLOUT_CONTENT_INVALID',
            expectedBytes: 4,
            threadId: 'thread-truncated',
        } satisfies Partial<CodexRolloutContentError>);
    });

    it('should reject a same-size snapshot whose content hash differs', async () => {
        let hashCall = 0;

        await expect(
            copyStableCodexRollout(
                {
                    attempt: 1,
                    snapshotPath: '/tmp/attempt.jsonl',
                    sourcePath: '/tmp/source.jsonl',
                    threadId: 'thread-torn-copy',
                },
                {
                    copy: async () => 4,
                    hash: async () => {
                        hashCall += 1;
                        return hashCall === 1 ? 'source-content' : 'snapshot-content';
                    },
                    stat: async () => identity(),
                },
            ),
        ).rejects.toMatchObject({
            actualHash: 'snapshot-content',
            code: 'CODEX_ROLLOUT_CONTENT_INVALID',
            expectedHash: 'source-content',
            threadId: 'thread-torn-copy',
        });
    });

    it('should classify a missing source during stat as missing', async () => {
        const error = Object.assign(new Error('missing'), { code: 'ENOENT' });

        await expect(
            copyStableCodexRollout(
                {
                    attempt: 1,
                    snapshotPath: '/tmp/attempt.jsonl',
                    sourcePath: '/tmp/source.jsonl',
                    threadId: 'thread-missing',
                },
                {
                    copy: async () => 4,
                    hash: async () => 'stable-content',
                    stat: async () => {
                        throw error;
                    },
                },
            ),
        ).rejects.toMatchObject({
            cause: error,
            code: 'CODEX_ROLLOUT_MISSING',
            sourcePath: '/tmp/source.jsonl',
            threadId: 'thread-missing',
        } satisfies Partial<CodexRolloutSourceError>);
    });

    it('should classify an unreadable source during copy and preserve its cause', async () => {
        const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });

        await expect(
            copyStableCodexRollout(
                {
                    attempt: 1,
                    snapshotPath: '/tmp/attempt.jsonl',
                    sourcePath: '/tmp/source.jsonl',
                    threadId: 'thread-unreadable',
                },
                {
                    copy: async () => {
                        throw error;
                    },
                    hash: async () => 'stable-content',
                    stat: async () => identity(),
                },
            ),
        ).rejects.toMatchObject({
            cause: error,
            code: 'CODEX_ROLLOUT_UNREADABLE',
            sourcePath: '/tmp/source.jsonl',
            threadId: 'thread-unreadable',
        } satisfies Partial<CodexRolloutSourceError>);
    });
});
