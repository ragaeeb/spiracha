import type { CodexThreadLiveStatus } from './codex-thread-live-types';
import { createCodexThreadLiveStreamUrl } from './codex-thread-live-url';

const LIVE_HEARTBEAT_INTERVAL_MS = 15_000;

type QueryInvalidator = {
    invalidateQueries: (filters: { queryKey: readonly unknown[] }) => Promise<unknown>;
};

type ConnectCodexThreadLiveUpdatesOptions = {
    onStatusChange: (status: CodexThreadLiveStatus) => void;
    onTranscriptChange: () => void;
    threadId: string;
};

export const connectCodexThreadLiveUpdates = ({
    onStatusChange,
    onTranscriptChange,
    threadId,
}: ConnectCodexThreadLiveUpdatesOptions) => {
    onStatusChange('connecting');
    if (typeof SharedWorker === 'undefined') {
        const source = new EventSource(createCodexThreadLiveStreamUrl([threadId]));
        source.onopen = () => onStatusChange('connected');
        source.onerror = () => onStatusChange('reconnecting');
        source.addEventListener('transcript-changed', onTranscriptChange);
        return () => source.close();
    }

    const worker = new SharedWorker(new URL('./codex-thread-live.worker.ts', import.meta.url), {
        name: 'spiracha-codex-thread-live-v1',
        type: 'module',
    });
    const onMessage = (event: MessageEvent) => {
        const message: unknown = event.data;
        if (!message || typeof message !== 'object' || !('type' in message)) {
            return;
        }
        if (
            message.type === 'status' &&
            'status' in message &&
            (message.status === 'connected' || message.status === 'connecting' || message.status === 'reconnecting')
        ) {
            onStatusChange(message.status);
            return;
        }
        if (message.type === 'transcript-changed' && 'threadId' in message && message.threadId === threadId) {
            onTranscriptChange();
        }
    };
    worker.port.addEventListener('message', onMessage);
    worker.port.start();
    worker.port.postMessage({ threadId, type: 'subscribe' });
    const heartbeat = setInterval(() => worker.port.postMessage({ type: 'heartbeat' }), LIVE_HEARTBEAT_INTERVAL_MS);
    let disconnected = false;

    return () => {
        if (disconnected) {
            return;
        }
        disconnected = true;
        clearInterval(heartbeat);
        worker.port.postMessage({ type: 'disconnect' });
        worker.port.removeEventListener('message', onMessage);
        worker.port.close();
    };
};

export const refreshCodexThreadLiveQueries = async (queryClient: QueryInvalidator, threadId: string) => {
    await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['thread', threadId] }),
        queryClient.invalidateQueries({ queryKey: ['thread-transcript-preview', threadId] }),
        queryClient.invalidateQueries({ queryKey: ['thread-transcript', threadId] }),
    ]);
};
