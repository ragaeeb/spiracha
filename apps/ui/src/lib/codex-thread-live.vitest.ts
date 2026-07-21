import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectCodexThreadLiveUpdates, refreshCodexThreadLiveQueries } from './codex-thread-live';

class FakeEventSource {
    static instances: FakeEventSource[] = [];
    readonly listeners = new Map<string, Set<EventListener>>();
    readonly url: string;
    closed = false;
    onerror: ((event: Event) => unknown) | null = null;
    onopen: ((event: Event) => unknown) | null = null;

    constructor(url: string) {
        this.url = url;
        FakeEventSource.instances.push(this);
    }

    addEventListener(type: string, listener: EventListener) {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    close() {
        this.closed = true;
    }

    emit(type: string) {
        for (const listener of this.listeners.get(type) ?? []) {
            listener(new Event(type));
        }
    }
}

describe('connectCodexThreadLiveUpdates', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('should connect to the thread event stream and forward live state changes', () => {
        FakeEventSource.instances = [];
        vi.stubGlobal('EventSource', FakeEventSource);
        const onTranscriptChange = vi.fn();
        const onStatusChange = vi.fn();

        const disconnect = connectCodexThreadLiveUpdates({
            onStatusChange,
            onTranscriptChange,
            threadId: 'thread / 1',
        });
        const source = FakeEventSource.instances[0]!;

        expect(source.url).toBe('/api/v1/codex/threads/thread%20%2F%201/events');
        expect(onStatusChange).toHaveBeenCalledWith('connecting');
        source.onopen?.(new Event('open'));
        expect(onStatusChange).toHaveBeenLastCalledWith('connected');
        source.emit('transcript-changed');
        expect(onTranscriptChange).toHaveBeenCalledOnce();
        source.onerror?.(new Event('error'));
        expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting');

        disconnect();
        expect(source.closed).toBe(true);
    });

    it('should refresh every active representation of the changed thread', async () => {
        const invalidateQueries = vi.fn().mockResolvedValue(undefined);

        await refreshCodexThreadLiveQueries({ invalidateQueries }, 'thread-1');

        expect(invalidateQueries.mock.calls).toEqual([
            [{ queryKey: ['thread', 'thread-1'] }],
            [{ queryKey: ['thread-transcript-preview', 'thread-1'] }],
            [{ queryKey: ['thread-transcript', 'thread-1'] }],
        ]);
    });
});
