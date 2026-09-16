import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { createNativeRawDownload, createRawConversationDownload } from './raw-download';

const tempRoots: string[] = [];

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('raw conversation downloads', () => {
    it('should expose JSON source bytes without parsing or rewriting them', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-raw-download-'));
        tempRoots.push(root);
        const filePath = path.join(root, 'transcript.json');
        const original = '{"z":1, "spacing":  true}\n';
        await Bun.write(filePath, original);

        const download = await createRawConversationDownload(filePath);

        expect(download).toMatchObject({ fileName: 'transcript.json', mimeType: 'application/json' });
        expect(new Uint8Array(await download!.blob.arrayBuffer())).toEqual(new TextEncoder().encode(original));
    });

    it('should reject missing and non-JSON source files', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-raw-download-'));
        tempRoots.push(root);

        await expect(createRawConversationDownload(path.join(root, 'missing.jsonl'))).resolves.toBeNull();
        await expect(createRawConversationDownload(path.join(root, 'state.sqlite'))).resolves.toBeNull();
    });

    it('should keep original native file bytes identical inside a stored zip', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-raw-download-zip-'));
        tempRoots.push(root);
        const first = path.join(root, 'a.jsonl');
        const second = path.join(root, 'b.json');
        const firstBytes = '{"z":1}\n';
        const secondBytes = '{ "keep": true }\n';
        await Bun.write(first, firstBytes);
        await Bun.write(second, secondBytes);

        const download = await createNativeRawDownload([first, second], 'original-assets.zip');
        const members = unzipSync(new Uint8Array(await download!.blob.arrayBuffer()));

        expect(download?.fileName).toBe('original-assets.zip');
        expect(Buffer.from(members['a.jsonl']!).toString()).toBe(firstBytes);
        expect(Buffer.from(members['b.json']!).toString()).toBe(secondBytes);
    });
});
