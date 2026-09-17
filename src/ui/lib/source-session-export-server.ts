import type { ConversationRawDownload, ConversationSource } from '@spiracha/lib/conversation-data/types';
import { EXPORT_ARCHIVE_MANIFEST_FILE, writeExportArchive } from '@spiracha/lib/export-archive';
import type { RawInlineDownload } from '@spiracha/lib/raw-export-contract';
import { resolveUiRuntimeConfig } from '@spiracha/lib/runtime-config';
import {
    buildBatchExportBaseName,
    buildConversationExportBaseName,
    buildRawConversationExportFileName,
    getExportMimeType,
    getExportPlatformName,
    resolveUniqueExportFileBaseName,
    resolveUniqueRawExportFileName,
    sanitizeExportFileName,
} from '@spiracha/lib/ui-export-archive';

type ExportFormat = 'md' | 'txt';

type RenderSourceSessionDownloadOptions = {
    content: string;
    cwd: string | null;
    fallbackBaseName: string;
    largeExportThresholdBytes?: number;
    outputFormat: ExportFormat;
    platform: string;
    sessionId: string;
    updatedAtMs: number | null;
    zipArchive: boolean;
    zipPassword?: string;
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
    platform: string;
    zipArchive: boolean;
    zipPassword?: string;
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
    largeExportThresholdBytes?: number;
    source: ConversationSource;
    zipPassword?: string;
};

const toDownloadUrl = async (
    archive: Awaited<ReturnType<typeof writeExportArchive>>,
): Promise<{ downloadUrl: string; fileName: string; mimeType: string; mode: 'download_url' }> => {
    if (!('downloadUrl' in archive)) {
        throw new Error('expected a zip download URL');
    }
    return {
        downloadUrl: archive.downloadUrl,
        fileName: archive.fileName,
        mimeType: archive.mimeType,
        mode: 'download_url',
    };
};

export const renderRawConversationDownloads = async ({
    downloads,
    largeExportThresholdBytes = resolveUiRuntimeConfig().largeExportThresholdBytes,
    source,
    zipPassword,
}: RawConversationExportOptions) => {
    if (downloads.length === 0) {
        throw new Error('No raw conversations selected for export');
    }

    if (
        downloads.length === 1 &&
        downloads[0]!.download.blob.size <= largeExportThresholdBytes &&
        (zipPassword === undefined || zipPassword === '')
    ) {
        const entry = downloads[0]!;
        return {
            contentBase64: Buffer.from(await entry.download.blob.arrayBuffer()).toString('base64'),
            fileName: buildRawConversationExportFileName(source, entry.id, entry.download.fileName),
            mimeType: entry.download.mimeType,
            mode: 'download_base64',
        } satisfies RawInlineDownload;
    }

    const usedBaseNames = new Map<string, number>([[EXPORT_ARCHIVE_MANIFEST_FILE.normalize('NFC').toLowerCase(), 1]]);
    const members = [];
    for (const entry of downloads) {
        const fileName = resolveUniqueRawExportFileName(
            buildRawConversationExportFileName(source, entry.id, entry.download.fileName),
            usedBaseNames,
        );
        members.push({
            bytes: new Uint8Array(await entry.download.blob.arrayBuffer()),
            relativePath: fileName,
            requestedId: entry.id,
        });
    }

    const isBatch = downloads.length > 1;
    return toDownloadUrl(
        await writeExportArchive({
            baseName: `raw-threads-${downloads.length}`,
            destination: { mode: 'download_url' },
            ...(isBatch
                ? {
                      manifest: {
                          entries: members.map((member) => ({
                              error: null,
                              memberNames: [member.relativePath],
                              omissionSummary: null,
                              requestedId: member.requestedId,
                              status: 'exported' as const,
                          })),
                          failedCount: 0,
                          failurePolicy: 'partial' as const,
                          kind: 'batch_original_raw',
                          missingCount: 0,
                          options: {},
                          requestedCount: members.length,
                          schemaVersion: 1,
                          source,
                          successCount: members.length,
                      },
                  }
                : {}),
            members: members.map(({ bytes, relativePath }) => ({ bytes, relativePath })),
            platform: getExportPlatformName(source),
            zipPassword,
        }),
    );
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
    zipPassword,
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
        (zipPassword !== undefined && zipPassword !== '') ||
        Buffer.byteLength(content) > (largeExportThresholdBytes ?? resolveUiRuntimeConfig().largeExportThresholdBytes);
    if (!shouldArchive) {
        return {
            content,
            fileName: `${safeBaseName}.${outputFormat}`,
            mimeType: getExportMimeType(outputFormat),
            mode: 'download' as const,
        };
    }

    return toDownloadUrl(
        await writeExportArchive({
            baseName: safeBaseName,
            destination: { mode: 'download_url' },
            members: [{ bytes: content, relativePath: `${safeBaseName}.${outputFormat}` }],
            platform,
            zipPassword,
        }),
    );
};

export const renderSourceSessionsDownload = async ({
    entries,
    fallbackBaseName,
    outputFormat,
    platform,
    zipArchive,
    zipPassword,
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
            zipPassword,
        });
    }

    const usedBaseNames = new Map<string, number>([[EXPORT_ARCHIVE_MANIFEST_FILE.normalize('NFC').toLowerCase(), 1]]);
    const members = entries.map((entry) => {
        const fileBaseName = resolveUniqueExportFileBaseName(
            toSafeSourceExportName(entry.fileBaseName, entry.fallbackBaseName),
            usedBaseNames,
        );
        return {
            bytes: entry.content,
            relativePath: `${fileBaseName}.${outputFormat}`,
            requestedId: entry.sessionId,
        };
    });

    return toDownloadUrl(
        await writeExportArchive({
            baseName: buildBatchExportBaseName(entries, fallbackBaseName),
            destination: { mode: 'download_url' },
            manifest: {
                entries: members.map((member) => ({
                    error: null,
                    memberNames: [member.relativePath],
                    omissionSummary: null,
                    requestedId: member.requestedId,
                    status: 'exported',
                })),
                failedCount: 0,
                failurePolicy: 'partial',
                kind: 'batch_normalized_export',
                missingCount: 0,
                options: { outputFormat },
                requestedCount: members.length,
                schemaVersion: 1,
                source: platform,
                successCount: members.length,
            },
            members: members.map(({ bytes, relativePath }) => ({ bytes, relativePath })),
            platform,
            zipPassword,
        }),
    );
};
