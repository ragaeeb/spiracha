import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveUiRuntimeConfig } from '@spiracha/lib/runtime-config';
import type { ExportPlatform } from '@spiracha/lib/ui-export-archive';
import {
    buildBatchExportBaseName,
    buildConversationExportBaseName,
    buildExportArchiveBaseName,
    getExportMimeType,
    resolveUniqueExportFileBaseName,
    sanitizeExportFileName,
} from '@spiracha/lib/ui-export-archive';
import { buildUiExportDownloadUrl, ensureUiExportDir } from '@spiracha/lib/ui-export-files';
import { zipExportDirectory } from '@spiracha/lib/ui-export-zip';

type ExportFormat = 'md' | 'txt';

type RenderSourceSessionDownloadOptions = {
    content: string;
    cwd: string | null;
    fallbackBaseName: string;
    largeExportThresholdBytes?: number;
    outputFormat: ExportFormat;
    platform: ExportPlatform;
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
    platform: ExportPlatform;
    zipArchive: boolean;
};

export const toSafeSourceExportName = (value: string, fallback: string) => {
    return sanitizeExportFileName(value) || fallback;
};

export const renderSourceSessionDownload = async ({
    content,
    cwd,
    fallbackBaseName,
    largeExportThresholdBytes,
    outputFormat,
    platform,
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
    const shouldArchive =
        zipArchive ||
        Buffer.byteLength(content) > (largeExportThresholdBytes ?? resolveUiRuntimeConfig().largeExportThresholdBytes);
    if (!shouldArchive) {
        return {
            content,
            fileName: `${safeBaseName}.${outputFormat}`,
            mimeType: getExportMimeType(outputFormat),
            mode: 'download' as const,
        };
    }

    const archiveBaseName = buildExportArchiveBaseName(platform, safeBaseName);
    const exportDir = await ensureUiExportDir();
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), `${archiveBaseName}-`));
    const zipPath = path.join(exportDir, `${archiveBaseName}-${randomUUID()}.zip`);

    try {
        await Bun.write(path.join(workspaceDir, `${safeBaseName}.${outputFormat}`), content);
        await zipExportDirectory(workspaceDir, zipPath);
    } finally {
        await rm(workspaceDir, { force: true, recursive: true });
    }

    return {
        downloadUrl: buildUiExportDownloadUrl(zipPath),
        fileName: `${archiveBaseName}.zip`,
        mimeType: 'application/zip',
        mode: 'download_url' as const,
    };
};

export const renderSourceSessionsDownload = async ({
    entries,
    fallbackBaseName,
    outputFormat,
    platform,
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
            platform,
            sessionId: entry.sessionId,
            updatedAtMs: entry.updatedAtMs,
            zipArchive,
        });
    }

    const safeBaseName = buildBatchExportBaseName(entries, fallbackBaseName);
    const archiveBaseName = buildExportArchiveBaseName(platform, safeBaseName);
    const exportDir = await ensureUiExportDir();
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), `${archiveBaseName}-`));
    const zipPath = path.join(exportDir, `${archiveBaseName}-${randomUUID()}.zip`);
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
        fileName: `${archiveBaseName}.zip`,
        mimeType: 'application/zip',
        mode: 'download_url' as const,
    };
};
