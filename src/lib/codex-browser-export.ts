import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getThreadBrowseData, getThreadBrowseDataBatch } from './codex-browser-queries';
import type { CodexThreadBrowseBatchResult, ThreadBrowseData } from './codex-browser-types';
import { CodexDbCompatibilityError, CodexThreadNotFoundError } from './codex-database';
import {
    CodexRolloutContentError,
    CodexRolloutMutationError,
    type CodexRolloutSnapshot,
    CodexRolloutSourceError,
    copyStableCodexRollout,
} from './codex-rollout-snapshot';
import type { CodexTranscriptRenderOptions } from './codex-thread-types';
import { renderCodexSessionFile } from './codex-transcript-renderer';
import { type ExportArchiveMember, type ExportArchiveOutcome, writeExportArchive } from './export-archive';
import { applyPathTransforms, type PathDisplaySettings } from './path-transforms';
import { resolveUiRuntimeConfig } from './runtime-config';
import type { ExportFormat } from './shared-text';
import {
    buildBatchExportBaseName,
    buildConversationExportBaseName,
    buildExportArchiveBaseName,
    getExportMimeType,
    sanitizeExportFileName,
} from './ui-export-archive';
import { ensureUiExportDir } from './ui-export-files';

type RenderCodexThreadDownloadInput = {
    dbPath: string;
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    largeExportThresholdBytes?: number;
    outputFormat: ExportFormat | 'json';
    pathDisplaySettings?: Pick<PathDisplaySettings, 'convertToProjectRoot' | 'redactUsername'>;
    publicExportDir?: string;
    threadId: string;
    zipArchive?: boolean;
};

type RenderCodexThreadsDownloadInput = Omit<RenderCodexThreadDownloadInput, 'threadId'> & {
    threadIds: string[];
};

type CodexExportSettings = Pick<
    RenderCodexThreadDownloadInput,
    'includeCommentary' | 'includeMetadata' | 'includeTools' | 'outputFormat'
>;

export type CodexThreadDownload =
    | {
          content: string;
          fileName: string;
          mimeType: string;
          mode: 'download';
      }
    | {
          downloadUrl: string;
          fileName: string;
          mimeType: string;
          mode: 'download_url';
          skippedThreadCount?: number;
      };

const MAX_ROLLOUT_EXPORT_ATTEMPTS = 2;
const ROLLOUT_RETRY_BACKOFF_MS = 40;
const ARCHIVE_WIDE_FILE_ERROR_CODES = new Set(['EACCES', 'EIO', 'ENOSPC', 'ENOTDIR', 'EPERM', 'EROFS']);

const buildExportBaseName = (thread: ThreadBrowseData['thread']) => {
    return buildConversationExportBaseName(
        {
            cwd: thread.cwd,
            id: thread.id,
            updatedAtMs: thread.updated_at_ms ?? thread.updated_at * 1000,
        },
        'thread',
    );
};

const buildArchiveBaseName = (baseName: string) => buildExportArchiveBaseName('codex', baseName);

const buildRawExportBaseName = (threadId: string) => `codex-${sanitizeExportFileName(threadId) || 'thread'}`;

const buildCodexExportFileBaseName = (
    outputFormat: RenderCodexThreadDownloadInput['outputFormat'],
    thread: ThreadBrowseData['thread'],
) => (outputFormat === 'json' ? buildRawExportBaseName(thread.id) : buildExportBaseName(thread));

const getCodexExportFileExtension = (outputFormat: RenderCodexThreadDownloadInput['outputFormat']) =>
    outputFormat === 'json' ? 'json' : outputFormat === 'md' ? 'md' : 'txt';

const getCodexExportMimeType = (outputFormat: RenderCodexThreadDownloadInput['outputFormat']) =>
    outputFormat === 'json' ? 'application/json' : getExportMimeType(outputFormat);

const buildUniqueBatchEntryBaseName = (baseName: string, threadId: string, usedBaseNames: Set<string>): string => {
    if (!usedBaseNames.has(baseName)) {
        usedBaseNames.add(baseName);
        return baseName;
    }

    const collisionSafeBaseName = `${baseName}-${sanitizeExportFileName(threadId) || 'thread'}`;
    let uniqueBaseName = collisionSafeBaseName;
    let suffix = 2;
    while (usedBaseNames.has(uniqueBaseName)) {
        uniqueBaseName = `${collisionSafeBaseName}-${suffix++}`;
    }
    usedBaseNames.add(uniqueBaseName);
    return uniqueBaseName;
};

const toDownloadOptions = (input: CodexExportSettings): CodexTranscriptRenderOptions => {
    return {
        includeCommentary: input.includeCommentary,
        includeMetadata: input.includeMetadata,
        includeTools: input.includeTools,
        outputFormat: input.outputFormat === 'json' ? 'md' : input.outputFormat,
    };
};

