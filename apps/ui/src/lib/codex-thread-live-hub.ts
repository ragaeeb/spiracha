import type { CodexThreadLiveStatus } from './codex-thread-live-types';
import { createCodexThreadLiveStreamUrl } from './codex-thread-live-url';

const LIVE_CLIENT_LEASE_MS = 10 * 60_000;

type LiveHubMessage = { threadId: string; type: 'subscribe' } | { type: 'disconnect' } | { type: 'heartbeat' };

type LiveHubPort = {
    addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
    postMessage: (message: unknown) => void;
    removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
    start: () => void;
};

type LiveEventSource = {
    addEventListener: (type: 'transcript-changed', listener: (event: MessageEvent<string>) => void) => void;
    close: () => void;
    onerror: ((event: Event) => unknown) | null;
    onopen: ((event: Event) => unknown) | null;
};

type LiveClientState = {
    cancelLeaseExpiry: () => void;
    removeMessageListener: () => void;
    threadId: string | null;
};

type CreateCodexThreadLiveHubOptions = {
    createEventSource?: (url: string) => LiveEventSource;
    createStreamUrl?: (threadIds: readonly string[]) => string;
    scheduleLeaseExpiry?: (callback: () => void, delayMs: number) => () => void;
};

const scheduleLeaseExpiry = (callback: () => void, delayMs: number) => {
    const timeout = setTimeout(callback, delayMs);
    return () => clearTimeout(timeout);
};

const parseHubMessage = (value: unknown): LiveHubMessage | null => {
    if (!value || typeof value !== 'object' || !('type' in value)) {
        return null;
    }
    if (value.type === 'disconnect' || value.type === 'heartbeat') {
        return { type: value.type };
    }
    if (value.type === 'subscribe' && 'threadId' in value && typeof value.threadId === 'string') {
        const threadId = value.threadId.trim();
        return threadId ? { threadId, type: 'subscribe' } : null;
    }
    return null;
};

const parseTranscriptChange = (data: string) => {
    try {
        const value: unknown = JSON.parse(data);
        if (value && typeof value === 'object' && 'threadId' in value && typeof value.threadId === 'string') {
            return value.threadId;
        }
    } catch {
        return null;
    }
    return null;
};

export const createCodexThreadLiveHub = ({
    createEventSource: openEventSource = (url) => new EventSource(url),
    createStreamUrl: buildStreamUrl = createCodexThreadLiveStreamUrl,
    scheduleLeaseExpiry: scheduleExpiry = scheduleLeaseExpiry,
}: CreateCodexThreadLiveHubOptions = {}) => {
    const clients = new Map<LiveHubPort, LiveClientState>();
    let eventSource: LiveEventSource | null = null;
    let streamKey = '';
    let status: CodexThreadLiveStatus = 'connecting';

    const broadcastStatus = () => {
        for (const port of clients.keys()) {
            port.postMessage({ status, type: 'status' });
        }
    };

    const activeThreadIds = () =>
        [...new Set([...clients.values()].flatMap(({ threadId }) => (threadId ? [threadId] : [])))].sort();

    const replaceEventSource = () => {
        const threadIds = activeThreadIds();
        const nextStreamKey = threadIds.join('\n');
        if (nextStreamKey === streamKey) {
            return;
        }

        eventSource?.close();
        eventSource = null;
        streamKey = nextStreamKey;
        if (threadIds.length === 0) {
            return;
        }

        status = 'connecting';
        broadcastStatus();
        const source = openEventSource(buildStreamUrl(threadIds));
        eventSource = source;
        source.onopen = () => {
            if (eventSource === source) {
                status = 'connected';
                broadcastStatus();
            }
        };
        source.onerror = () => {
            if (eventSource === source) {
                status = 'reconnecting';
                broadcastStatus();
            }
        };
        source.addEventListener('transcript-changed', (event) => {
            if (eventSource !== source) {
                return;
            }
            const changedThreadId = parseTranscriptChange(event.data);
            if (!changedThreadId) {
                return;
            }
            for (const [port, client] of clients) {
                if (client.threadId === changedThreadId) {
                    port.postMessage({ threadId: changedThreadId, type: 'transcript-changed' });
                }
            }
        });
    };

    const removeClient = (port: LiveHubPort) => {
        const client = clients.get(port);
        if (!client) {
            return;
        }
        client.cancelLeaseExpiry();
        client.removeMessageListener();
        clients.delete(port);
        replaceEventSource();
    };

    const renewLease = (port: LiveHubPort, client: LiveClientState) => {
        client.cancelLeaseExpiry();
        client.cancelLeaseExpiry = scheduleExpiry(() => removeClient(port), LIVE_CLIENT_LEASE_MS);
    };

    const handleClientMessage = (port: LiveHubPort, client: LiveClientState, message: LiveHubMessage) => {
        if (message.type === 'disconnect') {
            removeClient(port);
            return;
        }
        if (message.type === 'subscribe') {
            const changed = client.threadId !== message.threadId;
            client.threadId = message.threadId;
            renewLease(port, client);
            if (changed) {
                replaceEventSource();
            } else {
                port.postMessage({ status, type: 'status' });
            }
            return;
        }
        if (client.threadId) {
            renewLease(port, client);
        }
    };

    const connect = (port: LiveHubPort) => {
        const client: LiveClientState = {
            cancelLeaseExpiry: () => {},
            removeMessageListener: () => {},
            threadId: null,
        };
        clients.set(port, client);
        const onMessage = (event: MessageEvent) => {
            const message = parseHubMessage(event.data);
            if (!message) {
                return;
            }
            handleClientMessage(port, client, message);
        };
        port.addEventListener('message', onMessage);
        client.removeMessageListener = () => port.removeEventListener('message', onMessage);
        port.start();
    };

    return { connect };
};
