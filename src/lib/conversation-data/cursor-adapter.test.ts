import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import type { CursorPruneResult } from '../cursor-exporter-types';
import { createCursorFixture } from '../cursor-test-helpers';
import { EXPORT_ARCHIVE_MANIFEST_FILE } from '../export-archive';
import {
    cursorConversationAdapter,
    deleteCursorConversation,
    toCursorDeleteConversationResult,
} from './cursor-adapter';
import { OriginalRepresentationUnavailableError } from './operation-types';

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('cursorConversationAdapter', () => {
    it('should report only confirmed transcript removals and preserve cleanup failures', () => {
        const result: CursorPruneResult = {
            bubblesDeleted: 1,
            cleanupFailures: [{ error: 'permission denied', path: '/failed', phase: 'transcript_directory' }],
            composerDataDeleted: 1,
            composerIds: ['thread-1'],
            headersRemoved: 1,
            transcriptDirsRemoved: 1,
            transcriptDirsRemovedPaths: ['/confirmed'],
            workspaceBucketsUpdated: 1,
        };

        expect(toCursorDeleteConversationResult(result)).toEqual({
            cleanupFailures: result.cleanupFailures,
            deletedFiles: ['/confirmed'],
            deletedIds: ['thread-1'],
        });
    });

    it('should refuse custom-directory deletes while Cursor is running', async () => {
        await expect(
            deleteCursorConversation(
                {
                    id: 'thread-1',
                    locations: { cursorUserDir: '/tmp/custom-cursor-user-dir' },
                    source: 'cursor',
                },
                async () => true,
            ),
        ).rejects.toThrow('Quit Cursor before deleting');
    });

    it('should classify intermediate assistant progress as commentary', async () => {
        const userDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-adapter-'));
        tempDirs.push(userDir);
        await createCursorFixture(userDir, {
            buckets: [
                {
                    bucketId: 'bucket-1',
                    composerIds: ['thread-1'],
                    folder: 'file:///repo',
                    threadsInComposerData: true,
                },
            ],
            headerLinks: [{ bucketId: 'bucket-1', composerId: 'thread-1', uriPath: '/repo' }],
            threads: [
                {
                    bubbles: [
                        { bubbleId: 'u1', text: 'Fix the export', type: 1 },
                        {
                            bubbleId: 'a1',
                            text: 'I will inspect the component first.',
                            toolCall: { name: 'read_file', result: 'source' },
                            type: 2,
                        },
                        {
                            bubbleId: 'a2',
                            text: 'Fixed the dialog styling and export behavior.',
                            type: 2,
                        },
                    ],
                    composerId: 'thread-1',
                    model: 'claude-sonnet-4.5',
                    name: 'Export fix',
                },
            ],
        });

        const conversation = await cursorConversationAdapter.getConversation({
            id: 'thread-1',
            locations: { cursorUserDir: userDir },
            messageSelector: 'all',
            source: 'cursor',
        });

        expect(conversation?.model).toBe('claude-sonnet-4.5');
        expect(
            conversation?.messages
                .filter((message) => message.role === 'assistant')
                .map(({ phase, text }) => ({ phase, text })),
        ).toEqual([
            { phase: 'commentary', text: 'I will inspect the component first.' },
            { phase: 'final_answer', text: 'Fixed the dialog styling and export behavior.' },
        ]);
        expect(
            conversation?.messages
                .filter((message) => message.role === 'tool')
                .map(({ phase, text }) => ({ phase, text })),
        ).toEqual([
            { phase: 'tool_call', text: 'read_file\n{}' },
            { phase: 'tool_output', text: 'source' },
        ]);
        expect(conversation?.metadata).not.toHaveProperty('transcriptDirs');
        expect(conversation?.messages.find((message) => message.phase === 'tool_call')?.toolEvidence).toMatchObject({
            name: 'read_file',
        });
    });

    it('should list path-scoped Cursor conversations within an updated-time window', async () => {
        const userDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-adapter-list-'));
        tempDirs.push(userDir);
        await createCursorFixture(userDir, {
            buckets: [
                {
                    bucketId: 'bucket-1',
                    composerIds: ['thread-in-window'],
                    folder: 'file:///repo',
                    threadsInComposerData: true,
                },
            ],
            headerLinks: [{ bucketId: 'bucket-1', composerId: 'thread-in-window', uriPath: '/repo' }],
            threads: [
                {
                    bubbles: [{ bubbleId: 'u1', text: 'Scoped thread', type: 1 }],
                    composerId: 'thread-in-window',
                    lastUpdatedAt: 200,
                    name: 'Scoped Cursor thread',
                },
            ],
        });

        const conversations = await cursorConversationAdapter.listConversations({
            cwd: '/repo',
            includeMessages: false,
            locations: { cursorUserDir: userDir },
            updatedAfterMs: 100,
            updatedBeforeMs: 300,
        });
        const excluded = await cursorConversationAdapter.listConversations({
            cwd: '/repo',
            locations: { cursorUserDir: userDir },
            updatedBeforeMs: 100,
        });

        expect(conversations.map(({ id }) => id)).toEqual(['thread-in-window']);
        expect(conversations[0]?.matches[0]?.kind).toBe('exact');
        expect(conversations[0]?.messages).toEqual([]);
        expect(excluded).toEqual([]);
    });

    it('should reuse one Cursor discovery for repeated path-scoped lists including time filters', async () => {
        const userDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-adapter-reuse-'));
        tempDirs.push(userDir);
        await createCursorFixture(userDir, {
            buckets: [
                {
                    bucketId: 'bucket-1',
                    composerIds: ['thread-in-window'],
                    folder: 'file:///repo',
                    threadsInComposerData: true,
                },
                {
                    bucketId: 'bucket-2',
                    composerIds: ['other-workspace-thread'],
                    folder: 'file:///other',
                    threadsInComposerData: true,
                },
            ],
            headerLinks: [
                { bucketId: 'bucket-1', composerId: 'thread-in-window', uriPath: '/repo' },
                { bucketId: 'bucket-2', composerId: 'other-workspace-thread', uriPath: '/other' },
            ],
            threads: [
                {
                    bubbles: [{ bubbleId: 'u1', text: 'Scoped thread', type: 1 }],
                    composerId: 'thread-in-window',
                    lastUpdatedAt: 200,
                    name: 'Scoped Cursor thread',
                },
                {
                    bubbles: [{ bubbleId: 'u2', text: 'Other workspace', type: 1 }],
                    composerId: 'other-workspace-thread',
                    lastUpdatedAt: 250,
                    name: 'Other workspace thread',
                },
            ],
        });

        const { Database } = await import('bun:sqlite');
        const originalQuery = Database.prototype.query;
        let headScanCount = 0;
        Database.prototype.query = function (this: InstanceType<typeof Database>, sql: string) {
            if (
                sql.includes("SELECT substr(key, length('composerData:') + 1) AS id") &&
                sql.includes('FROM cursorDiskKV')
            ) {
                headScanCount += 1;
            }
            return originalQuery.call(this, sql);
        } as typeof originalQuery;

        try {
            const first = await cursorConversationAdapter.listConversations({
                cwd: '/repo',
                includeMessages: false,
                locations: { cursorUserDir: userDir },
                updatedAfterMs: 100,
                updatedBeforeMs: 300,
            });
            const second = await cursorConversationAdapter.listConversations({
                cwd: '/repo',
                includeMessages: false,
                locations: { cursorUserDir: userDir },
                updatedAfterMs: 100,
                updatedBeforeMs: 300,
            });
            const otherWorkspace = await cursorConversationAdapter.listConversations({
                cwd: '/other',
                locations: { cursorUserDir: userDir },
            });

            expect(first.map(({ id, workspacePath }) => ({ id, workspacePath }))).toEqual([
                { id: 'thread-in-window', workspacePath: '/repo' },
            ]);
            expect(second.map(({ id }) => id)).toEqual(['thread-in-window']);
            expect(otherWorkspace.map(({ id, workspacePath }) => ({ id, workspacePath }))).toEqual([
                { id: 'other-workspace-thread', workspacePath: '/other' },
            ]);
            expect(headScanCount).toBe(1);
        } finally {
            Database.prototype.query = originalQuery;
        }
    });

    it('should export discovered agent transcript JSONL files and never the shared database', async () => {
        const userDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-adapter-raw-'));
        tempDirs.push(userDir);
        await createCursorFixture(userDir, {
            buckets: [{ bucketId: 'bucket-1', composerIds: ['thread-1'], folder: 'file:///repo' }],
            headerLinks: [{ bucketId: 'bucket-1', composerId: 'thread-1', uriPath: '/repo' }],
            threads: [{ bubbles: [{ bubbleId: 'u1', text: 'Hello', type: 1 }], composerId: 'thread-1' }],
        });
        const transcriptDir = path.join(userDir, 'projects', 'demo-project', 'agent-transcripts', 'thread-1');
        await mkdir(transcriptDir, { recursive: true });
        const preferred = path.join(transcriptDir, 'thread-1.jsonl');
        const replica = path.join(transcriptDir, 'replica.jsonl');
        await Bun.write(preferred, '{"role":"user"}\n');
        await Bun.write(replica, '{"role":"assistant"}\n');

        const download = await cursorConversationAdapter.getConversationRaw({
            id: 'thread-1',
            locations: { cursorUserDir: userDir },
            source: 'cursor',
        });
        const members = unzipSync(new Uint8Array(await download!.blob.arrayBuffer()));

        expect(download?.mimeType).toBe('application/zip');
        expect(
            Object.keys(members)
                .filter((name) => name !== EXPORT_ARCHIVE_MANIFEST_FILE)
                .sort(),
        ).toEqual(['replica.jsonl', 'thread-1.jsonl']);
        expect(members[EXPORT_ARCHIVE_MANIFEST_FILE]).toBeDefined();
        expect(Buffer.from(members['thread-1.jsonl']!).toString()).toBe('{"role":"user"}\n');
        expect(Buffer.from(members['replica.jsonl']!).toString()).toBe('{"role":"assistant"}\n');
        expect(Object.keys(members).some((name) => name.endsWith('.vscdb'))).toBe(false);
    });

    it('should report DB-only Cursor conversations as original representation unavailable', async () => {
        const userDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-adapter-raw-db-'));
        tempDirs.push(userDir);
        await createCursorFixture(userDir, {
            buckets: [{ bucketId: 'bucket-1', composerIds: ['thread-1'], folder: 'file:///repo' }],
            headerLinks: [{ bucketId: 'bucket-1', composerId: 'thread-1', uriPath: '/repo' }],
            threads: [{ bubbles: [{ bubbleId: 'u1', text: 'Hello', type: 1 }], composerId: 'thread-1' }],
        });

        await expect(
            cursorConversationAdapter.getConversationRaw({
                id: 'thread-1',
                locations: { cursorUserDir: userDir },
                source: 'cursor',
            }),
        ).rejects.toBeInstanceOf(OriginalRepresentationUnavailableError);
    });
});
