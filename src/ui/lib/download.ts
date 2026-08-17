import { useEffect, useRef } from 'react';

type DownloadLogger = Pick<Console, 'error' | 'info' | 'warn'>;

export type DownloadLifecycleState = 'preparing' | 'ready' | 'downloading' | 'failed' | 'cancelled';

export class DownloadCancelledError extends Error {
    constructor() {
        super('Download cancelled');
        this.name = 'DownloadCancelledError';
    }
}

export class DownloadAvailabilityError extends Error {
    readonly status: number;

    constructor(status: number) {
        super(`Download URL probe failed with HTTP ${status}`);
        this.name = 'DownloadAvailabilityError';
        this.status = status;
    }
}

type DownloadTextOptions = {
    createObjectUrl?: (blob: Blob) => string;
    documentRef?: Document;
    logger?: DownloadLogger;
    onStateChange?: (state: DownloadLifecycleState) => void;
    revokeDelayMs?: number;
    revokeObjectUrl?: (url: string) => void;
    schedule?: (callback: () => void, delayMs: number) => void;
};

type DownloadUrlOptions = {
    documentRef?: Document;
    fetchImpl?: typeof fetch;
    logger?: DownloadLogger;
    maxAttempts?: number;
    onStateChange?: (state: DownloadLifecycleState) => void;
    retryDelayMs?: number;
    signal?: AbortSignal;
    sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
};

export type DownloadCancellation = {
    begin: () => AbortSignal;
    cancel: () => void;
    finish: (signal: AbortSignal) => void;
    reset: () => void;
};

const DOWNLOAD_CANCEL_EVENT = 'spiracha:cancel-active-downloads';
const DOWNLOAD_RESET_EVENT = 'spiracha:reset-active-downloads';

const DEFAULT_DOWNLOAD_ATTEMPTS = 6;
const DEFAULT_DOWNLOAD_RETRY_DELAY_MS = 250;
const DEFAULT_INLINE_REVOKE_DELAY_MS = 30000;

const logDownloadEvent = (
    logger: DownloadLogger,
    level: keyof DownloadLogger,
    event: string,
    details: Record<string, unknown>,
) => {
    logger[level](`[spiracha:download] ${event}`, details);
};

const throwIfAborted = (signal?: AbortSignal) => {
    if (signal?.aborted) {
        throw new DownloadCancelledError();
    }
};

const raceWithAbort = async <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
    throwIfAborted(signal);
    if (!signal) {
        return promise;
    }

    let onAbort: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
        onAbort = () => reject(new DownloadCancelledError());
        signal.addEventListener('abort', onAbort, { once: true });
    });

    try {
        return await Promise.race([promise, abortPromise]);
    } finally {
        if (onAbort) {
            signal.removeEventListener('abort', onAbort);
        }
    }
};

const delay = (delayMs: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
        let timeoutId: number | undefined;
        const onAbort = () => {
            if (timeoutId !== undefined) {
                window.clearTimeout(timeoutId);
            }
            signal?.removeEventListener('abort', onAbort);
            reject(new DownloadCancelledError());
        };

        timeoutId = window.setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, delayMs);

        if (signal?.aborted) {
            onAbort();
        } else {
            signal?.addEventListener('abort', onAbort, { once: true });
        }
    });

const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError';

const asCancellationError = (error: unknown, signal?: AbortSignal) => {
    if (error instanceof DownloadCancelledError || signal?.aborted || isAbortError(error)) {
        return error instanceof DownloadCancelledError ? error : new DownloadCancelledError();
    }
    return null;
};

const triggerAnchorDownload = (documentRef: Document, href: string, fileName: string) => {
    const link = documentRef.createElement('a');
    link.href = href;
    link.download = fileName;
    documentRef.body.append(link);
    link.click();
    link.remove();
};

const isReadyStatus = (status: number) => {
    return (status >= 200 && status < 400) || status === 405;
};

export const createDownloadCancellation = (): DownloadCancellation => {
    let activeController: AbortController | null = null;
    let cancellationRequested = false;

    return {
        begin: () => {
            activeController?.abort();
            activeController = new AbortController();
            if (cancellationRequested) {
                activeController.abort();
            }
            return activeController.signal;
        },
        cancel: () => {
            cancellationRequested = true;
            activeController?.abort();
            activeController = null;
        },
        finish: (signal) => {
            if (activeController?.signal === signal) {
                activeController = null;
            }
        },
        reset: () => {
            cancellationRequested = false;
        },
    };
};

export const useDownloadCancellation = () => {
    const cancellationRef = useRef<DownloadCancellation | null>(null);
    if (!cancellationRef.current) {
        cancellationRef.current = createDownloadCancellation();
    }

    const cancellation = cancellationRef.current;
    useEffect(() => {
        const cancelActiveDownload = () => cancellation.cancel();
        const resetActiveDownload = () => cancellation.reset();
        window.addEventListener(DOWNLOAD_CANCEL_EVENT, cancelActiveDownload);
        window.addEventListener(DOWNLOAD_RESET_EVENT, resetActiveDownload);
        return () => {
            window.removeEventListener(DOWNLOAD_CANCEL_EVENT, cancelActiveDownload);
            window.removeEventListener(DOWNLOAD_RESET_EVENT, resetActiveDownload);
            cancellation.cancel();
        };
    }, [cancellation]);

    return cancellation;
};

export const cancelActiveDownloads = () => {
    window.dispatchEvent(new Event(DOWNLOAD_CANCEL_EVENT));
};

