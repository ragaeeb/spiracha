import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { EXPORT_ARCHIVE_MANIFEST_FILE } from '../export-archive';
import { SourceChangedError } from './operation-types';
import {
    captureNativeFileIdentity,
    createNativeRawDownload,
    createRawConversationDownload,
    readNativeFileBytes,
} from './raw-download';

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
        expect(JSON.parse(Buffer.from(members[EXPORT_ARCHIVE_MANIFEST_FILE]!).toString())).toMatchObject({
            generated: true,
            kind: 'original_raw',
            schemaVersion: 1,
            successCount: 2,
        });
    });

    it('should keep archive member names as sanitized basenames without traversal', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-raw-download-names-'));
        tempRoots.push(root);
        const sneaky = path.join(root, '..secret.jsonl');
        const reserved = path.join(root, 'con.jsonl');
        await Bun.write(sneaky, '{"sneaky":true}\n');
        await Bun.write(reserved, '{"reserved":true}\n');

        const download = await createNativeRawDownload([sneaky, reserved], 'original-assets.zip');
        const members = unzipSync(new Uint8Array(await download!.blob.arrayBuffer()));
        const nativeNames = Object.keys(members).filter((name) => name !== EXPORT_ARCHIVE_MANIFEST_FILE);

        expect(nativeNames.sort()).toEqual(['_con.jsonl', 'secret.jsonl']);
        expect(nativeNames.every((name) => name === path.posix.basename(name) && !name.includes('..'))).toBe(true);
        expect(Buffer.from(members['secret.jsonl']!).toString()).toBe('{"sneaky":true}\n');
        expect(Buffer.from(members['_con.jsonl']!).toString()).toBe('{"reserved":true}\n');
    });

    it('should refuse native bytes when the file identity drifts after capture', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-raw-download-identity-'));
        tempRoots.push(root);
        const filePath = path.join(root, 'thread.jsonl');
        await Bun.write(filePath, 'hello\n');
        const identity = await captureNativeFileIdentity(filePath);
        await Bun.write(filePath, 'world\n');

        expect(identity).not.toBeNull();
        await expect(readNativeFileBytes(filePath, identity!)).rejects.toBeInstanceOf(SourceChangedError);
    });
});
