import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderCodexThreadDownload, renderCodexThreadsDownload } from './codex-browser-export';
import { createCodexBrowserFixture, createCodexFixture } from './codex-test-helpers';
import { UI_EXPORT_DIR_ENV } from './ui-export-files';

const tempPaths: string[] = [];
const originalExportDir = process.env[UI_EXPORT_DIR_ENV];

afterEach(async () => {
    if (originalExportDir === undefined) {
        delete process.env[UI_EXPORT_DIR_ENV];
    } else {
        process.env[UI_EXPORT_DIR_ENV] = originalExportDir;
    }

    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

describe('renderCodexThreadDownload', () => {
    it('should render a thread export to downloadable markdown content', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-export-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexFixture(tempRoot);

        const download = await renderCodexThreadDownload({
            dbPath: fixture.dbPath,
            includeTools: true,
            optimized: false,
            outputFormat: 'md',
            threadId: fixture.threadId,
        });

        expect(download.fileName).toBe('summer-2026-04-23-1241-019da28f.md');
        expect(download.mimeType).toBe('text/markdown; charset=utf-8');
        expect(download.mode).toBe('download');
        if (download.mode !== 'download') {
            throw new Error('expected inline download mode');
        }
        expect(download.content).toContain('tokens_used: 42');
        expect(download.content).toContain('## GPT 5.4');
        expect(download.content).toContain('## Tool');
    });

    it('should apply project-root conversion and username redaction to exported content', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-export-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const download = await renderCodexThreadDownload({
            dbPath: fixture.dbPath,
            includeTools: true,
            optimized: false,
            outputFormat: 'md',
            pathDisplaySettings: {
                convertToProjectRoot: true,
                redactUsername: true,
            },
            threadId: fixture.threads[0]!.threadId,
        });

        expect(download.mode).toBe('download');
        if (download.mode !== 'download') {
            throw new Error('expected inline download mode');
        }
        expect(download.content).toContain('src/index.ts');
        expect(download.content).not.toContain('/Users/example/workspace/spiracha/src/index.ts');
        expect(download.content).toContain('~/workspace/other-project/docs/notes.md');
    });

    it('should zip oversized exports and return a downloadable url instead of inline transcript content', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-export-large-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const download = await renderCodexThreadDownload({
            dbPath: fixture.dbPath,
            includeTools: true,
            largeExportThresholdBytes: 1,
            optimized: false,
            outputFormat: 'md',
            publicExportDir: tempRoot,
            threadId: fixture.threads[0]!.threadId,
        });

        expect(download.mode).toBe('download_url');
        if (download.mode !== 'download_url') {
            throw new Error('expected zipped download url mode');
        }
        expect(download.downloadUrl.endsWith('.zip')).toBe(true);
        expect(download.fileName.endsWith('.zip')).toBe(true);
        expect(download.fileName.startsWith('spiracha-2026-05-17-1712-019e36d7')).toBe(true);
        expect(await Bun.file(path.join(tempRoot, path.basename(download.downloadUrl))).exists()).toBe(true);
    });

    it('should write oversized browser exports into the shared UI export directory when no override is provided', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-export-shared-dir-test-'));
        tempPaths.push(tempRoot);
        process.env[UI_EXPORT_DIR_ENV] = tempRoot;
        const fixture = await createCodexBrowserFixture(tempRoot);

        const download = await renderCodexThreadDownload({
            dbPath: fixture.dbPath,
            includeTools: true,
            largeExportThresholdBytes: 1,
            optimized: false,
            outputFormat: 'md',
            threadId: fixture.threads[0]!.threadId,
        });

        expect(download.mode).toBe('download_url');
        if (download.mode !== 'download_url') {
            throw new Error('expected zipped download url mode');
        }
        expect(await Bun.file(path.join(tempRoot, path.basename(download.downloadUrl))).exists()).toBe(true);
    });

    it('should bundle multiple thread exports into a single zip download', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-export-batch-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const download = await renderCodexThreadsDownload({
            dbPath: fixture.dbPath,
            includeTools: true,
            optimized: false,
            outputFormat: 'md',
            publicExportDir: tempRoot,
            threadIds: fixture.threads.slice(0, 2).map((thread) => thread.threadId),
        });

        expect(download.mode).toBe('download_url');
        if (download.mode !== 'download_url') {
            throw new Error('expected zipped batch download url mode');
        }
        expect(download.fileName.endsWith('.zip')).toBe(true);
        expect(download.fileName.includes('threads-2')).toBe(true);
        expect(await Bun.file(path.join(tempRoot, path.basename(download.downloadUrl))).exists()).toBe(true);
    });

    it('should return a unique zip url for repeated multi-thread exports of the same selection', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-export-batch-repeat-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const threadIds = fixture.threads.slice(0, 2).map((thread) => thread.threadId);

        const firstDownload = await renderCodexThreadsDownload({
            dbPath: fixture.dbPath,
            includeTools: true,
            optimized: false,
            outputFormat: 'md',
            publicExportDir: tempRoot,
            threadIds,
        });
        const secondDownload = await renderCodexThreadsDownload({
            dbPath: fixture.dbPath,
            includeTools: true,
            optimized: false,
            outputFormat: 'md',
            publicExportDir: tempRoot,
            threadIds,
        });

        expect(firstDownload.mode).toBe('download_url');
        expect(secondDownload.mode).toBe('download_url');
        if (firstDownload.mode !== 'download_url' || secondDownload.mode !== 'download_url') {
            throw new Error('expected zipped batch download url mode');
        }
        expect(firstDownload.fileName).toBe(secondDownload.fileName);
        expect(firstDownload.downloadUrl).not.toBe(secondDownload.downloadUrl);
        expect(await Bun.file(path.join(tempRoot, path.basename(firstDownload.downloadUrl))).exists()).toBe(true);
        expect(await Bun.file(path.join(tempRoot, path.basename(secondDownload.downloadUrl))).exists()).toBe(true);
    });
});
