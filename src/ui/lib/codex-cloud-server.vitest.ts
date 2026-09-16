import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    getTaskMock,
    listProjectMock,
    listProjectsMock,
    renderCodexCloudExportMock,
    renderSourceSessionDownloadMock,
    renderSourceSessionsDownloadMock,
} = vi.hoisted(() => ({
    getTaskMock: vi.fn(),
    listProjectMock: vi.fn(),
    listProjectsMock: vi.fn(),
    renderCodexCloudExportMock: vi.fn(),
    renderSourceSessionDownloadMock: vi.fn(),
    renderSourceSessionsDownloadMock: vi.fn(),
}));

vi.mock('@tanstack/react-start', () => ({
    createServerFn: () => {
        const serverFn = {
            handler: (callback: unknown) => callback,
            validator: () => serverFn,
        };

        return serverFn;
    },
}));

vi.mock('@spiracha/lib/codex-cloud', () => ({
    codexCloudClient: {
        getTask: getTaskMock,
        listProject: listProjectMock,
        listProjects: listProjectsMock,
    },
    renderCodexCloudExport: renderCodexCloudExportMock,
}));

vi.mock('./source-session-export-server', () => ({
    renderSourceSessionDownload: renderSourceSessionDownloadMock,
    renderSourceSessionsDownload: renderSourceSessionsDownloadMock,
}));

import {
    exportCodexCloudTaskFn,
    exportCodexCloudTasksFn,
    getCodexCloudTaskFn,
    listCodexCloudProjectFn,
    listCodexCloudProjectsFn,
} from './codex-cloud-server';

describe('Codex Cloud server functions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should expose project and task reads through the Cloud client', async () => {
        listProjectsMock.mockResolvedValue(['projects']);
        listProjectMock.mockResolvedValue('project');
        getTaskMock.mockResolvedValue('task');

        await expect(listCodexCloudProjectsFn({ data: undefined })).resolves.toEqual(['projects']);
        await expect(listCodexCloudProjectFn({ data: { projectId: 'project-1' } })).resolves.toBe('project');
        await expect(getCodexCloudTaskFn({ data: { taskId: 'task_e_1' } })).resolves.toBe('task');

        expect(listProjectsMock).toHaveBeenCalledTimes(1);
        expect(listProjectMock).toHaveBeenCalledWith('project-1');
        expect(getTaskMock).toHaveBeenCalledWith('task_e_1');
    });

    it('should render and package a Cloud export with the selected options', async () => {
        const detail = { task: { id: 'task_e_1', updatedAt: '2026-01-01T00:00:00.000Z' } };
        getTaskMock.mockResolvedValue(detail);
        renderCodexCloudExportMock.mockReturnValue('# Cloud export');
        renderSourceSessionDownloadMock.mockReturnValue({ fileName: 'cloud.md', mode: 'download' });

        const result = await exportCodexCloudTaskFn({
            data: {
                includeCommentary: true,
                includeMetadata: false,
                includeTools: true,
                outputFormat: 'md',
                taskId: 'task_e_1',
                zipArchive: true,
            },
        });

        expect(result).toEqual({ fileName: 'cloud.md', mode: 'download' });
        expect(renderCodexCloudExportMock).toHaveBeenCalledWith(detail, {
            includeCommentary: true,
            includeMetadata: false,
            includeTools: true,
            outputFormat: 'md',
        });
        expect(renderSourceSessionDownloadMock).toHaveBeenCalledWith({
            content: '# Cloud export',
            cwd: null,
            fallbackBaseName: 'codex-cloud',
            outputFormat: 'md',
            platform: 'codex',
            sessionId: 'task_e_1',
            updatedAtMs: Date.parse('2026-01-01T00:00:00.000Z'),
            zipArchive: true,
        });
    });

    it('should package a Cloud batch export from the current task list', async () => {
        const first = { task: { id: 'task_e_1', title: 'First', updatedAt: '2026-01-01T00:00:00.000Z' } };
        const second = { task: { id: 'task_e_2', title: 'Second', updatedAt: null } };
        getTaskMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
        renderCodexCloudExportMock.mockReturnValueOnce('# First').mockReturnValueOnce('# Second');
        renderSourceSessionsDownloadMock.mockResolvedValue({ fileName: 'cloud.zip', mode: 'download_url' });

        const result = await exportCodexCloudTasksFn({
            data: {
                includeCommentary: false,
                includeMetadata: true,
                includeTools: false,
                outputFormat: 'txt',
                taskIds: ['task_e_1', 'task_e_2'],
                zipArchive: true,
            },
        });

        expect(result).toEqual({ fileName: 'cloud.zip', mode: 'download_url' });
        expect(getTaskMock).toHaveBeenCalledWith('task_e_1');
        expect(getTaskMock).toHaveBeenCalledWith('task_e_2');
        expect(renderSourceSessionsDownloadMock).toHaveBeenCalledWith({
            entries: [
                {
                    content: '# First',
                    cwd: null,
                    fallbackBaseName: 'codex-cloud',
                    fileBaseName: 'First',
                    sessionId: 'task_e_1',
                    updatedAtMs: Date.parse('2026-01-01T00:00:00.000Z'),
                },
                {
                    content: '# Second',
                    cwd: null,
                    fallbackBaseName: 'codex-cloud',
                    fileBaseName: 'Second',
                    sessionId: 'task_e_2',
                    updatedAtMs: null,
                },
            ],
            fallbackBaseName: 'codex-cloud-tasks',
            outputFormat: 'txt',
            platform: 'codex',
            zipArchive: true,
        });
    });
});
