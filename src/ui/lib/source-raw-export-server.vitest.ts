import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getConversationRawMock, renderRawConversationDownloadsMock } = vi.hoisted(() => ({
    getConversationRawMock: vi.fn(),
    renderRawConversationDownloadsMock: vi.fn(),
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

vi.mock('@spiracha/lib/conversation-data', () => ({
    getConversationRaw: getConversationRawMock,
}));

vi.mock('./source-session-export-server', () => ({
    renderRawConversationDownloads: renderRawConversationDownloadsMock,
}));

import { exportRawConversationsFn } from './source-raw-export-server';

describe('source raw export server', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getConversationRawMock.mockImplementation(async ({ id }: { id: string }) => ({
            blob: new Blob([`{"id":"${id}"}`]),
            fileName: 'messages.jsonl',
            mimeType: 'application/x-ndjson',
        }));
        renderRawConversationDownloadsMock.mockResolvedValue({
            downloadUrl: '/__exports/cline-raw.zip',
            fileName: 'cline-raw.zip',
            mimeType: 'application/zip',
            mode: 'download_url',
        });
    });

    it('should load selected raw conversations and render them through the shared exporter', async () => {
        await expect(
            exportRawConversationsFn({ data: { ids: ['task-1', 'task-2'], source: 'cline' } }),
        ).resolves.toMatchObject({ mode: 'download_url' });

        expect(getConversationRawMock).toHaveBeenNthCalledWith(1, { id: 'task-1', source: 'cline' });
        expect(getConversationRawMock).toHaveBeenNthCalledWith(2, { id: 'task-2', source: 'cline' });
        expect(renderRawConversationDownloadsMock).toHaveBeenCalledWith({
            downloads: [
                {
                    download: expect.objectContaining({ fileName: 'messages.jsonl' }),
                    id: 'task-1',
                },
                {
                    download: expect.objectContaining({ fileName: 'messages.jsonl' }),
                    id: 'task-2',
                },
            ],
            source: 'cline',
        });
    });
});
