const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '[::1]', 'localhost']);

export const isLocalLoopbackHostname = (hostname: string): boolean => {
    return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
};

export const isAllowedLocalRequestOrigin = (requestUrlValue: string, origin: string | null) => {
    try {
        const requestUrl = new URL(requestUrlValue);
        if (!isLocalLoopbackHostname(requestUrl.hostname)) {
            return false;
        }
        if (origin === null) {
            return true;
        }
        if (origin === 'null') {
            return false;
        }

        const suppliedOrigin = new URL(origin);
        return suppliedOrigin.origin === requestUrl.origin && suppliedOrigin.origin === origin;
    } catch {
        return false;
    }
};
