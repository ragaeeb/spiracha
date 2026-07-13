import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    buildBatchExportBaseName,
    buildConversationExportBaseName,
    getExportMimeType,
    resolveUniqueExportFileBaseName,
    sanitizeExportFileName,
    zipExportDirectory,
} from '@spiracha/lib/ui-export-archive';
import { buildUiExportDownloadUrl, ensureUiExportDir } from '@spiracha/lib/ui-export-files';

type ExportFormat = 'md' | 'txt';

type RenderSourceSessionDownloadOptions = {
    content: string;
    cwd: string | null;
    fallbackBaseName: string;
    outputFormat: ExportFormat;
    sessionId: string;
    updatedAtMs: number | null;
    zipArchive: boolean;
};

type RenderedSourceSession = {
    content: string;
    cwd: string | null;
    fallbackBaseName: string;
    fileBaseName: string;
    sessionId: string;
    updatedAtMs: number | null;
};

type RenderSourceSessionsDownloadOptions = {
    entries: RenderedSourceSession[];
    fallbackBaseName: string;
    outputFormat: ExportFormat;
    zipArchive: boolean;
};

export const toSafeSourceExportName = (value: string, fallback: string) => {
    return sanitizeExportFileName(value) || fallback;
};

export const renderSourceSessionDownload = async ({
    content,
    cwd,
    fallbackBaseName,
    outputFormat,
    sessionId,
    updatedAtMs,
    zipArchive,
}: RenderSourceSessionDownloadOptions) => {
    const safeBaseName = buildConversationExportBaseName(
        {
            cwd,
            id: sessionId,
            updatedAtMs,
        },
        fallbackBaseName,
    );
    if (!zipArchive) {
        return {
            content,
            fileName: `${safeBaseName}.${outputFormat}`,
            mimeType: getExportMimeType(outputFormat),
            mode: 'download' as const,
        };
    }

    const exportDir = await ensureUiExportDir();
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), `${safeBaseName}-`));
    const zipPath = path.join(exportDir, `${safeBaseName}-${randomUUID()}.zip`);

    try {
        await Bun.write(path.join(workspaceDir, `${safeBaseName}.${outputFormat}`), content);
        await zipExportDirectory(workspaceDir, zipPath);
    } finally {
        await rm(workspaceDir, { force: true, recursive: true });
    }

    return {
        downloadUrl: buildUiExportDownloadUrl(zipPath),
        fileName: `${safeBaseName}.zip`,
        mimeType: 'application/zip',
        mode: 'download_url' as const,
    };
};

export const renderSourceSessionsDownload = async ({
    entries,
    fallbackBaseName,
    outputFormat,
    zipArchive,
}: RenderSourceSessionsDownloadOptions) => {
    if (entries.length === 0) {
        throw new Error('No transcripts selected for export');
    }

    if (entries.length === 1) {
        const entry = entries[0]!;
        return renderSourceSessionDownload({
            content: entry.content,
            cwd: entry.cwd,
            fallbackBaseName: entry.fallbackBaseName,
            outputFormat,
            sessionId: entry.sessionId,
            updatedAtMs: entry.updatedAtMs,
            zipArchive,
        });
    }

    const safeBaseName = buildBatchExportBaseName(entries, fallbackBaseName);
    const exportDir = await ensureUiExportDir();
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), `${safeBaseName}-`));
    const zipPath = path.join(exportDir, `${safeBaseName}-${randomUUID()}.zip`);
    const usedBaseNames = new Map<string, number>();

    try {
        for (const entry of entries) {
            const baseName = toSafeSourceExportName(entry.fileBaseName, entry.fallbackBaseName);
            const fileBaseName = resolveUniqueExportFileBaseName(baseName, usedBaseNames);
            await Bun.write(path.join(workspaceDir, `${fileBaseName}.${outputFormat}`), entry.content);
        }

        await zipExportDirectory(workspaceDir, zipPath);
    } finally {
        await rm(workspaceDir, { force: true, recursive: true });
    }

    return {
        downloadUrl: buildUiExportDownloadUrl(zipPath),
        fileName: `${safeBaseName}.zip`,
        mimeType: 'application/zip',
        mode: 'download_url' as const,
    };
};
