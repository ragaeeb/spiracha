import { randomUUID } from 'node:crypto';
import { lstat, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mapWithConcurrency } from './concurrency.ts';
import { assertPrivateRuntimeDirectorySafe, ensurePrivateRuntimeDirectory } from './private-runtime-directory.ts';
import { resolveUiRuntimeConfig } from './runtime-config.ts';

export const UI_EXPORT_DIR_ENV = 'SPIRACHA_UI_EXPORT_DIR';
export const UI_EXPORT_URL_PREFIX = '/__exports/';

const DEFAULT_UI_EXPORT_DIR = path.join(os.homedir(), '.cache', 'spiracha', 'ui-exports');
const MAX_EXPORT_FILE_NAME_BYTES = 200;

const FILE_MAINTENANCE_CONCURRENCY = 16;

// ponytail: process-global inflight map. Upgrade to a lockfile if multiple serve processes share one export dir.
const inflightExportBytes = new Map<string, number>();

export class ExportQuotaExceededError extends Error {
    constructor() {
        super('Export quota exceeded.');
        this.name = 'ExportQuotaExceededError';
    }
}

type UiExportFile = {
    filePath: string;
    mtimeMs: number;
    name: string;
    size: number;
};

const listUiExportFiles = async (exportDir: string): Promise<UiExportFile[]> => {
    const entries = await readdir(exportDir, { withFileTypes: true });
    return (
        await mapWithConcurrency(
            entries.filter((entry) => entry.isFile()),
            FILE_MAINTENANCE_CONCURRENCY,
            async (entry) => {
                const filePath = path.join(exportDir, entry.name);
                try {
                    const metadata = await lstat(filePath);
                    return metadata.isFile() && !metadata.isSymbolicLink()
                        ? { filePath, mtimeMs: metadata.mtimeMs, name: entry.name, size: metadata.size }
                        : null;
                } catch (error) {
                    if ((error as { code?: unknown }).code === 'ENOENT') {
                        return null;
                    }
                    throw error;
                }
            },
        )
    ).filter((file): file is UiExportFile => file !== null);
};

const inflightReservedBytes = () => [...inflightExportBytes.values()].reduce((total, size) => total + size, 0);

export const reserveExportBytes = async (
    bytes: number,
    options: { countRetained?: boolean; exportDir?: string } = {},
) => {
    const requested = Number.isFinite(bytes) ? Math.max(0, Math.ceil(bytes)) : 0;
    const countRetained = options.countRetained !== false;
    const exportDir = options.exportDir ?? (countRetained ? await ensureUiExportDir() : getUiExportDir());
    const retained = countRetained
        ? (await listUiExportFiles(exportDir)).reduce((total, file) => total + file.size, 0)
        : 0;
    if (retained + inflightReservedBytes() + requested > resolveUiRuntimeConfig().exportMaxBytes) {
        throw new ExportQuotaExceededError();
    }
    const id = randomUUID();
    inflightExportBytes.set(id, requested);
    return {
        id,
        release: () => {
            inflightExportBytes.delete(id);
        },
    };
};

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
    await ensurePrivateRuntimeDirectory(exportDir, 'export');
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

export const getUiExportContentType = (filePath: string) => {
    if (filePath.endsWith('.zip')) {
        return 'application/zip';
    }
    if (filePath.endsWith('.md')) {
        return 'text/markdown; charset=utf-8';
    }
    if (filePath.endsWith('.txt')) {
        return 'text/plain; charset=utf-8';
    }
    return 'application/octet-stream';
};

export const purgeStaleUiExportFile = async (filePath: string, cutoff: number) => {
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
        metadata = await lstat(filePath);
    } catch (error) {
        if ((error as { code?: unknown }).code === 'ENOENT') {
            return;
        }
        throw error;
    }
    if (metadata.isFile() && !metadata.isSymbolicLink() && metadata.mtimeMs < cutoff) {
        await rm(filePath, { force: true });
    }
};

export const purgeStaleUiExports = async (
    exportDir: string = getUiExportDir(),
    maxAgeMs: number = resolveUiRuntimeConfig().exportMaxAgeMs,
    maxBytes: number = resolveUiRuntimeConfig().exportMaxBytes,
) => {
    await assertPrivateRuntimeDirectorySafe(exportDir, 'export');
    const cutoff = Date.now() - maxAgeMs;
    const files = await listUiExportFiles(exportDir);
    const staleFiles = files.filter((file) => file.mtimeMs < cutoff);
    await mapWithConcurrency(staleFiles, FILE_MAINTENANCE_CONCURRENCY, (file) => rm(file.filePath, { force: true }));

    const retainedFiles = files.filter((file) => file.mtimeMs >= cutoff);
    let retainedBytes = retainedFiles.reduce((total, file) => total + file.size, 0);
    if (retainedBytes <= maxBytes) {
        return;
    }
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
        await assertPrivateRuntimeDirectorySafe(getUiExportDir(), 'export');
        const metadata = await lstat(filePath);
        return metadata.isFile() && !metadata.isSymbolicLink() ? filePath : null;
    } catch {
        return null;
    }
};
