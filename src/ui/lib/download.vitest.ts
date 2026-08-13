import { describe, expect, it, vi } from 'vitest';
import { downloadTextFile, downloadUrlFile, waitForDownloadUrlAvailability } from './download';

describe('downloadUrlFile', () => {
    it('should retry the download url until it becomes available before clicking the anchor', async () => {
        const fetchImpl = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(null, { status: 404 }))
            .mockResolvedValueOnce(new Response(null, { status: 404 }))
            .mockResolvedValueOnce(new Response(null, { status: 200 }));
        const anchorClick = vi.fn();
        const append = vi.fn();
        const remove = vi.fn();
        const documentRef = {
            body: { append },
            createElement: vi.fn(() => ({
                click: anchorClick,
                download: '',
                href: '',
                remove,
            })),
        } as unknown as Document;
        const logger = {
            error: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
        };
        const sleep = vi.fn(async () => {});

        await downloadUrlFile('export.zip', '/__exports/export.zip', {
            documentRef,
            fetchImpl,
            logger,
            sleep,
        });

        expect(fetchImpl).toHaveBeenCalledTimes(3);
        expect(anchorClick).toHaveBeenCalledTimes(1);
        expect(sleep).toHaveBeenCalledTimes(2);
    });

    it('should delay inline blob url revocation until after the download is triggered', () => {
        const anchorClick = vi.fn();
        const append = vi.fn();
        const remove = vi.fn();
        const documentRef = {
            body: { append },
            createElement: vi.fn(() => ({
                click: anchorClick,
                download: '',
                href: '',
                remove,
            })),
        } as unknown as Document;
        const createObjectUrl = vi.fn(() => 'blob:spiracha-export');
        const revokeObjectUrl = vi.fn();
        const schedule = vi.fn();

        downloadTextFile('export.md', '# content', 'text/markdown; charset=utf-8', {
            createObjectUrl,
            documentRef,
            revokeObjectUrl,
            schedule,
        });

        expect(anchorClick).toHaveBeenCalledTimes(1);
        expect(revokeObjectUrl).not.toHaveBeenCalled();
        expect(schedule).toHaveBeenCalledTimes(1);
        expect(schedule).toHaveBeenCalledWith(expect.any(Function), 30000);
    });

    it('should treat HEAD 405 responses as ready and throw after exhausting retries', async () => {
        await expect(
            waitForDownloadUrlAvailability('/__exports/export.zip', 'export.zip', {
                fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 405 })),
                logger: {
                    error: vi.fn(),
                    info: vi.fn(),
                    warn: vi.fn(),
                },
            }),
        ).resolves.toBeUndefined();

        await expect(
            waitForDownloadUrlAvailability('/__exports/missing.zip', 'missing.zip', {
                fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })),
                logger: {
                    error: vi.fn(),
                    info: vi.fn(),
                    warn: vi.fn(),
                },
                maxAttempts: 2,
                sleep: vi.fn(async () => {}),
            }),
        ).rejects.toThrow('Download file was not available after 2 attempts: missing.zip');
    });
});
