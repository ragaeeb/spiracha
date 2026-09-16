import { createServerFn } from '@tanstack/react-start';
import { array, boolean, minLength, object, optional, picklist, pipe, string } from 'valibot';

const projectSchema = object({
    projectId: pipe(string(), minLength(1)),
});

const taskSchema = object({
    taskId: pipe(string(), minLength(1)),
});

const exportSchema = object({
    includeCommentary: boolean(),
    includeMetadata: boolean(),
    includeTools: boolean(),
    outputFormat: picklist(['md', 'txt']),
    taskId: pipe(string(), minLength(1)),
    zipArchive: optional(boolean(), false),
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

const exportTasksSchema = object({
    includeCommentary: boolean(),
    includeMetadata: boolean(),
    includeTools: boolean(),
    outputFormat: picklist(['md', 'txt']),
    taskIds: pipe(array(pipe(string(), minLength(1))), minLength(1)),
    zipArchive: optional(boolean(), false),
});

const cloudExportOptions = (data: {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: 'md' | 'txt';
}) => ({
    includeCommentary: data.includeCommentary,
    includeMetadata: data.includeMetadata,
    includeTools: data.includeTools,
    outputFormat: data.outputFormat,
});

const renderCloudTaskEntry = async (taskId: string, options: ReturnType<typeof cloudExportOptions>) => {
    const { renderCodexCloudExport } = await import('@spiracha/lib/codex-cloud');
    const detail = await (await getCodexCloudClient()).getTask(taskId);
    return {
        content: renderCodexCloudExport(detail, options),
        cwd: null,
        fallbackBaseName: 'codex-cloud',
        fileBaseName: detail.task.title || detail.task.id,
        sessionId: detail.task.id,
        updatedAtMs: detail.task.updatedAt ? Date.parse(detail.task.updatedAt) : null,
    };
};

export const exportCodexCloudTaskFn = createServerFn({ method: 'POST' })
    .validator(exportSchema)
    .handler(async ({ data }) => {
        const entry = await renderCloudTaskEntry(data.taskId, cloudExportOptions(data));
        const { renderSourceSessionDownload } = await import('./source-session-export-server');
        return renderSourceSessionDownload({
            content: entry.content,
            cwd: entry.cwd,
            fallbackBaseName: entry.fallbackBaseName,
            outputFormat: data.outputFormat,
            platform: 'codex',
            sessionId: entry.sessionId,
            updatedAtMs: entry.updatedAtMs,
            zipArchive: data.zipArchive,
        });
    });

export const exportCodexCloudTasksFn = createServerFn({ method: 'POST' })
    .validator(exportTasksSchema)
    .handler(async ({ data }) => {
        const options = cloudExportOptions(data);
        const entries = [];
        for (const taskId of data.taskIds) {
            entries.push(await renderCloudTaskEntry(taskId, options));
        }
        const { renderSourceSessionsDownload } = await import('./source-session-export-server');
        return renderSourceSessionsDownload({
            entries,
            fallbackBaseName: 'codex-cloud-tasks',
            outputFormat: data.outputFormat,
            platform: 'codex',
            zipArchive: data.zipArchive,
        });
    });
