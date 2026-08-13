import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectCodexThreadLiveUpdates, refreshCodexThreadLiveQueries } from './codex-thread-live';

class FakeMessagePort {
    readonly listeners = new Set<(event: MessageEvent) => void>();
    readonly messages: unknown[] = [];
    closed = false;

    addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
        this.listeners.add(listener);
    }

    close() {
        this.closed = true;
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

class FakeSharedWorker {
    static instances: FakeSharedWorker[] = [];
    readonly options: WorkerOptions;
    readonly port = new FakeMessagePort();
    readonly url: string;

    constructor(url: URL, options: WorkerOptions) {
        this.url = url.href;
        this.options = options;
        FakeSharedWorker.instances.push(this);
    }
}

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

    it('should subscribe through the shared worker and forward live state changes', () => {
        FakeSharedWorker.instances = [];
        vi.stubGlobal('SharedWorker', FakeSharedWorker);
        const onTranscriptChange = vi.fn();
        const onStatusChange = vi.fn();

        const disconnect = connectCodexThreadLiveUpdates({
            onStatusChange,
            onTranscriptChange,
            threadId: 'thread / 1',
        });
        const worker = FakeSharedWorker.instances[0]!;

        expect(worker.url).toContain('codex-thread-live.worker.ts');
        expect(worker.options).toEqual({ name: 'spiracha-codex-thread-live-v1', type: 'module' });
        expect(worker.port.messages).toEqual([{ threadId: 'thread / 1', type: 'subscribe' }]);
        expect(onStatusChange).toHaveBeenCalledWith('connecting');
        worker.port.emit({ status: 'connected', type: 'status' });
        expect(onStatusChange).toHaveBeenLastCalledWith('connected');
        worker.port.emit({ threadId: 'thread / 1', type: 'transcript-changed' });
        expect(onTranscriptChange).toHaveBeenCalledOnce();
        worker.port.emit({ status: 'reconnecting', type: 'status' });
        expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting');

        disconnect();
        expect(worker.port.messages).toContainEqual({ type: 'disconnect' });
        expect(worker.port.closed).toBe(true);
    });

    it('should keep live updates isolated from page connections when shared workers are unavailable', () => {
        FakeEventSource.instances = [];
        vi.stubGlobal('SharedWorker', undefined);
        vi.stubGlobal('EventSource', FakeEventSource);
        const onTranscriptChange = vi.fn();
        const onStatusChange = vi.fn();

        const disconnect = connectCodexThreadLiveUpdates({
            onStatusChange,
            onTranscriptChange,
            threadId: 'thread-1',
        });
        const source = FakeEventSource.instances[0]!;

        expect(new URL(source.url).pathname).toBe('/api/v1/codex/threads/events');
        expect(new URL(source.url).searchParams.getAll('threadId')).toEqual(['thread-1']);
        source.onopen?.(new Event('open'));
        expect(onStatusChange).toHaveBeenLastCalledWith('connected');
        source.emit('transcript-changed');
        expect(onTranscriptChange).toHaveBeenCalledOnce();

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
