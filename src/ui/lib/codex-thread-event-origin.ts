import { isLocalLoopbackHostname } from '@spiracha/lib/local-request-security';

const getCodexThreadEventOriginDecision = (requestUrlValue: string, origin: string | null) => {
    try {
        const requestUrl = new URL(requestUrlValue);
        if (!isLocalLoopbackHostname(requestUrl.hostname)) {
            return { allowed: false, corsOrigin: null };
        }
        if (origin === null) {
            return { allowed: true, corsOrigin: null };
        }
        if (origin === 'null') {
            return { allowed: false, corsOrigin: null };
        }

        const originUrl = new URL(origin);
        if (originUrl.origin !== origin) {
            return { allowed: false, corsOrigin: null };
        }
        if (originUrl.origin === requestUrl.origin) {
            return { allowed: true, corsOrigin: null };
        }

        const sameLoopbackOrigin =
            originUrl.protocol === requestUrl.protocol &&
            originUrl.port === requestUrl.port &&
            isLocalLoopbackHostname(originUrl.hostname);
        return sameLoopbackOrigin ? { allowed: true, corsOrigin: origin } : { allowed: false, corsOrigin: null };
    } catch {
        return { allowed: false, corsOrigin: null };
    }
};

export const isAllowedCodexThreadEventOrigin = (requestUrlValue: string, origin: string | null) => {
    return getCodexThreadEventOriginDecision(requestUrlValue, origin).allowed;
};

export const getCodexThreadEventCorsOrigin = (requestUrlValue: string, origin: string | null) => {
    return getCodexThreadEventOriginDecision(requestUrlValue, origin).corsOrigin;
};
