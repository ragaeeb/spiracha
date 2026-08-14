import type { ClineTaskTranscript } from '@spiracha/lib/cline-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-start', () => ({
    createServerFn: () => {
        let inputValidator: { parse: (value: unknown) => unknown } | undefined;
        const serverFn = {
            handler: (callback: unknown) => {
                const handler = callback as (args?: { data?: unknown }) => unknown;
                return async (args?: { data?: unknown }) => {
                    if (!inputValidator) {
                        return await handler(args);
                    }

                    return await handler({ ...args, data: inputValidator.parse(args?.data) });
                };
            },
            validator: (validator: unknown) => {
                inputValidator = validator as { parse: (value: unknown) => unknown };
                return serverFn;
            },
        };
        return serverFn;
    },
}));

vi.mock('./source-session-export-server', () => ({
    renderSourceSessionDownload: vi.fn(async (options: unknown) => ({
        ...(options as object),
        fileName: 'cline-chat.md',
        mimeType: 'text/markdown',
        mode: 'download',
    })),
    renderSourceSessionsDownload: vi.fn(async () => ({
        downloadUrl: '/api/ui-exports/cline.zip',
        fileName: 'cline-chats.zip',
        mode: 'url',
    })),
}));

const transcript = {
    messages: [],
    renderablePartCount: 1,
    task: {
        assistantMessageCount: 1,
        cacheReads: null,
        cacheWrites: null,
        createdAtMs: 100,
        isFavorited: false,
        lastActiveAtMs: 200,
        messageCount: 2,
        messagesPath: '/cline/sessions/1/1.messages.json',
        modelId: 'cline-model',
        reasoningCount: 0,
        renderablePartCount: 1,
        sessionDir: '/cline/sessions/1',
        taskId: '1',
        title: 'Cline task',
        tokensIn: null,
        tokensOut: null,
        toolCallCount: 0,
        toolResultCount: 0,
        totalCost: null,
        ulid: null,
        userMessageCount: 1,
        workspaceKey: 'workspace:%2Frepo',
        workspaceLabel: 'repo',
        worktree: '/repo',
    },
} satisfies ClineTaskTranscript;

const dbMocks = vi.hoisted(() => ({
    deleteClineTask: vi.fn(async (_root: string, taskId: string) => ({
        deletedFiles: [`/cline/sessions/${taskId}`],
        deletedTaskIds: [taskId],
    })),
    listClineTasksForGroup: vi.fn(async () => [transcript.task]),
    listClineWorkspaceGroups: vi.fn(async () => [{ key: transcript.task.workspaceKey }]),
    readClineTaskTranscript: vi.fn(async () => transcript),
    resolveClineDataDir: vi.fn(() => '/cline'),
}));

vi.mock('@spiracha/lib/cline-db', () => dbMocks);
vi.mock('@spiracha/lib/cline-transcript', () => ({ renderClineTranscript: vi.fn(() => '# Cline task\n') }));
vi.mock('@spiracha/lib/transcript-load-limiter', () => ({
    runWithTranscriptLoadLimit: vi.fn(async (loader: () => Promise<unknown>) => loader()),
}));

import {
    deleteClineTaskFn,
    deleteClineTasksFn,
    exportClineTaskFn,
    exportClineTasksFn,
    getClineTaskDetailFn,
    listClineTasksFn,
    listClineWorkspacesFn,
} from './cline-server';

describe('Cline server functions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dbMocks.readClineTaskTranscript.mockResolvedValue(transcript);
        dbMocks.resolveClineDataDir.mockReturnValue('/cline');
    });

    it('should list workspaces, tasks, and task detail', async () => {
        await expect(listClineWorkspacesFn()).resolves.toEqual([{ key: transcript.task.workspaceKey }]);
        await expect(listClineTasksFn({ data: { workspaceKey: transcript.task.workspaceKey } })).resolves.toEqual([
            transcript.task,
        ]);
        await expect(getClineTaskDetailFn({ data: { taskId: '1' } })).resolves.toEqual(transcript);
    });

    it('should export one chat or a zip of selected chats', async () => {
        const single = await exportClineTaskFn({
            data: {
                includeCommentary: true,
                includeMetadata: true,
                includeTools: true,
                outputFormat: 'md',
                taskId: '1',
                zipArchive: false,
            },
        });
        expect(single).toMatchObject({ content: '# Cline task\n', mode: 'download' });

        const batch = await exportClineTasksFn({
            data: {
                includeCommentary: true,
                includeMetadata: true,
                includeTools: true,
                outputFormat: 'md',
                taskIds: ['1', '2'],
            },
        });
        expect(batch).toMatchObject({ mode: 'url' });
    });

    it('should delete one or multiple Cline chats', async () => {
        await expect(deleteClineTaskFn({ data: { taskId: '1' } })).resolves.toMatchObject({ deletedTaskIds: ['1'] });
        await expect(
            deleteClineTasksFn({ data: { taskIds: ['1786163719044_tpg1r', '1786164800606_0h9tk'] } }),
        ).resolves.toMatchObject({
            deletedTaskIds: ['1786163719044_tpg1r', '1786164800606_0h9tk'],
        });
    });
});
