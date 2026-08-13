const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '[::1]', 'localhost']);

export const isAllowedCodexThreadEventOrigin = (requestUrlValue: string, origin: string | null) => {
    if (!origin) {
        return true;
    }

    try {
        const requestUrl = new URL(requestUrlValue);
        const originUrl = new URL(origin);
        return (
            originUrl.origin === requestUrl.origin ||
            (originUrl.protocol === requestUrl.protocol &&
                originUrl.port === requestUrl.port &&
                LOOPBACK_HOSTNAMES.has(originUrl.hostname) &&
                LOOPBACK_HOSTNAMES.has(requestUrl.hostname))
        );
    } catch {
        return false;
    }
};