type CodexExportFileInput = {
    input: CodexExportSettings;
    outputRelativePath: string;
    relations: ThreadBrowseData['relations'];
    sessionFile: string;
    thread: ThreadBrowseData['thread'];
    transform: (text: string) => string;
};

const renderCodexExportContent = async ({
    input,
    outputRelativePath,
    relations,
    sessionFile,
    thread,
    transform,
}: CodexExportFileInput) => {
    if (input.outputFormat === 'json') {
        return Bun.file(sessionFile).text();
    }

    const content = await renderCodexSessionFile(
        {
            fallbackReason: null,
            outputRelativePath,
            relations,
            sessionFile,
            thread,
        },
        toDownloadOptions(input),
    );

    if (!content) {
        throw new Error(`Thread ${thread.id} produced no exportable content`);
    }

    return transform(content);
};

const resolvePublicExportDir = async (publicExportDir?: string) => {
    if (publicExportDir) {
        await ensureDirectory(publicExportDir);
        return publicExportDir;
    }

    return ensureUiExportDir();
};

const ensureDirectory = async (directoryPath: string) => {
    await mkdir(directoryPath, { recursive: true });
};

const logExportEvent = (level: 'error' | 'info' | 'warn', event: string, details: Record<string, unknown>) => {
    console[level](`[spiracha:export] ${event}`, details);
};

const cleanupExportWorkspace = async (workspacePath: string) => {
    try {
        await rm(workspacePath, { force: true, recursive: true });
    } catch (error) {
        logExportEvent('warn', 'workspace_cleanup_failed', {
            error: error instanceof Error ? error.message : String(error),
            workspacePath,
        });
    }
};

type StableRolloutContext = {
    browseData: ThreadBrowseData;
    rollout: CodexRolloutSnapshot;
    snapshotPath: string;
};

const withStableRolloutSnapshot = async <T>({
    dbPath,
    initialBrowseData,
    render,
    threadId,
}: {
    dbPath: string;
    initialBrowseData?: ThreadBrowseData;
    render: (context: StableRolloutContext) => Promise<T>;
    threadId: string;
}): Promise<T> => {
    for (let attempt = 1; attempt <= MAX_ROLLOUT_EXPORT_ATTEMPTS; attempt += 1) {
        const browseData =
            attempt === 1 && initialBrowseData ? initialBrowseData : await getThreadBrowseData(dbPath, threadId);
        const attemptWorkspace = await mkdtemp(path.join(os.tmpdir(), 'spiracha-codex-rollout-attempt-'));
        const snapshotPath = path.join(attemptWorkspace, 'rollout.jsonl');

        try {
            const rollout = await copyStableCodexRollout({
                attempt,
                snapshotPath,
                sourcePath: browseData.thread.rollout_path,
                threadId,
            });

            return await render({ browseData, rollout, snapshotPath });
        } catch (error) {
            if (
                (error instanceof CodexRolloutContentError || error instanceof CodexRolloutMutationError) &&
                attempt < MAX_ROLLOUT_EXPORT_ATTEMPTS
            ) {
                const delayMs = ROLLOUT_RETRY_BACKOFF_MS * 2 ** (attempt - 1);
                logExportEvent('warn', 'rollout_retry', {
                    attempt,
                    delayMs,
                    errorCode: error.code,
                    nextAttempt: attempt + 1,
                    threadId,
                });
                await Bun.sleep(delayMs);
                continue;
            }

            throw error;
        } finally {
            await cleanupExportWorkspace(attemptWorkspace);
        }
    }

    throw new Error(`Unable to create a stable rollout snapshot for thread ${threadId}`);
};

const getBatchFailure = (threadId: string, error: unknown): ExportArchiveOutcome => {
    if (error instanceof CodexThreadNotFoundError || error instanceof CodexRolloutSourceError) {
        const code = error instanceof CodexRolloutSourceError ? error.code : 'CODEX_THREAD_NOT_FOUND';
        return {
            error: { code, message: error.message },
            memberNames: [],
            omissionSummary: null,
            requestedId: threadId,
            status:
                error instanceof CodexRolloutSourceError && error.code === 'CODEX_ROLLOUT_UNREADABLE'
                    ? 'failed'
                    : 'missing',
        };
    }

    if (error instanceof CodexRolloutMutationError) {
        return {
            error: { code: error.code, message: error.message },
            memberNames: [],
            omissionSummary: null,
            requestedId: threadId,
            status: 'failed',
        };
    }

    return {
        error: {
            code: 'CODEX_EXPORT_UNREADABLE',
            message: error instanceof Error ? error.message : String(error),
        },
        memberNames: [],
        omissionSummary: null,
        requestedId: threadId,
        status: 'failed',
    };
};

