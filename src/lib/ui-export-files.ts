import { chmod, mkdir, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const UI_EXPORT_DIR_ENV = 'SPIRACHA_UI_EXPORT_DIR';
export const UI_EXPORT_URL_PREFIX = '/__exports/';

const DEFAULT_UI_EXPORT_DIR = path.join(os.tmpdir(), 'spiracha-ui-exports');
const DEFAULT_EXPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EXPORT_MAX_BYTES = 1024 * 1024 * 1024;
const MAX_EXPORT_FILE_NAME_BYTES = 200;

const decodeExportFileName = (value: string) => {
    try {
        return decodeURIComponent(value);
    } catch {
        return null;
    }
};

const isSafeExportFileName = (value: string) => {
    return (
        value.length > 0 &&
        Buffer.byteLength(value) <= MAX_EXPORT_FILE_NAME_BYTES &&
        value !== '.' &&
        value !== '..' &&
        value === path.basename(value) &&
        !/[\\/]/u.test(value) &&
        !value.includes('\0')
    );
};

export const getUiExportDir = () => {
    return process.env[UI_EXPORT_DIR_ENV]?.trim() || DEFAULT_UI_EXPORT_DIR;
};

export const ensureUiExportDir = async () => {
    const exportDir = getUiExportDir();
    await mkdir(exportDir, { mode: 0o700, recursive: true });
    await chmod(exportDir, 0o700);
    await purgeStaleUiExports(exportDir);
    return exportDir;
};

export const buildUiExportDownloadUrl = (filePath: string) => {
    return `${UI_EXPORT_URL_PREFIX}${encodeURIComponent(path.basename(filePath))}`;
};

export const buildUiExportContentDisposition = (filePath: string) => {
    const fileName = path.basename(filePath);
    return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};

export const purgeStaleUiExportFile = async (filePath: string, cutoff: number) => {
    let metadata: Awaited<ReturnType<typeof stat>>;
    try {
        metadata = await stat(filePath);
    } catch (error) {
        if ((error as { code?: unknown }).code === 'ENOENT') {
            return;
        }
        throw error;
    }
    if (metadata.mtimeMs < cutoff) {
        await rm(filePath, { force: true });
    }
};

export const purgeStaleUiExports = async (
    exportDir: string = getUiExportDir(),
    maxAgeMs: number = DEFAULT_EXPORT_MAX_AGE_MS,
    maxBytes: number = DEFAULT_EXPORT_MAX_BYTES,
) => {
    const entries = await readdir(exportDir, { withFileTypes: true });
    const cutoff = Date.now() - maxAgeMs;
    const files = (
        await Promise.all(
            entries
                .filter((entry) => entry.isFile())
                .map(async (entry) => {
                    const filePath = path.join(exportDir, entry.name);
                    try {
                        const metadata = await stat(filePath);
                        return { filePath, mtimeMs: metadata.mtimeMs, name: entry.name, size: metadata.size };
                    } catch (error) {
                        if ((error as { code?: unknown }).code === 'ENOENT') {
                            return null;
                        }
                        throw error;
                    }
                }),
        )
    ).filter((file): file is NonNullable<typeof file> => file !== null);
    const staleFiles = files.filter((file) => file.mtimeMs < cutoff);
    await Promise.all(staleFiles.map((file) => rm(file.filePath, { force: true })));

    const retainedFiles = files.filter((file) => file.mtimeMs >= cutoff);
    let retainedBytes = retainedFiles.reduce((total, file) => total + file.size, 0);
    const oldestFirst = retainedFiles.sort(
        (left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name),
    );
    for (const file of oldestFirst) {
        if (retainedBytes <= maxBytes) {
            break;
        }
        await rm(file.filePath, { force: true });
        retainedBytes -= file.size;
    }
};

export const resolveUiExportFilePathFromRequestPath = (pathname: string) => {
    if (!pathname.startsWith(UI_EXPORT_URL_PREFIX)) {
        return null;
    }

    const rawFileName = pathname.slice(UI_EXPORT_URL_PREFIX.length);
    const fileName = decodeExportFileName(rawFileName);
    if (!fileName || !isSafeExportFileName(fileName)) {
        return null;
    }

    return path.join(getUiExportDir(), fileName);
};

export const resolveReadableUiExportFileFromRequestPath = async (pathname: string) => {
    const filePath = resolveUiExportFilePathFromRequestPath(pathname);
    if (!filePath) {
        return null;
    }

    try {
        const metadata = await stat(filePath);
        return metadata.isFile() ? filePath : null;
    } catch {
        return null;
    }
};
