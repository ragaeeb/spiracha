import { describe, expect, it, vi } from 'vitest';
import { createCodexThreadLiveHub } from './codex-thread-live-hub';
import { createCodexThreadLiveStreamUrl } from './codex-thread-live-url';

class FakePort {
    readonly messages: unknown[] = [];
    private readonly listeners = new Set<(event: MessageEvent) => void>();

    addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
        this.listeners.add(listener);
    }

    emit(data: unknown) {
        for (const listener of this.listeners) {
            listener(new MessageEvent('message', { data }));
        }
    }

    postMessage(message: unknown) {
        this.messages.push(message);
    }

    removeEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
        this.listeners.delete(listener);
    }

    start() {}
}

class FakeEventSource {
    readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();
    readonly url: string;
    closed = false;
    onerror: (() => void) | null = null;
    onopen: (() => void) | null = null;

    constructor(url: string) {
        this.url = url;
    }

    addEventListener(type: string, listener: (event: MessageEvent) => void) {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    close() {
        this.closed = true;
    }

    emit(type: string, data: string) {
        for (const listener of this.listeners.get(type) ?? []) {
            listener(new MessageEvent(type, { data }));
        }
    }
}

describe('createCodexThreadLiveHub', () => {
    it('should isolate the event stream on the alternate loopback origin', () => {
        expect(createCodexThreadLiveStreamUrl(['thread 1'], 'http://127.0.0.1:3000/threads/1')).toBe(
            'http://localhost:3000/api/v1/codex/threads/events?threadId=thread+1',
        );
        expect(createCodexThreadLiveStreamUrl(['thread-2'], 'http://localhost:3000/threads/2')).toBe(
            'http://127.0.0.1:3000/api/v1/codex/threads/events?threadId=thread-2',
        );
    });

    it('should multiplex every tab through one active event stream', () => {
        const sources: FakeEventSource[] = [];
        const hub = createCodexThreadLiveHub({
            createEventSource: (url) => {
                const source = new FakeEventSource(url);
                sources.push(source);
                return source;
            },
            createStreamUrl: (threadIds) => `/events?${threadIds.join(',')}`,
            scheduleLeaseExpiry: vi.fn(() => () => {}),
        });
        const firstPort = new FakePort();
        const secondPort = new FakePort();

        hub.connect(firstPort);
        hub.connect(secondPort);
        firstPort.emit({ threadId: 'thread-1', type: 'subscribe' });
        secondPort.emit({ threadId: 'thread-2', type: 'subscribe' });

        expect(sources).toHaveLength(2);
        expect(sources[0]?.closed).toBe(true);
        expect(sources[1]).toMatchObject({ closed: false, url: '/events?thread-1,thread-2' });
        expect(sources.filter((source) => !source.closed)).toHaveLength(1);

        sources[1]?.emit('transcript-changed', JSON.stringify({ revision: 1, threadId: 'thread-2' }));
        expect(firstPort.messages).not.toContainEqual(expect.objectContaining({ type: 'transcript-changed' }));
        expect(secondPort.messages).toContainEqual({ threadId: 'thread-2', type: 'transcript-changed' });

        firstPort.emit({ type: 'disconnect' });
        expect(sources[1]?.closed).toBe(true);
        expect(sources[2]).toMatchObject({ closed: false, url: '/events?thread-2' });
        secondPort.emit({ type: 'disconnect' });
        expect(sources[2]?.closed).toBe(true);
        expect(sources.filter((source) => !source.closed)).toHaveLength(0);
    });

    it('should release an abandoned port when its lease expires', () => {
        const sources: FakeEventSource[] = [];
        let expireLease = () => {};
        const hub = createCodexThreadLiveHub({
            createEventSource: (url) => {
                const source = new FakeEventSource(url);
                sources.push(source);
                return source;
            },
            createStreamUrl: (threadIds) => `/events?${threadIds.join(',')}`,
            scheduleLeaseExpiry: (callback) => {
                expireLease = callback;
                return () => {};
            },
        });
        const port = new FakePort();

        hub.connect(port);
        port.emit({ threadId: 'thread-1', type: 'subscribe' });
        expireLease();

        expect(sources[0]?.closed).toBe(true);
        port.emit({ threadId: 'thread-2', type: 'subscribe' });
        expect(sources).toHaveLength(1);
    });
});
