import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    buildUiExportContentDisposition,
    buildUiExportDownloadUrl,
    ensureUiExportDir,
    getUiExportDir,
    purgeStaleUiExportFile,
    purgeStaleUiExports,
    resolveReadableUiExportFileFromRequestPath,
    resolveUiExportFilePathFromRequestPath,
    UI_EXPORT_DIR_ENV,
    UI_EXPORT_URL_PREFIX,
} from './ui-export-files';

const originalExportDir = process.env[UI_EXPORT_DIR_ENV];
const tempPaths: string[] = [];

afterEach(async () => {
    if (originalExportDir === undefined) {
        delete process.env[UI_EXPORT_DIR_ENV];
    } else {
        process.env[UI_EXPORT_DIR_ENV] = originalExportDir;
    }

    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

describe('ui export file helpers', () => {
    it('should create the export directory with owner-only permissions', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spiracha-ui-export-mode-test-'));
        tempPaths.push(tempRoot);
        const exportDir = path.join(tempRoot, 'exports');
        process.env[UI_EXPORT_DIR_ENV] = exportDir;

        await ensureUiExportDir();

        expect((await stat(exportDir)).mode & 0o777).toBe(0o700);
    });

    it('should tolerate an export disappearing during stale-file purging', async () => {
        const missingPath = path.join(os.tmpdir(), 'spiracha-already-purged-export.zip');
        await rm(missingPath, { force: true });

        await expect(purgeStaleUiExportFile(missingPath, Date.now())).resolves.toBeUndefined();
    });

    it('should resolve request paths inside the configured export directory and reject traversal', async () => {
        const exportDir = await mkdtemp(path.join(os.tmpdir(), 'spiracha-ui-export-files-test-'));
        tempPaths.push(exportDir);
        process.env[UI_EXPORT_DIR_ENV] = exportDir;

        expect(getUiExportDir()).toBe(exportDir);
        expect(await ensureUiExportDir()).toBe(exportDir);
        expect(resolveUiExportFilePathFromRequestPath('/not-exports/file.zip')).toBeNull();
        expect(resolveUiExportFilePathFromRequestPath(`${UI_EXPORT_URL_PREFIX}nested/file.zip`)).toBeNull();
        expect(resolveUiExportFilePathFromRequestPath(`${UI_EXPORT_URL_PREFIX}..%2Fescape.zip`)).toBeNull();
        expect(resolveUiExportFilePathFromRequestPath(`${UI_EXPORT_URL_PREFIX}..%5Cescape.zip`)).toBeNull();
        expect(resolveUiExportFilePathFromRequestPath(`${UI_EXPORT_URL_PREFIX}.`)).toBeNull();
        expect(resolveUiExportFilePathFromRequestPath(`${UI_EXPORT_URL_PREFIX}..`)).toBeNull();
        expect(resolveUiExportFilePathFromRequestPath(`${UI_EXPORT_URL_PREFIX}report%20bundle.zip`)).toBe(
            path.join(exportDir, 'report bundle.zip'),
        );
    });

    it('should resolve only readable regular export files', async () => {
        const exportDir = await mkdtemp(path.join(os.tmpdir(), 'spiracha-ui-export-readable-test-'));
        tempPaths.push(exportDir);
        process.env[UI_EXPORT_DIR_ENV] = exportDir;
        const filePath = path.join(exportDir, 'report.zip');
        await Bun.write(filePath, 'export');
        await mkdir(path.join(exportDir, 'directory.zip'));

        expect(await resolveReadableUiExportFileFromRequestPath(`${UI_EXPORT_URL_PREFIX}report.zip`)).toBe(filePath);
        expect(await resolveReadableUiExportFileFromRequestPath(`${UI_EXPORT_URL_PREFIX}directory.zip`)).toBeNull();
        expect(await resolveReadableUiExportFileFromRequestPath(`${UI_EXPORT_URL_PREFIX}missing.zip`)).toBeNull();
    });

    it('should build download urls from exported file paths', () => {
        expect(buildUiExportDownloadUrl('/tmp/report bundle.zip')).toBe(`${UI_EXPORT_URL_PREFIX}report%20bundle.zip`);
        expect(buildUiExportContentDisposition('/tmp/report bundle.zip')).toBe(
            "attachment; filename*=UTF-8''report%20bundle.zip",
        );
    });

    it('should purge stale export files while keeping recent ones', async () => {
        const exportDir = await mkdtemp(path.join(os.tmpdir(), 'spiracha-ui-export-files-test-'));
        tempPaths.push(exportDir);
        const stalePath = path.join(exportDir, 'stale.zip');
        const freshPath = path.join(exportDir, 'fresh.zip');
        await Bun.write(stalePath, 'stale');
        await Bun.write(freshPath, 'fresh');
        const staleTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
        await utimes(stalePath, staleTime, staleTime);

        await purgeStaleUiExports(exportDir, 24 * 60 * 60 * 1000);

        expect(await Bun.file(stalePath).exists()).toBe(false);
        expect(await Bun.file(freshPath).exists()).toBe(true);
    });
});
