import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import { unzipSync } from 'fflate';
import { createConversationMarkdownZip } from './conversation-zip-export';

describe('createConversationMarkdownZip', () => {
    it('should byte-limit multibyte entry names and keep duplicate names unique', async () => {
        const longTitle = '会話'.repeat(100);
        const result = await createConversationMarkdownZip({
            entries: [
                { fallbackBaseName: 'first', markdown: '# One', title: longTitle },
                { fallbackBaseName: 'second', markdown: '# Two', title: longTitle },
                { fallbackBaseName: 'fallback-title', markdown: '# Three', title: '' },
            ],
            fileBaseName: 'bundle',
        });
        const archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
        const names = Object.keys(archive);

        expect(names).toHaveLength(3);
        expect(new Set(names).size).toBe(3);
        expect(names.every((name) => Buffer.byteLength(name) <= 255)).toBe(true);
        expect(names).toContain('fallback-title.md');
    });

    it('should clean temporary artifacts when building an entry throws', async () => {
        const fileBaseName = `zip-cleanup-${randomUUID()}`;
        const entry = { fallbackBaseName: 'broken', title: 'Broken' } as {
            fallbackBaseName: string;
            markdown: string;
            title: string;
        };
        Object.defineProperty(entry, 'markdown', {
            get: () => {
                throw new Error('synthetic markdown read failure');
            },
        });

        await expect(createConversationMarkdownZip({ entries: [entry], fileBaseName })).rejects.toThrow(
            'synthetic markdown read failure',
        );

        expect((await readdir(os.tmpdir())).filter((name) => name.startsWith(fileBaseName))).toEqual([]);
    });
});
