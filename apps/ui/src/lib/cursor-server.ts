import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    getExportMimeType,
    resolveUniqueExportFileBaseName,
    sanitizeExportFileName,
    zipExportDirectory,
} from '@spiracha/lib/ui-export-archive';
import { buildUiExportDownloadUrl, ensureUiExportDir } from '@spiracha/lib/ui-export-files';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

const workspaceSchema = z.object({
    workspaceKey: z.string().min(1),
});

const threadSchema = z.object({
    composerId: z.string().min(1),
});

const recoverSchema = z.object({
    apply: z.boolean().default(false),
    workspaceKey: z.string().min(1),
});

const exportSchema = z.object({
    composerId: z.string().min(1),
    includeCommentary: z.boolean().default(true),
    includeMetadata: z.boolean().default(true),
    includeTools: z.boolean().default(true),
    outputFormat: z.enum(['md', 'txt']).default('md'),
    zipArchive: z.boolean().default(false),
});

const exportThreadsSchema = z.object({
    composerIds: z.array(z.string().min(1)).min(1),
    includeCommentary: z.boolean().default(true),
    includeMetadata: z.boolean().default(true),
    includeTools: z.boolean().default(true),
    outputFormat: z.enum(['md', 'txt']).default('md'),
    zipArchive: z.boolean().default(true),
});

const deleteThreadsSchema = z.object({
    composerIds: z.array(z.string().min(1)).min(1),
});

const ensureCursorClosedForWrite = async () => {
    const { isCursorRunning } = await import('@spiracha/lib/cursor-recovery');
    if (await isCursorRunning()) {
        throw new Error(
            'Quit Cursor before deleting. It rewrites chat history on exit, which can resurrect deleted threads.',
        );
    }
};

const findGroupByKey = async (workspaceKey: string) => {
    const { listCursorWorkspaceGroups } = await import('@spiracha/lib/cursor-db');
    const groups = await listCursorWorkspaceGroups();
    const group = groups.find((candidate) => candidate.key === workspaceKey);
    if (!group) {
        throw new Error(`Cursor workspace not found: ${workspaceKey}`);
    }

    return group;
};

const toSafeExportName = (value: string) => {
    return sanitizeExportFileName(value) || 'cursor-thread';
};

const renderCursorZipDownload = async (
    rendered: Array<{ composerId: string; content: string }>,
    outputFormat: 'md' | 'txt',
) => {
    const exportDir = await ensureUiExportDir();
    const exportBaseName =
        rendered.length === 1 ? `${toSafeExportName(rendered[0]!.composerId)}` : `cursor-threads-${rendered.length}`;
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), `${exportBaseName}-`));
    const zipPath = path.join(exportDir, `${exportBaseName}-${randomUUID()}.zip`);
    const usedBaseNames = new Map<string, number>();

    try {
        for (const entry of rendered) {
            const baseName = toSafeExportName(entry.composerId);
            const fileBaseName = resolveUniqueExportFileBaseName(baseName, usedBaseNames);
            await Bun.write(path.join(workspaceDir, `${fileBaseName}.${outputFormat}`), entry.content);
        }

        await zipExportDirectory(workspaceDir, zipPath);
    } finally {
        await rm(workspaceDir, { force: true, recursive: true });
    }

    return {
        downloadUrl: buildUiExportDownloadUrl(zipPath),
        fileName: `${exportBaseName}.zip`,
        mimeType: 'application/zip',
        mode: 'download_url' as const,
    };
};

export const findCursorThreadByComposerId = async (composerId: string) => {
    const { listCursorThreadsForGroup, listCursorWorkspaceGroups } = await import('@spiracha/lib/cursor-db');
    for (const group of await listCursorWorkspaceGroups()) {
        const threads = await listCursorThreadsForGroup(group, undefined, { includeTranscriptDirs: false });
        const thread = threads.find((candidate) => candidate.composerId === composerId);
        if (thread) {
            return thread;
        }
    }

    return null;
};

const renderCursorDownload = async (input: {
    composerIds: string[];
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: 'md' | 'txt';
    zipArchive: boolean;
}) => {
    const { readCursorThreadTranscriptWithAgentFiles } = await import('@spiracha/lib/cursor-db');
    const { getCursorGlobalDbPath } = await import('@spiracha/lib/cursor-exporter-types');
    const { renderCursorTranscript } = await import('@spiracha/lib/cursor-transcript');
    const globalDbPath = getCursorGlobalDbPath();
    const rendered = await Promise.all(
        input.composerIds.map(async (composerId) => {
            const transcript = await readCursorThreadTranscriptWithAgentFiles(globalDbPath, composerId);
            if (!transcript) {
                throw new Error(`No transcript found for thread: ${composerId}`);
            }

            const content = renderCursorTranscript(transcript, {
                includeCommentary: input.includeCommentary,
                includeMetadata: input.includeMetadata,
                includeTools: input.includeTools,
                outputFormat: input.outputFormat,
            });

            if (!content) {
                throw new Error(`Thread has no exportable content: ${composerId}`);
            }

            return {
                composerId,
                content,
            };
        }),
    );

    if (input.zipArchive || rendered.length > 1) {
        return renderCursorZipDownload(rendered, input.outputFormat);
    }

    if (rendered.length === 1) {
        return {
            content: rendered[0]!.content,
            fileName: `${toSafeExportName(rendered[0]!.composerId)}.${input.outputFormat}`,
            mimeType: getExportMimeType(input.outputFormat),
            mode: 'download' as const,
        };
    }

    throw new Error('No Cursor threads selected for export');
};

