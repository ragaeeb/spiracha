import { CLINE_SESSION_ID_PATTERN } from '@spiracha/lib/cline-exporter-types';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireDeletedItems, runDeleteBatch } from './delete-batch';
import { renderSourceSessionDownload, renderSourceSessionsDownload } from './source-session-export-server';

const workspaceSchema = z.object({ workspaceKey: z.string().min(1) });
const taskSchema = z.object({ taskId: z.string().regex(CLINE_SESSION_ID_PATTERN) });
const exportTaskSchema = z.object({
    includeCommentary: z.boolean().default(true),
    includeMetadata: z.boolean().default(true),
    includeTools: z.boolean().default(true),
    outputFormat: z.enum(['md', 'txt']).default('md'),
    taskId: z.string().regex(CLINE_SESSION_ID_PATTERN),
    zipArchive: z.boolean().default(false),
});
const exportTasksSchema = exportTaskSchema.omit({ taskId: true, zipArchive: true }).extend({
    taskIds: z.array(z.string().regex(CLINE_SESSION_ID_PATTERN)).min(1),
});
const deleteTasksSchema = z.object({ taskIds: z.array(z.string().regex(CLINE_SESSION_ID_PATTERN)).min(1) });

export const listClineWorkspacesFn = createServerFn({ method: 'GET' }).handler(async () => {
    const { listClineWorkspaceGroups } = await import('@spiracha/lib/cline-db');
    return listClineWorkspaceGroups();
});

export const listClineTasksFn = createServerFn({ method: 'GET' })
    .validator(workspaceSchema)
    .handler(async ({ data }) => {
        const { listClineTasksForGroup } = await import('@spiracha/lib/cline-db');
        return listClineTasksForGroup(data.workspaceKey);
    });

const createClineTranscriptLoader = async () => {
    const { readClineTaskTranscript, resolveClineDataDir } = await import('@spiracha/lib/cline-db');
    const { runWithTranscriptLoadLimit } = await import('@spiracha/lib/transcript-load-limiter');
    const dataDir = resolveClineDataDir();
    return (taskId: string) =>
        runWithTranscriptLoadLimit(
            async () => {
                const transcript = await readClineTaskTranscript(dataDir, taskId);
                if (!transcript) {
                    throw new Error(`Cline chat not found: ${taskId}`);
                }
                return transcript;
            },
            { id: taskId, integration: 'cline', operation: 'ui-detail', path: dataDir },
        );
};

const loadClineTaskTranscript = async (taskId: string) => (await createClineTranscriptLoader())(taskId);

export const getClineTaskDetailFn = createServerFn({ method: 'GET' })
    .validator(taskSchema)
    .handler(({ data }) => loadClineTaskTranscript(data.taskId));

export const exportClineTaskFn = createServerFn({ method: 'POST' })
    .validator(exportTaskSchema)
    .handler(async ({ data }) => {
        const { renderClineTranscript } = await import('@spiracha/lib/cline-transcript');
        const transcript = await loadClineTaskTranscript(data.taskId);
        const content = renderClineTranscript(transcript, data);
        return renderSourceSessionDownload({
            content,
            cwd: transcript.task.worktree,
            fallbackBaseName: 'cline-chat',
            outputFormat: data.outputFormat,
            platform: 'cline',
            sessionId: transcript.task.taskId,
            updatedAtMs: transcript.task.lastActiveAtMs,
            zipArchive: data.zipArchive,
        });
    });

export const exportClineTasksFn = createServerFn({ method: 'POST' })
    .validator(exportTasksSchema)
    .handler(async ({ data }) => {
        const { renderClineTranscript } = await import('@spiracha/lib/cline-transcript');
        const loadTranscript = await createClineTranscriptLoader();
        const entries = await Promise.all(
            data.taskIds.map(async (taskId) => {
                const transcript = await loadTranscript(taskId);
                return {
                    content: renderClineTranscript(transcript, data),
                    cwd: transcript.task.worktree,
                    fallbackBaseName: 'cline-chat',
                    fileBaseName: transcript.task.title,
                    sessionId: taskId,
                    updatedAtMs: transcript.task.lastActiveAtMs,
                };
            }),
        );
        return renderSourceSessionsDownload({
            entries,
            fallbackBaseName: 'cline-chats',
            outputFormat: data.outputFormat,
            platform: 'cline',
            zipArchive: true,
        });
    });

export const deleteClineTaskFn = createServerFn({ method: 'POST' })
    .validator(taskSchema)
    .handler(async ({ data }) => {
        const { deleteClineTask, resolveClineDataDir } = await import('@spiracha/lib/cline-db');
        const result = await deleteClineTask(resolveClineDataDir(), data.taskId);
        requireDeletedItems(result.deletedTaskIds, 'Cline chat', data.taskId);
        return result;
    });

export const deleteClineTasksFn = createServerFn({ method: 'POST' })
    .validator(deleteTasksSchema)
    .handler(async ({ data }) => {
        const { deleteClineTask, resolveClineDataDir } = await import('@spiracha/lib/cline-db');
        const dataDir = resolveClineDataDir();
        const results = await runDeleteBatch(data.taskIds, (taskId) => deleteClineTask(dataDir, taskId));
        const deletedTaskIds = [...new Set(results.flatMap((result) => result.deletedTaskIds))];
        requireDeletedItems(deletedTaskIds, 'Cline chats', 'batch');
        return {
            deletedFiles: [...new Set(results.flatMap((result) => result.deletedFiles))],
            deletedTaskIds,
            indexCleanup: results.map((result) => result.indexCleanup),
        };
    });
