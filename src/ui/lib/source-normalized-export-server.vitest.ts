import { beforeEach, describe, expect, it, vi } from 'vitest';

const { buildNormalizedConversationJsonMock, renderRawConversationDownloadsMock } = vi.hoisted(() => ({
    buildNormalizedConversationJsonMock: vi.fn(),
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

vi.mock('@spiracha/lib/conversation-data/normalized-json-export', () => ({
    buildNormalizedConversationJson: buildNormalizedConversationJsonMock,
}));

vi.mock('./source-session-export-server', () => ({
    renderRawConversationDownloads: renderRawConversationDownloadsMock,
}));

import { exportNormalizedConversationsFn } from './source-normalized-export-server';

describe('source normalized export server', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        buildNormalizedConversationJsonMock.mockImplementation(async ({ id }: { id: string }) => `{"id":"${id}"}`);
        renderRawConversationDownloadsMock.mockResolvedValue({ fileName: 'x.json', mode: 'download_base64' });
    });

    it('should render each selected conversation as a JSON file through the shared exporter', async () => {
        await exportNormalizedConversationsFn({
            data: { ids: ['ses_1', 'ses_2'], source: 'opencode', zipArchive: true, zipPassword: 'pw' },
        });

        expect(renderRawConversationDownloadsMock).toHaveBeenCalledWith({
            downloads: [
                {
                    download: expect.objectContaining({
                        fileName: 'opencode-ses_1.json',
                        mimeType: 'application/json',
                    }),
                    id: 'ses_1',
                },
                {
                    download: expect.objectContaining({
                        fileName: 'opencode-ses_2.json',
                        mimeType: 'application/json',
                    }),
                    id: 'ses_2',
                },
            ],
            source: 'opencode',
            variant: 'normalized',
            zipArchive: true,
            zipPassword: 'pw',
        });
        const [{ downloads }] = renderRawConversationDownloadsMock.mock.calls[0] as [
            { downloads: Array<{ download: { blob: Blob } }> },
        ];
        await expect(downloads[0]?.download.blob.text()).resolves.toBe('{"id":"ses_1"}');
    });

    it('should fail clearly when a selected conversation no longer exists', async () => {
        buildNormalizedConversationJsonMock.mockResolvedValueOnce(null);

        await expect(
            exportNormalizedConversationsFn({ data: { ids: ['ses_gone'], source: 'opencode' } }),
        ).rejects.toThrow('No conversation exists for opencode ses_gone.');
        expect(renderRawConversationDownloadsMock).not.toHaveBeenCalled();
    });
});
