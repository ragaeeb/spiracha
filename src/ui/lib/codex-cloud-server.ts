import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

const projectSchema = z.object({
    projectId: z.string().min(1),
});

const taskSchema = z.object({
    taskId: z.string().min(1),
});

const exportSchema = z.object({
    includeCommentary: z.boolean(),
    includeMetadata: z.boolean(),
    includeTools: z.boolean(),
    outputFormat: z.enum(['md', 'txt']),
    taskId: z.string().min(1),
    zipArchive: z.boolean().default(false),
});

const getCodexCloudClient = async () => {
    const { codexCloudClient } = await import('@spiracha/lib/codex-cloud');
    return codexCloudClient;
};

export const listCodexCloudProjectsFn = createServerFn({ method: 'GET' }).handler(async () => {
    return (await getCodexCloudClient()).listProjects();
});

export const listCodexCloudProjectFn = createServerFn({ method: 'GET' })
    .validator(projectSchema)
    .handler(async ({ data }) => {
        return (await getCodexCloudClient()).listProject(data.projectId);
    });

export const getCodexCloudTaskFn = createServerFn({ method: 'GET' })
    .validator(taskSchema)
    .handler(async ({ data }) => {
        return (await getCodexCloudClient()).getTask(data.taskId);
    });

export const exportCodexCloudTaskFn = createServerFn({ method: 'POST' })
    .validator(exportSchema)
    .handler(async ({ data }) => {
        const { renderCodexCloudExport } = await import('@spiracha/lib/codex-cloud');
        const detail = await (await getCodexCloudClient()).getTask(data.taskId);
        const content = renderCodexCloudExport(detail, {
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
        });
        const { renderSourceSessionDownload } = await import('./source-session-export-server');

        return renderSourceSessionDownload({
            content,
            cwd: null,
            fallbackBaseName: 'codex-cloud',
            outputFormat: data.outputFormat,
            platform: 'codex',
            sessionId: detail.task.id,
            updatedAtMs: detail.task.updatedAt ? Date.parse(detail.task.updatedAt) : null,
            zipArchive: data.zipArchive,
        });
    });
