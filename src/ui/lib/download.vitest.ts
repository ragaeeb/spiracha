import { describe, expect, it, vi } from 'vitest';
import {
    createDownloadCancellation,
    DownloadCancelledError,
    downloadTextFile,
    downloadUrlFile,
    waitForDownloadUrlAvailability,
} from './download';

describe('downloadUrlFile', () => {
    it('should cancel the active download when its owner unmounts', () => {
        const cancellation = createDownloadCancellation();
        const signal = cancellation.begin();

        cancellation.cancel();

        expect(signal.aborted).toBe(true);
    });

    it('should leave a replacement download active when an older one finishes', () => {
        const cancellation = createDownloadCancellation();
        const firstSignal = cancellation.begin();
        const secondSignal = cancellation.begin();

        cancellation.finish(firstSignal);

        expect(firstSignal.aborted).toBe(true);
        expect(secondSignal.aborted).toBe(false);
        cancellation.cancel();
        expect(secondSignal.aborted).toBe(true);
    });

    it('should remember cancellation until the owner explicitly resets it', () => {
        const cancellation = createDownloadCancellation();

        cancellation.cancel();
        const cancelledSignal = cancellation.begin();
        cancellation.reset();
        const activeSignal = cancellation.begin();

        expect(cancelledSignal.aborted).toBe(true);
        expect(activeSignal.aborted).toBe(false);
    });

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

    it('should fail fast for permanent HTTP probe failures', async () => {
        const sleep = vi.fn(async () => {});

        await expect(
            waitForDownloadUrlAvailability('/__exports/failed.zip', 'failed.zip', {
                fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 })),
                logger: {
                    error: vi.fn(),
                    info: vi.fn(),
                    warn: vi.fn(),
                },
                maxAttempts: 3,
                sleep,
            }),
        ).rejects.toThrow('Download URL probe failed with HTTP 500');

        expect(sleep).not.toHaveBeenCalled();
    });

    it('should abort a pending HEAD fetch without probing again or creating an anchor', async () => {
        const controller = new AbortController();
        const fetchImpl = vi.fn<typeof fetch>();
        fetchImpl.mockReturnValue(new Promise<Response>(() => {}));
        const anchorClick = vi.fn();
        const documentRef = {
            body: { append: vi.fn() },
            createElement: vi.fn(() => ({
                click: anchorClick,
                download: '',
                href: '',
                remove: vi.fn(),
            })),
        } as unknown as Document;

        const download = downloadUrlFile('export.zip', '/__exports/export.zip', {
            documentRef,
            fetchImpl,
            maxAttempts: 3,
            signal: controller.signal,
        });
        controller.abort();

        await expect(download).rejects.toBeInstanceOf(DownloadCancelledError);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl).toHaveBeenCalledWith('/__exports/export.zip', {
            cache: 'no-store',
            method: 'HEAD',
            signal: controller.signal,
        });
        expect(anchorClick).not.toHaveBeenCalled();
    });

    it('should abort during retry backoff without probing again or creating an anchor', async () => {
        const controller = new AbortController();
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
        const sleep = vi.fn(() => new Promise<void>(() => {}));
        const anchorClick = vi.fn();
        const documentRef = {
            body: { append: vi.fn() },
            createElement: vi.fn(() => ({
                click: anchorClick,
                download: '',
                href: '',
                remove: vi.fn(),
            })),
        } as unknown as Document;

        const download = downloadUrlFile('export.zip', '/__exports/export.zip', {
            documentRef,
            fetchImpl,
            maxAttempts: 3,
            signal: controller.signal,
            sleep,
        });
        await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(1));
        controller.abort();

        await expect(download).rejects.toBeInstanceOf(DownloadCancelledError);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(anchorClick).not.toHaveBeenCalled();
    });

    it('should report the observable download lifecycle in order', async () => {
        const states: string[] = [];
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));

        await downloadUrlFile('export.zip', '/__exports/export.zip', {
            documentRef: {
                body: { append: vi.fn() },
                createElement: vi.fn(() => ({
                    click: vi.fn(),
                    download: '',
                    href: '',
                    remove: vi.fn(),
                })),
            } as unknown as Document,
            fetchImpl,
            onStateChange: (state) => states.push(state),
        });

        expect(states).toEqual(['preparing', 'ready', 'downloading']);
    });

    it('should report cancellation instead of downloading when aborted during backoff', async () => {
        const controller = new AbortController();
        const states: string[] = [];
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
        const sleep = vi.fn(() => new Promise<void>(() => {}));

        const download = downloadUrlFile('export.zip', '/__exports/export.zip', {
            fetchImpl,
            maxAttempts: 2,
            onStateChange: (state) => states.push(state),
            signal: controller.signal,
            sleep,
        });
        await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(1));
        controller.abort();

        await expect(download).rejects.toBeInstanceOf(DownloadCancelledError);
        expect(states).toEqual(['preparing', 'cancelled']);
    });
});