export const isArchiveWideFailure = (error: unknown) => {
    if (error instanceof CodexDbCompatibilityError) {
        return true;
    }

    if (typeof error !== 'object' || error === null || (!('code' in error) && !('cause' in error))) {
        return false;
    }

    const candidate = error as { cause?: unknown; code?: unknown };
    const codes = [candidate.code, (candidate.cause as { code?: unknown } | undefined)?.code];
    return codes.some((code): code is string => typeof code === 'string' && ARCHIVE_WIDE_FILE_ERROR_CODES.has(code));
};

export const isPerEntryExportFailure = (error: unknown) => {
    return (
        error instanceof CodexThreadNotFoundError ||
        error instanceof CodexRolloutContentError ||
        error instanceof CodexRolloutMutationError ||
        error instanceof CodexRolloutSourceError
    );
};

const toCodexDownloadUrl = (
    archive: Awaited<ReturnType<typeof writeExportArchive>>,
): Extract<CodexThreadDownload, { mode: 'download_url' }> => {
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

export const renderCodexThreadDownload = async (
    input: RenderCodexThreadDownloadInput,
): Promise<CodexThreadDownload> => {
    const startedAt = Date.now();
    let fileName = input.threadId;
    try {
        return await withStableRolloutSnapshot({
            dbPath: input.dbPath,
            render: async ({ browseData, rollout, snapshotPath }) => {
                const fileBaseName = buildCodexExportFileBaseName(input.outputFormat, browseData.thread);
                const extension = getCodexExportFileExtension(input.outputFormat);
                fileName = `${fileBaseName}.${extension}`;
                const mimeType = getCodexExportMimeType(input.outputFormat);
                const transform = (text: string) =>
                    input.pathDisplaySettings
                        ? applyPathTransforms(text, {
                              ...input.pathDisplaySettings,
                              projectPath: browseData.thread.cwd,
                          })
                        : text;

                logExportEvent('info', 'single_start', {
                    fileName,
                    sizeBytes: rollout.before.sizeBytes,
                    threadId: input.threadId,
                });

                const content = await renderCodexExportContent({
                    input,
                    outputRelativePath: fileName,
                    relations: browseData.relations,
                    sessionFile: snapshotPath,
                    thread: browseData.thread,
                    transform,
                });

                if (
                    input.zipArchive ||
                    rollout.before.sizeBytes >
                        (input.largeExportThresholdBytes ?? resolveUiRuntimeConfig().largeExportThresholdBytes)
                ) {
                    const exportDir = await resolvePublicExportDir(input.publicExportDir);
                    const archive = await writeExportArchive({
                        baseName: fileBaseName,
                        destination: { exportDir, mode: 'download_url' },
                        members: [{ bytes: content, relativePath: fileName }],
                        platform: 'codex',
                    });
                    const download = toCodexDownloadUrl(archive);
                    logExportEvent('info', 'single_zip_ready', {
                        downloadUrl: download.downloadUrl,
                        durationMs: Date.now() - startedAt,
                        fileName: download.fileName,
                        sizeBytes: Buffer.byteLength(content),
                        threadId: input.threadId,
                    });
                    return download;
                }

                logExportEvent('info', 'single_inline_ready', {
                    durationMs: Date.now() - startedAt,
                    fileName,
                    sizeBytes: content.length,
                    threadId: input.threadId,
                });

                return {
                    content,
                    fileName,
                    mimeType,
                    mode: 'download' as const,
                };
            },
            threadId: input.threadId,
        });
    } catch (error) {
        logExportEvent('error', 'single_error', {
            error: error instanceof Error ? error.message : String(error),
            fileName,
            threadId: input.threadId,
        });
        throw error;
    }
};

const renderCodexBatchEntry = async (
    input: RenderCodexThreadsDownloadInput,
    result: CodexThreadBrowseBatchResult,
    usedBatchEntryBaseNames: Set<string>,
): Promise<{ members: ExportArchiveMember[]; outcome: ExportArchiveOutcome }> => {
    if (result.status !== 'found' || !result.data) {
        return {
            members: [],
            outcome: {
                error: {
                    code: 'CODEX_THREAD_NOT_FOUND',
                    message: `Thread ${result.threadId} was not found.`,
                },
                memberNames: [],
                omissionSummary: null,
                requestedId: result.threadId,
                status: 'missing',
            },
        };
    }

    try {
        const rendered = await withStableRolloutSnapshot({
            dbPath: input.dbPath,
            initialBrowseData: result.data,
            render: async ({ browseData, snapshotPath }) => {
                const singleBaseName = buildCodexExportFileBaseName(input.outputFormat, browseData.thread);
                const uniqueBaseName = buildUniqueBatchEntryBaseName(
                    singleBaseName,
                    browseData.thread.id,
                    usedBatchEntryBaseNames,
                );
                const extension = getCodexExportFileExtension(input.outputFormat);
                const resolvedFileName = `${uniqueBaseName}.${extension}`;
                const transform = (text: string) =>
                    input.pathDisplaySettings
                        ? applyPathTransforms(text, {
                              ...input.pathDisplaySettings,
                              projectPath: browseData.thread.cwd,
                          })
                        : text;

                if (uniqueBaseName !== singleBaseName) {
                    logExportEvent('warn', 'batch_entry_name_collision', {
                        resolvedFileName,
                        singleBaseName,
                        threadId: browseData.thread.id,
                    });
                }

                const bytes = await renderCodexExportContent({
                    input,
                    outputRelativePath: resolvedFileName,
                    relations: browseData.relations,
                    sessionFile: snapshotPath,
                    thread: browseData.thread,
                    transform,
                });
                return { bytes, relativePath: resolvedFileName };
            },
            threadId: result.threadId,
        });

        return {
            members: [rendered],
            outcome: {
                error: null,
                memberNames: [rendered.relativePath],
                omissionSummary: null,
                requestedId: result.threadId,
                status: 'exported',
            },
        };
    } catch (error) {
        if (isArchiveWideFailure(error) || !isPerEntryExportFailure(error)) {
            throw error;
        }

        const outcome = getBatchFailure(result.threadId, error);
        logExportEvent('warn', 'batch_entry_skipped', {
            error: error instanceof Error ? error.message : String(error),
            status: outcome.status,
            threadId: result.threadId,
        });
        return { members: [], outcome };
    }
};

export const renderCodexThreadsDownload = async (
    input: RenderCodexThreadsDownloadInput,
): Promise<CodexThreadDownload> => {
    const startedAt = Date.now();
    const threadIds = [...new Set(input.threadIds)];
    if (threadIds.length === 0) {
        throw new Error('No threads selected for export');
    }

    const browseResults = await getThreadBrowseDataBatch(input.dbPath, threadIds);
    const browseEntries = browseResults.flatMap((result) => (result.status === 'found' && result.data ? [result] : []));
    if (browseEntries.length === 0) {
        throw new Error('No exportable threads');
    }

    const threads = browseEntries.map((result) => result.data.thread);
    const exportDir = await resolvePublicExportDir(input.publicExportDir);
    const baseName = buildBatchExportBaseName(
        threads.map((thread) => ({
            cwd: thread.cwd,
            updatedAtMs: thread.updated_at_ms ?? thread.updated_at * 1000,
        })),
        'threads',
    );
    const usedBatchEntryBaseNames = new Set<string>();
    const members: ExportArchiveMember[] = [];
    const outcomes: ExportArchiveOutcome[] = [];

    logExportEvent('info', 'batch_start', {
        exportBaseName: buildArchiveBaseName(baseName),
        selectedThreadCount: threadIds.length,
        selectedThreadIds: threadIds,
    });

    try {
        for (const result of browseResults) {
            const entry = await renderCodexBatchEntry(input, result, usedBatchEntryBaseNames);
            members.push(...entry.members);
            outcomes.push(entry.outcome);
        }

        const successCount = outcomes.filter((outcome) => outcome.status === 'exported').length;
        if (successCount === 0) {
            throw new Error('No exportable threads');
        }

        const archive = await writeExportArchive({
            baseName,
            destination: { exportDir, mode: 'download_url' },
            manifest: {
                entries: outcomes,
                failedCount: outcomes.filter((outcome) => outcome.status === 'failed').length,
                failurePolicy: 'partial',
                kind: input.outputFormat === 'json' ? 'batch_original_raw' : 'batch_normalized_export',
                missingCount: outcomes.filter((outcome) => outcome.status === 'missing').length,
                options: {
                    includeCommentary: input.includeCommentary,
                    includeMetadata: input.includeMetadata,
                    includeTools: input.includeTools,
                    outputFormat: input.outputFormat,
                },
                requestedCount: outcomes.length,
                schemaVersion: 1,
                source: 'codex',
                successCount,
            },
            members,
            platform: 'codex',
        });
        const download = toCodexDownloadUrl(archive);
        logExportEvent('info', 'batch_ready', {
            downloadUrl: download.downloadUrl,
            durationMs: Date.now() - startedAt,
            fileName: download.fileName,
            selectedThreadCount: threadIds.length,
            selectedThreadIds: threadIds,
        });
        return {
            ...download,
            skippedThreadCount: outcomes.length - successCount,
        };
    } catch (error) {
        logExportEvent('error', 'batch_error', {
            error: error instanceof Error ? error.message : String(error),
            selectedThreadCount: threadIds.length,
            selectedThreadIds: threadIds,
        });
        throw error;
    }
};
