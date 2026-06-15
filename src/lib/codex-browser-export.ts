import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { getThreadBrowseData } from './codex-browser-db';
import { convertSessionFile, writeSessionFileExport } from './codex-exporter-transcript';
import type { CodexCliOptions } from './codex-exporter-types';
import { applyPathTransforms, type PathDisplaySettings } from './path-transforms';
import { type ExportFormat, getPortablePathBasename } from './shared';
import { getExportMimeType, sanitizeExportFileName, zipExportDirectory, zipExportFile } from './ui-export-archive';
import { buildUiExportDownloadUrl, ensureUiExportDir } from './ui-export-files';

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
      };

const LARGE_BROWSER_EXPORT_THRESHOLD_BYTES = 128 * 1024 * 1024;

const formatReadableExportDate = (value: number) => {
    const date = new Date(value);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}-${hours}${minutes}`;
};

const buildExportBaseName = (thread: ReturnType<typeof getThreadBrowseData>['thread']) => {
    const projectName = sanitizeExportFileName(getPortablePathBasename(thread.cwd) || 'thread') || 'thread';
    const timestamp = thread.updated_at_ms ?? thread.updated_at * 1000;
    return `${projectName}-${formatReadableExportDate(timestamp)}-${thread.id.slice(0, 8)}`;
};

const buildBatchExportBaseName = (threads: Array<ReturnType<typeof getThreadBrowseData>['thread']>) => {
    const firstThread = threads[0];
    if (!firstThread) {
        throw new Error('No threads selected for export');
    }

    const projectName = sanitizeExportFileName(getPortablePathBasename(firstThread.cwd) || 'threads') || 'threads';
    const latestTimestamp = Math.max(...threads.map((thread) => thread.updated_at_ms ?? thread.updated_at * 1000));
    return `${projectName}-${formatReadableExportDate(latestTimestamp)}-threads-${threads.length}`;
};

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

type RolloutSnapshot = {
    mtimeMs: number;
    sizeBytes: number;
};

const toDownloadOptions = (input: RenderCodexThreadDownloadInput): CodexCliOptions => {
    return {
        cwdFilter: null,
        dbPath: input.dbPath,
        flat: false,
        includeCommentary: input.includeCommentary,
        includeMetadata: input.includeMetadata,
        includeTools: input.includeTools,
        inputDir: '',
        outputDir: '',
        outputFormat: input.outputFormat,
        projectFilter: null,
        threadIds: [input.threadId],
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

const getRolloutSnapshot = async (rolloutPath: string): Promise<RolloutSnapshot> => {
    const metadata = await stat(rolloutPath);
    return {
        mtimeMs: metadata.mtimeMs,
        sizeBytes: metadata.size,
    };
};

const isMissingFileError = (error: unknown) => {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
};

const getExistingRolloutSnapshot = async (threadId: string, rolloutPath: string): Promise<RolloutSnapshot> => {
    try {
        return await getRolloutSnapshot(rolloutPath);
    } catch (error) {
        if (isMissingFileError(error)) {
            throw new Error(`Thread ${threadId} rollout file is missing: ${rolloutPath}`, { cause: error });
        }

        throw error;
    }
};

const logExportEvent = (level: 'error' | 'info' | 'warn', event: string, details: Record<string, unknown>) => {
    console[level](`[spiracha:export] ${event}`, details);
};

const logRolloutChangeIfDetected = (
    threadId: string,
    beforeSnapshot: RolloutSnapshot,
    afterSnapshot: RolloutSnapshot,
) => {
    if (beforeSnapshot.mtimeMs === afterSnapshot.mtimeMs && beforeSnapshot.sizeBytes === afterSnapshot.sizeBytes) {
        return;
    }

    logExportEvent('warn', 'rollout_changed_during_export', {
        afterMtimeMs: afterSnapshot.mtimeMs,
        afterSizeBytes: afterSnapshot.sizeBytes,
        beforeMtimeMs: beforeSnapshot.mtimeMs,
        beforeSizeBytes: beforeSnapshot.sizeBytes,
        threadId,
    });
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

export const renderCodexThreadDownload = async (
    input: RenderCodexThreadDownloadInput,
): Promise<CodexThreadDownload> => {
    const startedAt = Date.now();
    const browseData = getThreadBrowseData(input.dbPath, input.threadId);
    const extension = input.outputFormat === 'md' ? 'md' : 'txt';
    const fileBaseName = buildExportBaseName(browseData.thread);
    const fileName = `${fileBaseName}.${extension}`;
    const mimeType = getExportMimeType(input.outputFormat);
    const transform = (text: string) =>
        input.pathDisplaySettings
            ? applyPathTransforms(text, {
                  ...input.pathDisplaySettings,
                  projectPath: browseData.thread.cwd,
              })
            : text;
    const rolloutSnapshotBefore = await getExistingRolloutSnapshot(input.threadId, browseData.thread.rollout_path);

    logExportEvent('info', 'single_start', {
        fileName,
        sizeBytes: rolloutSnapshotBefore.sizeBytes,
        threadId: input.threadId,
    });

    try {
        if (
            input.zipArchive ||
            rolloutSnapshotBefore.sizeBytes > (input.largeExportThresholdBytes ?? LARGE_BROWSER_EXPORT_THRESHOLD_BYTES)
        ) {
            const exportBaseName = fileBaseName;
            const exportDir = await resolvePublicExportDir(input.publicExportDir);
            const workspaceDir = await createExportWorkspace(exportDir, exportBaseName);
            const savedPath = path.join(workspaceDir, `${exportBaseName}.${extension}`);
            const zipPath = buildUniqueArchivePath(exportDir, exportBaseName);
            try {
                const saved = await writeSessionFileExport(
                    {
                        fallbackReason: null,
                        outputRelativePath: fileName,
                        relations: browseData.relations,
                        sessionFile: browseData.thread.rollout_path,
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

            const rolloutSnapshotAfter = await getRolloutSnapshot(browseData.thread.rollout_path);
            logRolloutChangeIfDetected(input.threadId, rolloutSnapshotBefore, rolloutSnapshotAfter);

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
                mode: 'download_url',
            };
        }

        const content = await convertSessionFile(
            {
                fallbackReason: null,
                outputRelativePath: fileName,
                relations: browseData.relations,
                sessionFile: browseData.thread.rollout_path,
                thread: browseData.thread,
            },
            toDownloadOptions(input),
        );

        if (!content) {
            throw new Error(`Thread ${input.threadId} produced no exportable content`);
        }

        const rolloutSnapshotAfter = await getRolloutSnapshot(browseData.thread.rollout_path);
        logRolloutChangeIfDetected(input.threadId, rolloutSnapshotBefore, rolloutSnapshotAfter);
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
            mode: 'download',
        };
    } catch (error) {
        logExportEvent('error', 'single_error', {
            error: error instanceof Error ? error.message : String(error),
            fileName,
            threadId: input.threadId,
        });
        throw error;
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

    const browseEntries = threadIds.map((threadId) => getThreadBrowseData(input.dbPath, threadId));
    const threads = browseEntries.map((entry) => entry.thread);
    const exportDir = await resolvePublicExportDir(input.publicExportDir);
    const exportBaseName = buildBatchExportBaseName(threads);
    const bundleDirectory = await createExportWorkspace(exportDir, exportBaseName);
    const zipPath = buildUniqueArchivePath(exportDir, exportBaseName);
    const usedBatchEntryBaseNames = new Set<string>();

    logExportEvent('info', 'batch_start', {
        exportBaseName,
        selectedThreadCount: threadIds.length,
        selectedThreadIds: threadIds,
        zipPath,
    });

    try {
        for (const entry of browseEntries) {
            const rolloutSnapshotBefore = await getExistingRolloutSnapshot(entry.thread.id, entry.thread.rollout_path);
            const singleBaseName = buildExportBaseName(entry.thread);
            const uniqueBaseName = buildUniqueBatchEntryBaseName(
                singleBaseName,
                entry.thread.id,
                usedBatchEntryBaseNames,
            );
            const extension = input.outputFormat === 'md' ? 'md' : 'txt';
            const relativeFileName = `${uniqueBaseName}.${extension}`;
            const savedPath = path.join(bundleDirectory, relativeFileName);
            const transform = (text: string) =>
                input.pathDisplaySettings
                    ? applyPathTransforms(text, {
                          ...input.pathDisplaySettings,
                          projectPath: entry.thread.cwd,
                      })
                    : text;

            if (uniqueBaseName !== singleBaseName) {
                logExportEvent('warn', 'batch_entry_name_collision', {
                    resolvedFileName: relativeFileName,
                    singleBaseName,
                    threadId: entry.thread.id,
                });
            }

            const saved = await writeSessionFileExport(
                {
                    fallbackReason: null,
                    outputRelativePath: relativeFileName,
                    relations: entry.relations,
                    sessionFile: entry.thread.rollout_path,
                    thread: entry.thread,
                },
                {
                    ...toDownloadOptions({
                        ...input,
                        threadId: entry.thread.id,
                    }),
                    threadIds: [entry.thread.id],
                },
                savedPath,
                transform,
            );

            if (!saved) {
                throw new Error(`Thread ${entry.thread.id} produced no exportable content`);
            }

            const rolloutSnapshotAfter = await getRolloutSnapshot(entry.thread.rollout_path);
            logRolloutChangeIfDetected(entry.thread.id, rolloutSnapshotBefore, rolloutSnapshotAfter);
        }

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
    };
};
