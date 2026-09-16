import { cleanupConversationZipArtifacts, type ExportArchiveManifest, writeExportArchive } from './export-archive';
import {
    boundNormalizedExportBaseName,
    buildBatchExportBaseName,
    resolveUniqueExportFileBaseName,
} from './ui-export-archive';

type ConversationMarkdownZipEntry = {
    cwd: string | null;
    fallbackBaseName: string;
    markdown: string;
    requestedId?: string;
    title: string | null;
    updatedAtMs: number | null;
};

type ConversationMarkdownZipOptions = {
    entries: ConversationMarkdownZipEntry[];
    fallbackProjectName: string;
    failurePolicy?: ExportArchiveManifest['failurePolicy'];
    platform: string;
    signal?: AbortSignal;
    source?: string;
};

export type ConversationMarkdownZip = {
    blob: Blob;
    fileName: string;
    mimeType: 'application/zip';
};

export type { ConversationZipCleanupFailure } from './export-archive';
export { cleanupConversationZipArtifacts };

const toSafeFileBaseName = (value: string | null, fallback: string) => boundNormalizedExportBaseName(value, fallback);

/**
 * Names Markdown members, writes a generated batch manifest, and archives through
 * the shared orchestrator. Original source stores are not snapshotted atomically.
 */
export const createConversationMarkdownZip = async ({
    entries,
    fallbackProjectName,
    failurePolicy = 'atomic',
    platform,
    signal,
    source = platform,
}: ConversationMarkdownZipOptions): Promise<ConversationMarkdownZip> => {
    if (entries.length === 0) {
        throw new Error('No conversations selected for export');
    }

    const usedBaseNames = new Map<string, number>();
    const members = entries.map((entry) => {
        const fileBaseName = resolveUniqueExportFileBaseName(
            toSafeFileBaseName(entry.title, entry.fallbackBaseName),
            usedBaseNames,
        );
        return {
            bytes: entry.markdown,
            relativePath: `${fileBaseName}.md`,
            requestedId: entry.requestedId ?? entry.fallbackBaseName,
        };
    });
    const archive = await writeExportArchive({
        baseName: buildBatchExportBaseName(entries, fallbackProjectName),
        destination: { mode: 'blob' },
        manifest: {
            entries: members.map((member) => ({
                error: null,
                memberNames: [member.relativePath],
                omissionSummary: null,
                requestedId: member.requestedId,
                status: 'exported',
            })),
            failedCount: 0,
            failurePolicy,
            kind: 'batch_normalized_export',
            missingCount: 0,
            options: {},
            requestedCount: members.length,
            schemaVersion: 1,
            source,
            successCount: members.length,
        },
        members: members.map(({ bytes, relativePath }) => ({ bytes, relativePath })),
        platform,
        signal,
    });
    if ('downloadUrl' in archive) {
        throw new Error('Expected an in-memory conversation archive');
    }
    return archive;
};
