import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UI_EXPORT_DIR_ENV, UI_EXPORT_URL_PREFIX } from '@spiracha/lib/ui-export-files';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    renderRawConversationDownloads,
    renderSourceSessionDownload,
    renderSourceSessionsDownload,
} from './source-session-export-server';

vi.mock('@spiracha/lib/ui-export-archive', async () => {
    const actual = await vi.importActual<typeof import('@spiracha/lib/ui-export-archive')>(
        '@spiracha/lib/ui-export-archive',
    );
    return actual;
});

vi.mock('@spiracha/lib/ui-export-zip', () => {
    return {
        zipExportDirectory: vi.fn(async (_sourceDirectory: string, zipPath: string) => {
            const fs = await import('node:fs/promises');
            await fs.writeFile(zipPath, 'zip');
        }),
    };
});

let exportDir: string;
let previousExportDir: string | undefined;
let bunWriteMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
    previousExportDir = process.env[UI_EXPORT_DIR_ENV];
    exportDir = await mkdtemp(path.join(os.tmpdir(), 'spiracha-source-session-export-test-'));
    process.env[UI_EXPORT_DIR_ENV] = exportDir;
    bunWriteMock = vi.fn(async (target: string, content: string | ArrayBuffer) => {
        const fs = await import('node:fs/promises');
        await fs.writeFile(target, typeof content === 'string' ? content : new Uint8Array(content));
    });
    vi.stubGlobal('Bun', {
        write: bunWriteMock,
    });
});

afterEach(async () => {
    if (previousExportDir === undefined) {
        delete process.env[UI_EXPORT_DIR_ENV];
    } else {
        process.env[UI_EXPORT_DIR_ENV] = previousExportDir;
    }

    await rm(exportDir, { force: true, recursive: true });
    vi.unstubAllGlobals();
});

const resolveDownloadPath = (downloadUrl: string) => {
    expect(downloadUrl.startsWith(UI_EXPORT_URL_PREFIX)).toBe(true);
    const fileName = decodeURIComponent(downloadUrl.slice(UI_EXPORT_URL_PREFIX.length));
    return path.join(exportDir, fileName);
};

