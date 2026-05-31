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
});

const exportThreadsSchema = z.object({
    composerIds: z.array(z.string().min(1)).min(1),
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

const findThreadByComposerId = async (composerId: string) => {
    for (const group of await listCursorWorkspaceGroups()) {
        const threads = await listCursorThreadsForGroup(group);
        const thread = threads.find((candidate) => candidate.composerId === composerId);
        if (thread) {
            return thread;
        }
    }

    return null;
};

const renderCursorDownload = (input: {
    composerIds: string[];
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: 'md' | 'txt';
}) => {
    const rendered = input.composerIds.map((composerId) => {
        const transcript = readCursorThreadTranscript(getCursorGlobalDbPath(), composerId);
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
    });

    if (rendered.length === 1) {
        return {
            content: rendered[0]!.content,
            filename: `${rendered[0]!.composerId}.${input.outputFormat}`,
        };
    }

    const separator =
        input.outputFormat === 'md'
            ? '\n\n---\n\n'
            : '\n\n================================================================\n\n';

    return {
        content: rendered
            .map((entry) => entry.content.trimEnd())
            .join(separator)
            .concat('\n'),
        filename: `cursor-threads-${rendered.length}.${input.outputFormat}`,
    };
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

export const getCursorThreadDetailFn = createServerFn({ method: 'GET' })
    .inputValidator(threadSchema)
    .handler(async ({ data }) => {
        const thread = await findThreadByComposerId(data.composerId);
        if (!thread) {
            throw new Error(`Cursor thread not found: ${data.composerId}`);
        }

        const transcript = readCursorThreadTranscript(getCursorGlobalDbPath(), data.composerId);
        return {
            renderedTranscript: transcript
                ? renderCursorTranscript(transcript, {
                      includeCommentary: true,
                      includeMetadata: false,
                      includeTools: true,
                      outputFormat: 'md',
                  })
                : null,
            thread,
            transcript,
        };
    });

export const exportCursorThreadFn = createServerFn({ method: 'POST' })
    .inputValidator(exportSchema)
    .handler(async ({ data }) => {
        return renderCursorDownload({
            composerIds: [data.composerId],
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
        });
    });

export const exportCursorThreadsFn = createServerFn({ method: 'POST' })
    .inputValidator(exportThreadsSchema)
    .handler(async ({ data }) => {
        return renderCursorDownload({
            composerIds: data.composerIds,
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
        });
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
