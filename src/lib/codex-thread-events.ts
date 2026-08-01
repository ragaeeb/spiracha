import { unwatchFile, watchFile } from 'node:fs';

type WatchHandle = {
    close: () => void;
};

type WatchRolloutFile = (rolloutPath: string, onChange: () => void) => WatchHandle;

type RolloutListener = {
    onChange: () => void;
};

type RolloutSubscription = {
    listeners: Set<RolloutListener>;
    monitor: WatchHandle;
};

export type CodexThreadEventBroker = {
    subscribe: (rolloutPath: string, onChange: () => void) => () => void;
};

type CreateBrokerOptions = {
    watchRolloutFile?: WatchRolloutFile;
};

const watchRolloutFile: WatchRolloutFile = (rolloutPath, onChange) => {
    const listener = () => onChange();
    // Bun's fs.watch misses long-lived Codex appends on macOS, so share one bounded stat monitor per live rollout.
    watchFile(rolloutPath, { interval: 750, persistent: false }, listener);
    return {
        close: () => unwatchFile(rolloutPath, listener),
    };
};

export const createCodexThreadEventBroker = ({
    watchRolloutFile: createMonitor = watchRolloutFile,
}: CreateBrokerOptions = {}): CodexThreadEventBroker => {
    const subscriptions = new Map<string, RolloutSubscription>();

    return {
        subscribe: (rolloutPath, onChange) => {
            const listener = { onChange };
            const existing = subscriptions.get(rolloutPath);
            if (existing) {
                existing.listeners.add(listener);
                return () => {
                    existing.listeners.delete(listener);
                    if (existing.listeners.size === 0 && subscriptions.get(rolloutPath) === existing) {
                        subscriptions.delete(rolloutPath);
                        existing.monitor.close();
                    }
                };
            }

            const listeners = new Set([listener]);
            const subscription: RolloutSubscription = {
                listeners,
                monitor: createMonitor(rolloutPath, () => {
                    for (const listener of listeners) {
                        listener.onChange();
                    }
                }),
            };
            subscriptions.set(rolloutPath, subscription);

            return () => {
                listeners.delete(listener);
                if (listeners.size === 0 && subscriptions.get(rolloutPath) === subscription) {
                    subscriptions.delete(rolloutPath);
                    subscription.monitor.close();
                }
            };
        },
    };
};

const defaultBroker = createCodexThreadEventBroker();
const encoder = new TextEncoder();

type CreateEventResponseOptions = {
    broker?: CodexThreadEventBroker;
    signal: AbortSignal;
    threads: readonly {
        rolloutPath: string;
        threadId: string;
    }[];
};

export const createCodexThreadEventResponse = ({
    broker = defaultBroker,
    signal,
    threads,
}: CreateEventResponseOptions) => {
    const unsubscribes: Array<() => void> = [];
    let abortListener: (() => void) | null = null;
    let closed = false;
    const cleanup = () => {
        for (const unsubscribe of unsubscribes.splice(0)) {
            unsubscribe();
        }
        if (abortListener) {
            signal.removeEventListener('abort', abortListener);
            abortListener = null;
        }
    };
    const stream = new ReadableStream<Uint8Array>({
        cancel: () => {
            closed = true;
            cleanup();
        },
        start: (controller) => {
            const close = () => {
                if (closed) {
                    return;
                }
                closed = true;
                cleanup();
                controller.close();
            };
            abortListener = close;
            signal.addEventListener('abort', close, { once: true });
            controller.enqueue(encoder.encode('retry: 2000\nevent: connected\ndata: {}\n\n'));
            for (const { rolloutPath, threadId } of threads) {
                unsubscribes.push(
                    broker.subscribe(rolloutPath, () => {
                        if (!closed) {
                            controller.enqueue(
                                encoder.encode(
                                    `event: transcript-changed\ndata: ${JSON.stringify({
                                        revision: Date.now(),
                                        threadId,
                                    })}\n\n`,
                                ),
                            );
                        }
                    }),
                );
            }

            if (signal.aborted) {
                close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'Content-Type': 'text/event-stream',
            'X-Accel-Buffering': 'no',
        },
    });
};
