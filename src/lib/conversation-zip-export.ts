import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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
    signal?: AbortSignal;
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
    const resolvedWorkspace = path.resolve(workspaceDir);
    const resolvedZip = path.resolve(zipPath);
    const zipInsideWorkspace = resolvedZip.startsWith(`${resolvedWorkspace}${path.sep}`);
    const jobs = zipInsideWorkspace
        ? [{ options: { force: true, recursive: true } as const, target: workspaceDir }]
        : [
              { options: { force: true, recursive: true } as const, target: workspaceDir },
              { options: { force: true } as const, target: zipPath },
          ];
    const results = await Promise.allSettled(jobs.map((job) => remove(job.target, job.options)));
    return results.flatMap((result, index) =>
        result.status === 'rejected'
            ? [
                  {
                      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
                      path: jobs[index]!.target,
                  },
              ]
            : [],
    );
};

const toSafeFileBaseName = (value: string | null, fallback: string) => {
    const sanitized = sanitizeExportFileName(value?.trim() || '') || sanitizeExportFileName(fallback) || 'conversation';
    return truncateUtf8(sanitized, EXPORT_BASE_NAME_BYTE_LIMIT) || 'conversation';
};

const throwIfAborted = (signal?: AbortSignal) => {
    if (!signal?.aborted) {
        return;
    }
    throw signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted.', 'AbortError');
};

/**
 * Materializes non-empty Markdown entries into temporary files and an archive, then
 * returns a fully loaded Blob before cleaning up both temporary artifacts. Filenames
 * are sanitized and collisions disambiguated; the original source stores are not
 * snapshotted atomically. Compression and final Blob loading consume memory.
 * Cleanup failures are reported by the cleanup helper without replacing the primary
 * result/error. This stable archive is not the UI's source-specific export manifest.
 */
export const createConversationMarkdownZip = async ({
    entries,
    fallbackProjectName,
    platform,
    signal,
}: ConversationMarkdownZipOptions): Promise<ConversationMarkdownZip> => {
    if (entries.length === 0) {
        throw new Error('No conversations selected for export');
    }
    throwIfAborted(signal);

    const safeBaseName = buildBatchExportBaseName(entries, fallbackProjectName);
    const archiveBaseName = buildExportArchiveBaseName(platform, safeBaseName);
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), `${archiveBaseName}-`));
    const entriesDir = path.join(workspaceDir, 'entries');
    const zipPath = path.join(workspaceDir, 'archive.zip');
    const usedBaseNames = new Map<string, number>();

    try {
        await mkdir(entriesDir, { mode: 0o700 });
        for (const entry of entries) {
            throwIfAborted(signal);
            const entryBaseName = toSafeFileBaseName(entry.title, entry.fallbackBaseName);
            const fileBaseNameForEntry = resolveUniqueExportFileBaseName(entryBaseName, usedBaseNames);
            await Bun.write(path.join(entriesDir, `${fileBaseNameForEntry}.md`), entry.markdown);
        }

        throwIfAborted(signal);
        await zipExportDirectory(entriesDir, zipPath);
        throwIfAborted(signal);
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
