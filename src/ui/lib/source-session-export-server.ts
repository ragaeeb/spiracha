import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ConversationRawDownload, ConversationSource } from '@spiracha/lib/conversation-data/types';
import { resolveUiRuntimeConfig } from '@spiracha/lib/runtime-config';
import type { ExportPlatform } from '@spiracha/lib/ui-export-archive';
import {
    buildBatchExportBaseName,
    buildConversationExportBaseName,
    buildExportArchiveBaseName,
    buildRawConversationExportFileName,
    getExportMimeType,
    getExportPlatformName,
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

type RawConversationExportEntry = {
    download: ConversationRawDownload;
    id: string;
};

type RawConversationExportOptions = {
    downloads: RawConversationExportEntry[];
    source: ConversationSource;
};

const rawConversationExportBaseName = (source: ConversationSource, id: string) =>
    buildRawConversationExportFileName(source, id).slice(0, -'.json'.length);

export const renderRawConversationDownloads = async ({ downloads, source }: RawConversationExportOptions) => {
    if (downloads.length === 0) {
        throw new Error('No raw conversations selected for export');
    }

    if (downloads.length === 1) {
        const entry = downloads[0]!;
        return {
            content: await entry.download.blob.text(),
            fileName: buildRawConversationExportFileName(source, entry.id),
            mimeType: entry.download.mimeType,
            mode: 'download' as const,
        };
    }

    const archiveBaseName = buildExportArchiveBaseName(
        getExportPlatformName(source),
        `raw-json-threads-${downloads.length}`,
    );
    const exportDir = await ensureUiExportDir();
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), `${archiveBaseName}-`));
    const zipPath = path.join(exportDir, `${archiveBaseName}-${randomUUID()}.zip`);
    const usedBaseNames = new Map<string, number>();

    try {
        for (const entry of downloads) {
            const fileBaseName = resolveUniqueExportFileBaseName(
                rawConversationExportBaseName(source, entry.id),
                usedBaseNames,
            );
            await Bun.write(path.join(workspaceDir, `${fileBaseName}.json`), await entry.download.blob.arrayBuffer());
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
