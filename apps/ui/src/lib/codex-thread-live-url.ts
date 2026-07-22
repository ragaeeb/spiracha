export const createCodexThreadLiveStreamUrl = (threadIds: readonly string[], baseUrl = globalThis.location.href) => {
    const url = new URL('/api/v1/codex/threads/events', baseUrl);
    if (url.hostname === 'localhost') {
        url.hostname = '127.0.0.1';
    } else if (url.hostname === '127.0.0.1' || url.hostname === '[::1]') {
        url.hostname = 'localhost';
    }
    for (const threadId of threadIds) {
        url.searchParams.append('threadId', threadId);
    }
    return url.href;
};
