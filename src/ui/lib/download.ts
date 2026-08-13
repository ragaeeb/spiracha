type DownloadLogger = Pick<Console, 'error' | 'info' | 'warn'>;

type DownloadTextOptions = {
    createObjectUrl?: (blob: Blob) => string;
    documentRef?: Document;
    logger?: DownloadLogger;
    revokeDelayMs?: number;
    revokeObjectUrl?: (url: string) => void;
    schedule?: (callback: () => void, delayMs: number) => void;
};

type DownloadUrlOptions = {
    documentRef?: Document;
    fetchImpl?: typeof fetch;
    logger?: DownloadLogger;
    maxAttempts?: number;
    retryDelayMs?: number;
    sleep?: (delayMs: number) => Promise<void>;
};

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

const delay = (delayMs: number) =>
    new Promise<void>((resolve) => {
        window.setTimeout(resolve, delayMs);
    });

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

export const waitForDownloadUrlAvailability = async (
    downloadUrl: string,
    fileName: string,
    {
        fetchImpl = fetch,
        logger = console,
        maxAttempts = DEFAULT_DOWNLOAD_ATTEMPTS,
        retryDelayMs = DEFAULT_DOWNLOAD_RETRY_DELAY_MS,
        sleep = delay,
    }: Omit<DownloadUrlOptions, 'documentRef'> = {},
) => {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const response = await fetchImpl(downloadUrl, {
                cache: 'no-store',
                method: 'HEAD',
            });

            if (isReadyStatus(response.status)) {
                logDownloadEvent(logger, 'info', 'url_ready', {
                    attempt,
                    downloadUrl,
                    fileName,
                    status: response.status,
                });
                return;
            }

            logDownloadEvent(logger, 'warn', 'url_not_ready', {
                attempt,
                downloadUrl,
                fileName,
                status: response.status,
            });
        } catch (error) {
            logDownloadEvent(logger, 'warn', 'url_probe_failed', {
                attempt,
                downloadUrl,
                error: error instanceof Error ? error.message : String(error),
                fileName,
            });
        }

        if (attempt < maxAttempts) {
            await sleep(retryDelayMs);
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
        retryDelayMs = DEFAULT_DOWNLOAD_RETRY_DELAY_MS,
        sleep = delay,
    }: DownloadUrlOptions = {},
) => {
    logDownloadEvent(logger, 'info', 'start', {
        downloadUrl,
        fileName,
    });

    await waitForDownloadUrlAvailability(downloadUrl, fileName, {
        fetchImpl,
        logger,
        maxAttempts,
        retryDelayMs,
        sleep,
    });

    triggerAnchorDownload(documentRef, downloadUrl, fileName);
    logDownloadEvent(logger, 'info', 'triggered', {
        downloadUrl,
        fileName,
    });
};

export const downloadTextFile = (
    fileName: string,
    content: string,
    mimeType: string,
    {
        createObjectUrl = (blob) => URL.createObjectURL(blob),
        documentRef = document,
        logger = console,
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

    const blob = new Blob([content], { type: mimeType });
    const url = createObjectUrl(blob);
    triggerAnchorDownload(documentRef, url, fileName);
    schedule(() => revokeObjectUrl(url), revokeDelayMs);

    logDownloadEvent(logger, 'info', 'inline_triggered', {
        fileName,
        mimeType,
        sizeBytes: content.length,
    });
};
