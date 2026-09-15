import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import { strFromU8, unzipSync } from 'fflate';
import { cleanupConversationZipArtifacts, createConversationMarkdownZip } from './conversation-zip-export';

const entry = (title: string, markdown: string, index: number) => ({
    cwd: null,
    fallbackBaseName: `conversation-${index}`,
    markdown,
    title,
    updatedAtMs: null,
});

describe('conversation archive content integrity', () => {
    it('should preserve every body when case, Unicode normalization and generated suffixes collide', async () => {
        const titles = ['Café', 'Cafe\u0301', 'CAFÉ', 'Café-2', '../unsafe/name', '<>:"/\\|?*'];
        const contents = titles.map((_, index) => `# Entry ${index}\r\n\r\n\0 Exact 🔥 body ${index}\r\n`);
        const result = await createConversationMarkdownZip({
            entries: titles.map((title, index) => entry(title, contents[index], index)),
            fallbackProjectName: 'integrity-fixture',
            platform: 'codex',
        });
        const archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
        const names = Object.keys(archive);
        expect(result.mimeType).toBe('application/zip');
        expect(result.blob.type).toBe('application/zip');
        expect(names).toHaveLength(titles.length);
        expect(new Set(names.map((name) => name.normalize('NFC').toLowerCase())).size).toBe(titles.length);
        expect(names.every((name) => !name.includes('/') && !name.includes('\\') && !name.includes('..'))).toBe(true);
        expect(Object.values(archive).map((bytes) => strFromU8(bytes)).sort()).toEqual(contents.toSorted());
    });

    it('should return a readable archive after removing its own temporary artifacts', async () => {
        const project = `integrity-${randomUUID()}`;
        const result = await createConversationMarkdownZip({
            entries: [entry('One', '# One\n', 0)],
            fallbackProjectName: project,
            platform: 'codex',
        });
        expect((await readdir(os.tmpdir())).filter((name) => name.startsWith(`codex_${project}-`))).toEqual([]);
        const archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
        expect(strFromU8(archive['One.md'])).toBe('# One\n');
    });

    it('should reject an empty export selection', async () => {
        await expect(createConversationMarkdownZip({
            entries: [],
            fallbackProjectName: 'empty',
            platform: 'codex',
        })).rejects.toThrow('No conversations selected');
    });

    it('should report both cleanup failures in artifact order even when they reject differently', async () => {
        const calls: string[] = [];
        const failures = await cleanupConversationZipArtifacts('/fixture/workspace', '/fixture/archive.zip', async (target) => {
            calls.push(String(target));
            if (String(target).endsWith('.zip')) {
                return Promise.reject('archive failure');
            }
            throw new Error('workspace failure');
        });
        expect(calls.toSorted()).toEqual(['/fixture/archive.zip', '/fixture/workspace']);
        expect(failures).toEqual([
            { error: 'workspace failure', path: '/fixture/workspace' },
            { error: 'archive failure', path: '/fixture/archive.zip' },
        ]);
    });
});
