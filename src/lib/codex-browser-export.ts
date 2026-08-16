import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    CodexDbCompatibilityError,
    CodexThreadNotFoundError,
    getThreadBrowseData,
    getThreadBrowseDataBatch,
} from './codex-browser-db';
import type { ThreadBrowseData } from './codex-browser-types';
import {
    CodexRolloutMutationError,
    type CodexRolloutSnapshot,
    CodexRolloutSourceError,
    copyStableCodexRollout,
} from './codex-rollout-snapshot';
import type { CodexTranscriptRenderOptions } from './codex-thread-types';
import { renderCodexSessionFile, writeCodexSessionFileExport } from './codex-transcript-renderer';
import { applyPathTransforms, type PathDisplaySettings } from './path-transforms';
import type { ExportFormat } from './shared';
import {
    buildBatchExportBaseName,
    buildConversationExportBaseName,
    buildExportArchiveBaseName,
    getExportMimeType,
} from './ui-export-archive';
import { buildUiExportDownloadUrl, ensureUiExportDir } from './ui-export-files';
import { zipExportDirectory, zipExportFile } from './ui-export-zip';

type RenderCodexThreadDownloadInput = {
    dbPath: string;
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    largeExportThresholdBytes?: number;
    outputFormat: ExportFormat;
    pathDisplaySettings?: Pick<PathDisplaySettings, 'convertToProjectRoot' | 'redactUsername'>;
    publicExportDir?: string;
    threadId: string;
    zipArchive?: boolean;
};

type RenderCodexThreadsDownloadInput = Omit<RenderCodexThreadDownloadInput, 'threadId'> & {
    threadIds: string[];
};

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

const LARGE_BROWSER_EXPORT_THRESHOLD_BYTES = 128 * 1024 * 1024;
const MAX_ROLLOUT_EXPORT_ATTEMPTS = 2;
const BATCH_MANIFEST_FILE_NAME = 'spiracha-manifest.json';
const BATCH_MANIFEST_SCHEMA_VERSION = 1;
const ARCHIVE_WIDE_FILE_ERROR_CODES = new Set(['EACCES', 'EIO', 'ENOSPC', 'ENOTDIR', 'EPERM', 'EROFS']);

type BatchExportManifestEntry =
    | {
          fileName: string;
          status: 'exported';
          threadId: string;
      }
    | {
          code: string;
          message: string;
          status: 'missing' | 'unreadable' | 'unstable';
          threadId: string;
      };

type BatchExportManifest = {
    entries: BatchExportManifestEntry[];
    exportedCount: number;
    generatedAt: string;
    requestedThreadIds: string[];
    schemaVersion: number;
    skippedCount: number;
};

const buildExportBaseName = (thread: ReturnType<typeof getThreadBrowseData>['thread']) => {
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

const buildUniqueArchivePath = (exportDir: string, exportBaseName: string) => {
    return path.join(exportDir, `${exportBaseName}-${randomUUID()}.zip`);
};

const buildUniqueBatchEntryBaseName = (baseName: string, threadId: string, usedBaseNames: Set<string>): string => {
    if (!usedBaseNames.has(baseName)) {
        usedBaseNames.add(baseName);
        return baseName;
    }

    const collisionSafeBaseName = `${baseName}-${threadId}`;
    usedBaseNames.add(collisionSafeBaseName);
    return collisionSafeBaseName;
};

const toDownloadOptions = (input: RenderCodexThreadDownloadInput): CodexTranscriptRenderOptions => {
    return {
        includeCommentary: input.includeCommentary,
        includeMetadata: input.includeMetadata,
        includeTools: input.includeTools,
        outputFormat: input.outputFormat,
    };
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

const createExportWorkspace = async (exportDir: string, exportBaseName: string) => {
    return mkdtemp(path.join(exportDir, `${exportBaseName}-`));
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
            attempt === 1 && initialBrowseData ? initialBrowseData : getThreadBrowseData(dbPath, threadId);
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
            if (error instanceof CodexRolloutMutationError && attempt < MAX_ROLLOUT_EXPORT_ATTEMPTS) {
                logExportEvent('warn', 'rollout_retry', {
                    attempt,
                    nextAttempt: attempt + 1,
                    threadId,
                });
                continue;
            }

            throw error;
        } finally {
            await cleanupExportWorkspace(attemptWorkspace);
        }
    }

    throw new Error(`Unable to create a stable rollout snapshot for thread ${threadId}`);
};

