import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { renderRawConversationDownloads } from '../ui/lib/source-session-export-server';
import type { ConversationRawDownload } from './conversation-data/types';
import { createProductionUiFetch } from './production-ui-server';
import { decodeRawDownloadBase64 } from './raw-export-contract';
import { UI_EXPORT_DIR_ENV, UI_EXPORT_URL_PREFIX } from './ui-export-files';

const roots: string[] = [];
const previousExportDirectory = process.env[UI_EXPORT_DIR_ENV];
const original = new Uint8Array([0, 255, 192, 65, 13, 10]);
const raw = (fileName: string): ConversationRawDownload => ({
    blob: new Blob([original]),
    fileName,
    mimeType: 'application/json',
});

const isolateExports = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-raw-contract-'));
    roots.push(root);
    process.env[UI_EXPORT_DIR_ENV] = root;
    return root;
};

afterEach(async () => {
    if (previousExportDirectory === undefined) {
        delete process.env[UI_EXPORT_DIR_ENV];
    } else {
        process.env[UI_EXPORT_DIR_ENV] = previousExportDirectory;
    }
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('raw export end-to-end helpers', () => {
    it('should preserve invalid UTF-8 in the single UI transport without producing a text result', async () => {
        const result = await renderRawConversationDownloads({
            downloads: [{ download: raw('replica.blob'), id: 'chat' }],
            source: 'grok-bot',
        });
        if (result.mode !== 'download_base64') {
            throw new Error('Expected inline binary transport');
        }
        expect(result.fileName).toBe('replica.blob');
        expect(result.mimeType).toBe('application/json');
        expect(decodeRawDownloadBase64(result.contentBase64)).toEqual(original);
    });

    it('should preserve raw bytes and native extensions in real ZIP members and production downloads', async () => {
        const root = await isolateExports();
        const result = await renderRawConversationDownloads({
            downloads: [
                { download: raw('replica.blob'), id: 'one' },
                { download: raw('replica.blob'), id: 'two' },
                { download: raw('events.jsonl'), id: 'three' },
            ],
            source: 'grok-bot',
        });
        if (result.mode !== 'download_url') {
            throw new Error('Expected archive download');
        }
        const fileName = decodeURIComponent(result.downloadUrl.slice(UI_EXPORT_URL_PREFIX.length));
        const onDisk = new Uint8Array(await Bun.file(path.join(root, fileName)).arrayBuffer());
        const members = unzipSync(onDisk);
        expect(Object.keys(members).sort()).toEqual(
            ['events.jsonl', 'replica-2.blob', 'replica.blob', 'spiracha-manifest.json'].sort(),
        );
        for (const [name, bytes] of Object.entries(members)) {
            if (name === 'spiracha-manifest.json') {
                continue;
            }
            expect(bytes).toEqual(original);
        }
        const fetch = createProductionUiFetch({
            appFetch: () => new Response(null, { status: 404 }),
            clientDirectory: root,
        });
        const response = await fetch(new Request(`http://127.0.0.1:3000${result.downloadUrl}`));
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/zip');
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(onDisk);
        const head = await fetch(new Request(`http://127.0.0.1:3000${result.downloadUrl}`, { method: 'HEAD' }));
        expect(head.status).toBe(200);
        expect(await head.text()).toBe('');
    });

    it('should archive a large single raw body instead of serializing unbounded inline bytes', async () => {
        const root = await isolateExports();
        const result = await renderRawConversationDownloads({
            downloads: [{ download: raw('events.jsonl'), id: 'one' }],
            largeExportThresholdBytes: 1,
            source: 'codex',
        });
        if (result.mode !== 'download_url') {
            throw new Error('Expected archive download above the inline threshold');
        }
        const fileName = decodeURIComponent(result.downloadUrl.slice(UI_EXPORT_URL_PREFIX.length));
        const members = unzipSync(new Uint8Array(await Bun.file(path.join(root, fileName)).arrayBuffer()));
        expect(Object.keys(members)).toEqual(['events.jsonl']);
        expect(members['events.jsonl']).toEqual(original);
    });

    it('should reject an empty raw selection', async () => {
        await expect(renderRawConversationDownloads({ downloads: [], source: 'codex' })).rejects.toThrow(
            'No raw conversations selected',
        );
    });
});