describe('source session export server helpers', () => {
    it('should move oversized single-session exports to a download URL', async () => {
        const result = await renderSourceSessionDownload({
            content: '# Session',
            cwd: '/Users/example/workspace/spiracha',
            fallbackBaseName: 'source-session',
            largeExportThresholdBytes: 1,
            outputFormat: 'md',
            platform: 'claude',
            sessionId: '019e36d7-ba2d-7fa1-b662-3f70fbbda248',
            updatedAtMs: Date.UTC(2026, 4, 17, 17, 12),
            zipArchive: false,
        });

        expect(result.mode).toBe('download_url');
        if (result.mode !== 'download_url') {
            throw new Error('expected a zip download URL');
        }
        expect(result.fileName).toBe('claude_spiracha-2026-05-17-1712-019e36d7.zip');
    });

    it('should keep a single unzipped source session export inline', async () => {
        const result = await renderSourceSessionsDownload({
            entries: [
                {
                    content: '# Session',
                    cwd: '/Users/example/workspace/spiracha',
                    fallbackBaseName: 'source-session',
                    fileBaseName: 'My session',
                    sessionId: '019e36d7-ba2d-7fa1-b662-3f70fbbda248',
                    updatedAtMs: Date.UTC(2026, 4, 17, 17, 12),
                },
            ],
            fallbackBaseName: 'source-sessions',
            outputFormat: 'md',
            platform: 'cline',
            zipArchive: false,
        });

        expect(result).toEqual({
            content: '# Session',
            fileName: 'spiracha-2026-05-17-1712-019e36d7.md',
            mimeType: 'text/markdown; charset=utf-8',
            mode: 'download',
        });
    });

    it('should prefix a single source-session archive with its platform', async () => {
        const result = await renderSourceSessionsDownload({
            entries: [
                {
                    content: '# Session',
                    cwd: '/Users/example/workspace/spiracha',
                    fallbackBaseName: 'source-session',
                    fileBaseName: 'My session',
                    sessionId: '019e36d7-ba2d-7fa1-b662-3f70fbbda248',
                    updatedAtMs: Date.UTC(2026, 4, 17, 17, 12),
                },
            ],
            fallbackBaseName: 'source-sessions',
            outputFormat: 'md',
            platform: 'cline',
            zipArchive: true,
        });

        expect(result.mode).toBe('download_url');
        if (result.mode !== 'download_url') {
            throw new Error('expected a zip download URL');
        }
        expect(result.fileName).toBe('cline_spiracha-2026-05-17-1712-019e36d7.zip');
    });

    it('should zip multiple source session exports', async () => {
        const result = await renderSourceSessionsDownload({
            entries: [
                {
                    content: '# First',
                    cwd: '/Users/example/workspace/spiracha',
                    fallbackBaseName: 'source-session',
                    fileBaseName: 'Repeated title',
                    sessionId: '019e36d7-ba2d-7fa1-b662-3f70fbbda248',
                    updatedAtMs: Date.UTC(2026, 4, 17, 17, 12),
                },
                {
                    content: '# Second',
                    cwd: '/Users/example/workspace/spiracha',
                    fallbackBaseName: 'source-session',
                    fileBaseName: 'Repeated title',
                    sessionId: '019e33a9-a225-7433-b299-6cb1ed299ffb',
                    updatedAtMs: Date.UTC(2026, 4, 17, 17, 11),
                },
            ],
            fallbackBaseName: 'source-sessions',
            outputFormat: 'md',
            platform: 'minimax',
            zipArchive: false,
        });

        expect(result.mode).toBe('download_url');
        if (result.mode !== 'download_url') {
            throw new Error('expected a zip download URL');
        }
        expect(result.fileName).toBe('minimax_spiracha-2026-05-17-1712-threads-2.zip');
        const metadata = await stat(resolveDownloadPath(result.downloadUrl));
        expect(metadata.isFile()).toBe(true);
    });

    it('should preserve raw conversation bytes with source and conversation filenames', async () => {
        const firstContent = '{"id":1}\n';
        const secondContent = '{"id":2}\n';
        const single = await renderRawConversationDownloads({
            downloads: [
                {
                    download: {
                        blob: new Blob([firstContent]),
                        fileName: 'messages.jsonl',
                        mimeType: 'application/x-ndjson',
                    },
                    id: 'task-1',
                },
            ],
            source: 'cline',
        });

        expect(single).toEqual({
            content: firstContent,
            fileName: 'cline-task-1.json',
            mimeType: 'application/x-ndjson',
            mode: 'download',
        });

        bunWriteMock.mockClear();
        const batch = await renderRawConversationDownloads({
            downloads: [
                {
                    download: {
                        blob: new Blob([firstContent]),
                        fileName: 'messages.jsonl',
                        mimeType: 'application/x-ndjson',
                    },
                    id: 'task-1',
                },
                {
                    download: {
                        blob: new Blob([secondContent]),
                        fileName: 'messages.jsonl',
                        mimeType: 'application/x-ndjson',
                    },
                    id: 'task-2',
                },
            ],
            source: 'cline',
        });

        expect(batch.mode).toBe('download_url');
        if (batch.mode !== 'download_url') {
            throw new Error('expected a zip download URL');
        }
        expect(bunWriteMock.mock.calls.map(([target]) => path.basename(String(target)))).toEqual([
            'cline-task-1.json',
            'cline-task-2.json',
        ]);
        expect((await stat(resolveDownloadPath(batch.downloadUrl))).isFile()).toBe(true);
        expect(new TextDecoder().decode(bunWriteMock.mock.calls[0]?.[1] as ArrayBuffer)).toBe(firstContent);
        expect(new TextDecoder().decode(bunWriteMock.mock.calls[1]?.[1] as ArrayBuffer)).toBe(secondContent);
    });
});