const getBatchFailure = (threadId: string, error: unknown): BatchExportManifestEntry => {
    if (error instanceof CodexThreadNotFoundError || error instanceof CodexRolloutSourceError) {
        return {
            code: error instanceof CodexRolloutSourceError ? error.code : 'CODEX_THREAD_NOT_FOUND',
            message: error.message,
            status:
                error instanceof CodexRolloutSourceError && error.code === 'CODEX_ROLLOUT_UNREADABLE'
                    ? 'unreadable'
                    : 'missing',
            threadId,
        };
    }

    if (error instanceof CodexRolloutMutationError) {
        return {
            code: error.code,
            message: error.message,
            status: 'unstable',
            threadId,
        };
    }

    return {
        code: 'CODEX_EXPORT_UNREADABLE',
        message: error instanceof Error ? error.message : String(error),
        status: 'unreadable',
        threadId,
    };
};

const writeBatchManifest = async (bundleDirectory: string, manifest: BatchExportManifest) => {
    await Bun.write(path.join(bundleDirectory, BATCH_MANIFEST_FILE_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
};

const isArchiveWideFailure = (error: unknown) => {
    if (error instanceof CodexDbCompatibilityError) {
        return true;
    }

    if (typeof error !== 'object' || error === null || !('code' in error)) {
        return false;
    }

    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' && ARCHIVE_WIDE_FILE_ERROR_CODES.has(code);
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
                const extension = input.outputFormat === 'md' ? 'md' : 'txt';
                const fileBaseName = buildExportBaseName(browseData.thread);
                fileName = `${fileBaseName}.${extension}`;
                const mimeType = getExportMimeType(input.outputFormat);
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

                if (
                    input.zipArchive ||
                    rollout.before.sizeBytes > (input.largeExportThresholdBytes ?? LARGE_BROWSER_EXPORT_THRESHOLD_BYTES)
                ) {
                    const exportBaseName = buildArchiveBaseName(fileBaseName);
                    const exportDir = await resolvePublicExportDir(input.publicExportDir);
                    const workspaceDir = await createExportWorkspace(exportDir, exportBaseName);
                    const savedPath = path.join(workspaceDir, fileName);
                    const zipPath = buildUniqueArchivePath(exportDir, exportBaseName);
                    try {
                        const saved = await writeCodexSessionFileExport(
                            {
                                fallbackReason: null,
                                outputRelativePath: fileName,
                                relations: browseData.relations,
                                sessionFile: snapshotPath,
                                thread: browseData.thread,
                            },
                            toDownloadOptions(input),
                            savedPath,
                            transform,
                        );

                        if (!saved) {
                            throw new Error(`Thread ${input.threadId} produced no exportable content`);
                        }

                        await zipExportFile(savedPath, zipPath);
                    } finally {
                        await cleanupExportWorkspace(workspaceDir);
                    }

                    const zipStat = await Bun.file(zipPath).stat();
                    logExportEvent('info', 'single_zip_ready', {
                        downloadUrl: buildUiExportDownloadUrl(zipPath),
                        durationMs: Date.now() - startedAt,
                        fileName: `${exportBaseName}.zip`,
                        sizeBytes: zipStat.size,
                        threadId: input.threadId,
                        zipPath,
                    });

                    return {
                        downloadUrl: buildUiExportDownloadUrl(zipPath),
                        fileName: `${exportBaseName}.zip`,
                        mimeType: 'application/zip',
                        mode: 'download_url' as const,
                    };
                }

                const content = await renderCodexSessionFile(
                    {
                        fallbackReason: null,
                        outputRelativePath: fileName,
                        relations: browseData.relations,
                        sessionFile: snapshotPath,
                        thread: browseData.thread,
                    },
                    toDownloadOptions(input),
                );

                if (!content) {
                    throw new Error(`Thread ${input.threadId} produced no exportable content`);
                }

                logExportEvent('info', 'single_inline_ready', {
                    durationMs: Date.now() - startedAt,
                    fileName,
                    sizeBytes: content.length,
                    threadId: input.threadId,
                });

                return {
                    content: transform(content),
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
    result: ReturnType<typeof getThreadBrowseDataBatch>[number],
    bundleDirectory: string,
    usedBatchEntryBaseNames: Set<string>,
): Promise<BatchExportManifestEntry> => {
    if (result.status !== 'found' || !result.data) {
        return {
            code: 'CODEX_THREAD_NOT_FOUND',
            message: `Thread ${result.threadId} was not found.`,
            status: 'missing',
            threadId: result.threadId,
        };
    }

    try {
        const relativeFileName = await withStableRolloutSnapshot({
            dbPath: input.dbPath,
            initialBrowseData: result.data,
            render: async ({ browseData, snapshotPath }) => {
                const singleBaseName = buildExportBaseName(browseData.thread);
                const uniqueBaseName = buildUniqueBatchEntryBaseName(
                    singleBaseName,
                    browseData.thread.id,
                    usedBatchEntryBaseNames,
                );
                const extension = input.outputFormat === 'md' ? 'md' : 'txt';
                const resolvedFileName = `${uniqueBaseName}.${extension}`;
                const savedPath = path.join(bundleDirectory, resolvedFileName);
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

                const saved = await writeCodexSessionFileExport(
                    {
                        fallbackReason: null,
                        outputRelativePath: resolvedFileName,
                        relations: browseData.relations,
                        sessionFile: snapshotPath,
                        thread: browseData.thread,
                    },
                    {
                        ...toDownloadOptions({
                            ...input,
                            threadId: browseData.thread.id,
                        }),
                    },
                    savedPath,
                    transform,
                );

                if (!saved) {
                    throw new Error(`Thread ${browseData.thread.id} produced no exportable content`);
                }

                return resolvedFileName;
            },
            threadId: result.threadId,
        });

        return { fileName: relativeFileName, status: 'exported', threadId: result.threadId };
    } catch (error) {
        if (isArchiveWideFailure(error)) {
            throw error;
        }

        const failure = getBatchFailure(result.threadId, error);
        logExportEvent('warn', 'batch_entry_skipped', {
            error: error instanceof Error ? error.message : String(error),
            status: failure.status,
            threadId: result.threadId,
        });
        return failure;
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

    const browseResults = getThreadBrowseDataBatch(input.dbPath, threadIds);
    const browseEntries = browseResults.flatMap((result) => (result.status === 'found' && result.data ? [result] : []));
    if (browseEntries.length === 0) {
        throw new Error('No exportable threads');
    }

    const threads = browseEntries.map((result) => result.data.thread);
    const exportDir = await resolvePublicExportDir(input.publicExportDir);
    const exportBaseName = buildArchiveBaseName(
        buildBatchExportBaseName(
            threads.map((thread) => ({
                cwd: thread.cwd,
                updatedAtMs: thread.updated_at_ms ?? thread.updated_at * 1000,
            })),
            'threads',
        ),
    );
    const bundleDirectory = await createExportWorkspace(exportDir, exportBaseName);
    const zipPath = buildUniqueArchivePath(exportDir, exportBaseName);
    const usedBatchEntryBaseNames = new Set<string>();
    const manifestEntries: BatchExportManifestEntry[] = [];

    logExportEvent('info', 'batch_start', {
        exportBaseName,
        selectedThreadCount: threadIds.length,
        selectedThreadIds: threadIds,
        zipPath,
    });

    try {
        for (const result of browseResults) {
            manifestEntries.push(await renderCodexBatchEntry(input, result, bundleDirectory, usedBatchEntryBaseNames));
        }

        const exportedCount = manifestEntries.filter((entry) => entry.status === 'exported').length;
        if (exportedCount === 0) {
            throw new Error('No exportable threads');
        }

        await writeBatchManifest(bundleDirectory, {
            entries: manifestEntries,
            exportedCount,
            generatedAt: new Date().toISOString(),
            requestedThreadIds: threadIds,
            schemaVersion: BATCH_MANIFEST_SCHEMA_VERSION,
            skippedCount: manifestEntries.length - exportedCount,
        });
        await zipExportDirectory(bundleDirectory, zipPath);
    } catch (error) {
        logExportEvent('error', 'batch_error', {
            error: error instanceof Error ? error.message : String(error),
            exportBaseName,
            selectedThreadCount: threadIds.length,
            selectedThreadIds: threadIds,
            zipPath,
        });
        throw error;
    } finally {
        await cleanupExportWorkspace(bundleDirectory);
    }

    const zipStat = await Bun.file(zipPath).stat();
    logExportEvent('info', 'batch_ready', {
        downloadUrl: buildUiExportDownloadUrl(zipPath),
        durationMs: Date.now() - startedAt,
        fileName: `${exportBaseName}.zip`,
        selectedThreadCount: threadIds.length,
        selectedThreadIds: threadIds,
        sizeBytes: zipStat.size,
        zipPath,
    });

    return {
        downloadUrl: buildUiExportDownloadUrl(zipPath),
        fileName: `${exportBaseName}.zip`,
        mimeType: 'application/zip',
        mode: 'download_url',
        skippedThreadCount: manifestEntries.filter((entry) => entry.status !== 'exported').length,
    };
};
