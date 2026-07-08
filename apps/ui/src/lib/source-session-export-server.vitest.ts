import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UI_EXPORT_DIR_ENV, UI_EXPORT_URL_PREFIX } from '@spiracha/lib/ui-export-files';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderSourceSessionsDownload } from './source-session-export-server';

vi.mock('@spiracha/lib/ui-export-archive', async () => {
    const actual = await vi.importActual<typeof import('@spiracha/lib/ui-export-archive')>(
        '@spiracha/lib/ui-export-archive',
    );
    const fs = await import('node:fs/promises');

    return {
        ...actual,
        zipExportDirectory: vi.fn(async (_sourceDirectory: string, zipPath: string) => {
            await fs.writeFile(zipPath, 'zip');
        }),
    };
});

let exportDir: string;
let previousExportDir: string | undefined;

beforeEach(async () => {
    previousExportDir = process.env[UI_EXPORT_DIR_ENV];
    exportDir = await mkdtemp(path.join(os.tmpdir(), 'spiracha-source-session-export-test-'));
    process.env[UI_EXPORT_DIR_ENV] = exportDir;
    vi.stubGlobal('Bun', {
        write: async (target: string, content: string) => {
            const fs = await import('node:fs/promises');
            await fs.writeFile(target, content);
        },
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
    it('should keep a single unzipped source session export inline', async () => {
        const result = await renderSourceSessionsDownload({
            entries: [
                {
                    content: '# Session',
                    fallbackBaseName: 'source-session',
                    fileBaseName: 'My session',
                },
            ],
            exportBaseName: 'source-sessions-1',
            fallbackBaseName: 'source-sessions',
            outputFormat: 'md',
            zipArchive: false,
        });

        expect(result).toEqual({
            content: '# Session',
            fileName: 'My session.md',
            mimeType: 'text/markdown; charset=utf-8',
            mode: 'download',
        });
    });

    it('should zip multiple source session exports', async () => {
        const result = await renderSourceSessionsDownload({
            entries: [
                {
                    content: '# First',
                    fallbackBaseName: 'source-session',
                    fileBaseName: 'Repeated title',
                },
                {
                    content: '# Second',
                    fallbackBaseName: 'source-session',
                    fileBaseName: 'Repeated title',
                },
            ],
            exportBaseName: 'source sessions',
            fallbackBaseName: 'source-sessions',
            outputFormat: 'md',
            zipArchive: false,
        });

        expect(result.mode).toBe('download_url');
        if (result.mode !== 'download_url') {
            throw new Error('expected a zip download URL');
        }
        expect(result.fileName).toBe('source sessions.zip');
        const metadata = await stat(resolveDownloadPath(result.downloadUrl));
        expect(metadata.isFile()).toBe(true);
    });
});