export const resetActiveDownloads = () => {
    window.dispatchEvent(new Event(DOWNLOAD_RESET_EVENT));
};

const probeDownloadUrl = async (
    downloadUrl: string,
    fileName: string,
    {
        attempt,
        fetchImpl = fetch,
        logger = console,
        signal,
    }: Pick<DownloadUrlOptions, 'fetchImpl' | 'logger' | 'signal'> & { attempt: number },
) => {
    const requestInit: RequestInit = {
        cache: 'no-store',
        method: 'HEAD',
    };
    if (signal) {
        requestInit.signal = signal;
    }

    try {
        const response = await raceWithAbort(fetchImpl(downloadUrl, requestInit), signal);
        if (isReadyStatus(response.status)) {
            logDownloadEvent(logger, 'info', 'url_ready', {
                attempt,
                downloadUrl,
                fileName,
                status: response.status,
            });
            return true;
        }

        if (response.status !== 404) {
            throw new DownloadAvailabilityError(response.status);
        }

        logDownloadEvent(logger, 'warn', 'url_not_ready', {
            attempt,
            downloadUrl,
            fileName,
            status: response.status,
        });
        return false;
    } catch (error) {
        const cancellationError = asCancellationError(error, signal);
        if (cancellationError) {
            throw cancellationError;
        }

        if (error instanceof DownloadAvailabilityError) {
            throw error;
        }

        logDownloadEvent(logger, 'warn', 'url_probe_failed', {
            attempt,
            downloadUrl,
            error: error instanceof Error ? error.message : String(error),
            fileName,
        });
        return false;
    }
};

export const waitForDownloadUrlAvailability = async (
    downloadUrl: string,
    fileName: string,
    {
        fetchImpl = fetch,
        logger = console,
        maxAttempts = DEFAULT_DOWNLOAD_ATTEMPTS,
        retryDelayMs = DEFAULT_DOWNLOAD_RETRY_DELAY_MS,
        signal,
        sleep = delay,
    }: Omit<DownloadUrlOptions, 'documentRef'> = {},
) => {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        throwIfAborted(signal);
        const ready = await probeDownloadUrl(downloadUrl, fileName, { attempt, fetchImpl, logger, signal });
        if (ready) {
            return;
        }

        if (attempt < maxAttempts) {
            throwIfAborted(signal);
            const sleepPromise = signal ? sleep(retryDelayMs, signal) : sleep(retryDelayMs);
            await raceWithAbort(sleepPromise, signal);
        }
    }

    throw new Error(`Download file was not available after ${maxAttempts} attempts: ${fileName}`);
};

export const downloadUrlFile = async (
    fileName: string,
    downloadUrl: string,
    {
        documentRef = document,
        fetchImpl = fetch,
        logger = console,
        maxAttempts = DEFAULT_DOWNLOAD_ATTEMPTS,
        onStateChange,
        retryDelayMs = DEFAULT_DOWNLOAD_RETRY_DELAY_MS,
        signal,
        sleep = delay,
    }: DownloadUrlOptions = {},
) => {
    logDownloadEvent(logger, 'info', 'start', {
        downloadUrl,
        fileName,
    });

    onStateChange?.('preparing');
    try {
        await waitForDownloadUrlAvailability(downloadUrl, fileName, {
            fetchImpl,
            logger,
            maxAttempts,
            retryDelayMs,
            signal,
            sleep,
        });
        throwIfAborted(signal);
        onStateChange?.('ready');
        throwIfAborted(signal);
        onStateChange?.('downloading');
        throwIfAborted(signal);
        triggerAnchorDownload(documentRef, downloadUrl, fileName);
        logDownloadEvent(logger, 'info', 'triggered', {
            downloadUrl,
            fileName,
        });
    } catch (error) {
        const cancellationError = asCancellationError(error, signal);
        onStateChange?.(cancellationError ? 'cancelled' : 'failed');
        throw cancellationError ?? error;
    }
};

export const downloadUrlFileWithCancellation = async (
    cancellation: DownloadCancellation,
    fileName: string,
    downloadUrl: string,
    options: Omit<DownloadUrlOptions, 'signal'> = {},
) => {
    const signal = cancellation.begin();
    try {
        return await downloadUrlFile(fileName, downloadUrl, { ...options, signal });
    } finally {
        cancellation.finish(signal);
    }
};

export const downloadTextFile = (
    fileName: string,
    content: string,
    mimeType: string,
    {
        createObjectUrl = (blob) => URL.createObjectURL(blob),
        documentRef = document,
        logger = console,
        onStateChange,
        revokeDelayMs = DEFAULT_INLINE_REVOKE_DELAY_MS,
        revokeObjectUrl = (url) => URL.revokeObjectURL(url),
        schedule = (callback, delayMs) => {
            window.setTimeout(callback, delayMs);
        },
    }: DownloadTextOptions = {},
) => {
    logDownloadEvent(logger, 'info', 'inline_start', {
        fileName,
        mimeType,
        sizeBytes: content.length,
    });

    try {
        const blob = new Blob([content], { type: mimeType });
        const url = createObjectUrl(blob);
        onStateChange?.('ready');
        onStateChange?.('downloading');
        triggerAnchorDownload(documentRef, url, fileName);
        schedule(() => revokeObjectUrl(url), revokeDelayMs);

        logDownloadEvent(logger, 'info', 'inline_triggered', {
            fileName,
            mimeType,
            sizeBytes: content.length,
        });
    } catch (error) {
        onStateChange?.('failed');
        throw error;
    }
};
