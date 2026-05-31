import {
    listCursorThreadsForGroup,
    listCursorWorkspaceGroups,
    readCursorThreadTranscript,
} from '@spiracha/lib/cursor-db';
import { getCursorGlobalDbPath } from '@spiracha/lib/cursor-exporter-types';
import {
    collectCursorThreadsForDeletion,
    isCursorRunning,
    pruneCursorThreads,
    recoverCursorWorkspaceGroup,
} from '@spiracha/lib/cursor-recovery';
import { renderCursorTranscript } from '@spiracha/lib/cursor-transcript';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

const workspaceSchema = z.object({
    workspaceKey: z.string().min(1),
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
});

const deleteThreadsSchema = z.object({
    composerIds: z.array(z.string().min(1)).min(1),
});

const ensureCursorClosedForWrite = async () => {
    if (await isCursorRunning()) {
        throw new Error(
            'Quit Cursor before deleting. It rewrites chat history on exit, which can resurrect deleted threads.',
        );
    }
};

const findGroupByKey = async (workspaceKey: string) => {
    const groups = await listCursorWorkspaceGroups();
    const group = groups.find((candidate) => candidate.key === workspaceKey);
    if (!group) {
        throw new Error(`Cursor workspace not found: ${workspaceKey}`);
    }

    return group;
};

export const listCursorWorkspacesFn = createServerFn({ method: 'GET' }).handler(async () => {
    return listCursorWorkspaceGroups();
});

export const listCursorThreadsFn = createServerFn({ method: 'GET' })
    .inputValidator(workspaceSchema)
    .handler(async ({ data }) => {
        const group = await findGroupByKey(data.workspaceKey);
        return listCursorThreadsForGroup(group, undefined, { includeTranscriptDirs: false });
    });

export const exportCursorThreadFn = createServerFn({ method: 'POST' })
    .inputValidator(exportSchema)
    .handler(async ({ data }) => {
        const transcript = readCursorThreadTranscript(getCursorGlobalDbPath(), data.composerId);
        if (!transcript) {
            throw new Error(`No transcript found for thread: ${data.composerId}`);
        }

        const content = renderCursorTranscript(transcript, {
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
        });

        if (!content) {
            throw new Error(`Thread has no exportable content: ${data.composerId}`);
        }

        return {
            content,
            filename: `${data.composerId}.${data.outputFormat}`,
        };
    });

export const recoverCursorWorkspaceFn = createServerFn({ method: 'POST' })
    .inputValidator(recoverSchema)
    .handler(async ({ data }) => {
        const group = await findGroupByKey(data.workspaceKey);
        // Cursor rewrites composer.composerHeaders on exit, so a write while it is running gets
        // clobbered. Refuse to apply until Cursor is closed.
        if (data.apply && (await isCursorRunning())) {
            throw new Error('Quit Cursor before recovering. It overwrites chat history on exit, undoing the recovery.');
        }

        return recoverCursorWorkspaceGroup(group, data.apply);
    });

export const deleteCursorThreadsFn = createServerFn({ method: 'POST' })
    .inputValidator(deleteThreadsSchema)
    .handler(async ({ data }) => {
        await ensureCursorClosedForWrite();
        const threads = await collectCursorThreadsForDeletion(data.composerIds);
        return pruneCursorThreads(threads, true);
    });

export const deleteCursorWorkspaceFn = createServerFn({ method: 'POST' })
    .inputValidator(workspaceSchema)
    .handler(async ({ data }) => {
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
