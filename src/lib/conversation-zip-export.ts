import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    buildBatchExportBaseName,
    buildExportArchiveBaseName,
    resolveUniqueExportFileBaseName,
    sanitizeExportFileName,
} from './ui-export-archive';
import { zipExportDirectory } from './ui-export-zip';

type ConversationMarkdownZipEntry = {
    cwd: string | null;
    fallbackBaseName: string;
    markdown: string;
    title: string | null;
    updatedAtMs: number | null;
};

type ConversationMarkdownZipOptions = {
    entries: ConversationMarkdownZipEntry[];
    fallbackProjectName: string;
    platform: Parameters<typeof buildExportArchiveBaseName>[0];
};

const EXPORT_BASE_NAME_BYTE_LIMIT = 120;

const truncateUtf8 = (value: string, maxBytes: number) => {
    let bytes = 0;
    let result = '';
    for (const character of value) {
        const characterBytes = Buffer.byteLength(character);
        if (bytes + characterBytes > maxBytes) {
            break;
        }
        bytes += characterBytes;
        result += character;
    }
    return result;
};

export type ConversationMarkdownZip = {
    blob: Blob;
    fileName: string;
    mimeType: 'application/zip';
};

export type ConversationZipCleanupFailure = {
    error: string;
    path: string;
};

export const cleanupConversationZipArtifacts = async (
    workspaceDir: string,
    zipPath: string,
    remove: typeof rm = rm,
): Promise<ConversationZipCleanupFailure[]> => {
    const results = await Promise.allSettled([
        remove(workspaceDir, { force: true, recursive: true }),
        remove(zipPath, { force: true }),
    ]);
    const paths = [workspaceDir, zipPath];
    return results.flatMap((result, index) =>
        result.status === 'rejected'
            ? [
                  {
                      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
                      path: paths[index]!,
                  },
              ]
            : [],
    );
};

const toSafeFileBaseName = (value: string | null, fallback: string) => {
    const sanitized = sanitizeExportFileName(value?.trim() || '') || sanitizeExportFileName(fallback) || 'conversation';
    return truncateUtf8(sanitized, EXPORT_BASE_NAME_BYTE_LIMIT) || 'conversation';
};

export const createConversationMarkdownZip = async ({
    entries,
    fallbackProjectName,
    platform,
}: ConversationMarkdownZipOptions): Promise<ConversationMarkdownZip> => {
    if (entries.length === 0) {
        throw new Error('No conversations selected for export');
    }

    const safeBaseName = buildBatchExportBaseName(entries, fallbackProjectName);
    const archiveBaseName = buildExportArchiveBaseName(platform, safeBaseName);
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), `${archiveBaseName}-`));
    const zipPath = path.join(os.tmpdir(), `${archiveBaseName}-${randomUUID()}.zip`);
    const usedBaseNames = new Map<string, number>();

    try {
        for (const entry of entries) {
            const entryBaseName = toSafeFileBaseName(entry.title, entry.fallbackBaseName);
            const fileBaseNameForEntry = resolveUniqueExportFileBaseName(entryBaseName, usedBaseNames);
            await Bun.write(path.join(workspaceDir, `${fileBaseNameForEntry}.md`), entry.markdown);
        }

        await zipExportDirectory(workspaceDir, zipPath);
        return {
            blob: new Blob([await Bun.file(zipPath).arrayBuffer()], { type: 'application/zip' }),
            fileName: `${archiveBaseName}.zip`,
            mimeType: 'application/zip',
        };
    } finally {
        const cleanupFailures = await cleanupConversationZipArtifacts(workspaceDir, zipPath);
        for (const failure of cleanupFailures) {
            console.warn('[spiracha:export] temporary cleanup failed', failure);
        }
    }
};