export const listCursorWorkspacesFn = createServerFn({ method: 'GET' }).handler(async () => {
    const { listCursorWorkspaceGroups } = await import('@spiracha/lib/cursor-db');
    return listCursorWorkspaceGroups();
});

export const listCursorThreadsFn = createServerFn({ method: 'GET' })
    .validator(workspaceSchema)
    .handler(async ({ data }) => {
        const { listCursorThreadsForGroup } = await import('@spiracha/lib/cursor-db');
        const group = await findGroupByKey(data.workspaceKey);
        return listCursorThreadsForGroup(group, undefined, { includeTranscriptDirs: false });
    });

export const getCursorThreadDetailFn = createServerFn({ method: 'GET' })
    .validator(threadSchema)
    .handler(async ({ data }) => {
        const { readCursorThreadTranscriptWithAgentFiles } = await import('@spiracha/lib/cursor-db');
        const { getCursorGlobalDbPath } = await import('@spiracha/lib/cursor-exporter-types');
        const thread = await findCursorThreadByComposerId(data.composerId);
        if (!thread) {
            throw new Error(`Cursor thread not found: ${data.composerId}`);
        }

        const transcript = await readCursorThreadTranscriptWithAgentFiles(getCursorGlobalDbPath(), data.composerId);
        return {
            thread,
            transcript,
        };
    });

export const exportCursorThreadFn = createServerFn({ method: 'POST' })
    .validator(exportSchema)
    .handler(async ({ data }) => {
        return await renderCursorDownload({
            composerIds: [data.composerId],
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
            zipArchive: data.zipArchive,
        });
    });

export const exportCursorThreadsFn = createServerFn({ method: 'POST' })
    .validator(exportThreadsSchema)
    .handler(async ({ data }) => {
        return await renderCursorDownload({
            composerIds: data.composerIds,
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
            zipArchive: data.zipArchive,
        });
    });

export const recoverCursorWorkspaceFn = createServerFn({ method: 'POST' })
    .validator(recoverSchema)
    .handler(async ({ data }) => {
        const { isCursorRunning, recoverCursorWorkspaceGroup } = await import('@spiracha/lib/cursor-recovery');
        const group = await findGroupByKey(data.workspaceKey);
        // Cursor rewrites composer.composerHeaders on exit, so a write while it is running gets
        // clobbered. Refuse to apply until Cursor is closed.
        if (data.apply && (await isCursorRunning())) {
            throw new Error('Quit Cursor before recovering. It overwrites chat history on exit, undoing the recovery.');
        }

        return recoverCursorWorkspaceGroup(group, data.apply);
    });

export const deleteCursorThreadsFn = createServerFn({ method: 'POST' })
    .validator(deleteThreadsSchema)
    .handler(async ({ data }) => {
        const { collectCursorThreadsForDeletion, pruneCursorThreads } = await import('@spiracha/lib/cursor-recovery');
        await ensureCursorClosedForWrite();
        const threads = await collectCursorThreadsForDeletion(data.composerIds);
        return pruneCursorThreads(threads, true);
    });

export const deleteCursorWorkspaceFn = createServerFn({ method: 'POST' })
    .validator(workspaceSchema)
    .handler(async ({ data }) => {
        const { listCursorThreadsForGroup } = await import('@spiracha/lib/cursor-db');
        const { collectCursorThreadsForDeletion, pruneCursorThreads } = await import('@spiracha/lib/cursor-recovery');
        await ensureCursorClosedForWrite();
        const group = await findGroupByKey(data.workspaceKey);
        const threads = await listCursorThreadsForGroup(group, undefined, { includeTranscriptDirs: false });
        const composerIds = threads.map((thread) => thread.composerId);
        if (composerIds.length === 0) {
            return {
                bubblesDeleted: 0,
                composerDataDeleted: 0,
                composerIds: [],
                headersRemoved: 0,
                transcriptDirsRemoved: 0,
                workspaceBucketsUpdated: 0,
            };
        }

        const deletable = await collectCursorThreadsForDeletion(composerIds);
        return pruneCursorThreads(deletable, true);
    });
