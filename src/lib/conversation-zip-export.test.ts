import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import { unzipSync } from 'fflate';
import { cleanupConversationZipArtifacts, createConversationMarkdownZip } from './conversation-zip-export';

describe('createConversationMarkdownZip', () => {
    it('should byte-limit multibyte entry names and keep duplicate names unique', async () => {
        const longTitle = '会話'.repeat(100);
        const result = await createConversationMarkdownZip({
            entries: [
                {
                    cwd: '/Users/example/workspace/spiracha',
                    fallbackBaseName: 'first',
                    markdown: '# One',
                    title: longTitle,
                    updatedAtMs: Date.UTC(2026, 4, 17, 17, 11),
                },
                {
                    cwd: '/Users/example/workspace/spiracha',
                    fallbackBaseName: 'second',
                    markdown: '# Two',
                    title: longTitle,
                    updatedAtMs: Date.UTC(2026, 4, 17, 17, 12),
                },
                {
                    cwd: '/Users/example/workspace/spiracha',
                    fallbackBaseName: 'fallback-title',
                    markdown: '# Three',
                    title: '',
                    updatedAtMs: null,
                },
            ],
            fallbackProjectName: 'conversations',
            platform: 'minimax',
        });
        const archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
        const names = Object.keys(archive);

        expect(result.fileName).toBe('minimax_spiracha-2026-05-17-1712-threads-3.zip');
        expect(names).toHaveLength(3);
        expect(new Set(names).size).toBe(3);
        expect(names.every((name) => Buffer.byteLength(name) <= 255)).toBe(true);
        expect(names).toContain('fallback-title.md');
    });

    it('should clean temporary artifacts when building an entry throws', async () => {
        const fallbackProjectName = `zip-cleanup-${randomUUID()}`;
        const entry = { fallbackBaseName: 'broken', title: 'Broken' } as {
            cwd: string | null;
            fallbackBaseName: string;
            markdown: string;
            title: string;
            updatedAtMs: number | null;
        };
        entry.cwd = null;
        entry.updatedAtMs = null;
        Object.defineProperty(entry, 'markdown', {
            get: () => {
                throw new Error('synthetic markdown read failure');
            },
        });

        await expect(
            createConversationMarkdownZip({
                entries: [entry],
                fallbackProjectName,
                platform: 'cline',
            }),
        ).rejects.toThrow('synthetic markdown read failure');

        expect((await readdir(os.tmpdir())).filter((name) => name.startsWith('cline_'))).toEqual([]);
    });

    it('should retain temporary cleanup failures for reporting without throwing them', async () => {
        const failures = await cleanupConversationZipArtifacts('/tmp/workspace', '/tmp/archive.zip', async (target) => {
            if (target === '/tmp/archive.zip') {
                throw new Error('archive cleanup failed');
            }
        });

        expect(failures).toEqual([{ error: 'archive cleanup failed', path: '/tmp/archive.zip' }]);
    });
});
