import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCodexThreadEventBroker, createCodexThreadEventResponse } from './codex-thread-events';

const readEvent = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
    const result = await reader.read();
    return new TextDecoder().decode(result.value);
};

describe('Codex thread events', () => {
    it('should share one rollout monitor across clients and release it after the final disconnect', () => {
        const watchedPaths: string[] = [];
        const closedPaths: string[] = [];
        const callbacks = new Map<string, () => void>();
        const broker = createCodexThreadEventBroker({
            watchRolloutFile: (rolloutPath, onChange) => {
                watchedPaths.push(rolloutPath);
                callbacks.set(rolloutPath, onChange);
                return {
                    close: () => closedPaths.push(rolloutPath),
                };
            },
        });
        const firstEvents: string[] = [];
        const secondEvents: string[] = [];
        const rolloutPath = path.join('/tmp', 'sessions', 'rollout.jsonl');

        const unsubscribeFirst = broker.subscribe(rolloutPath, () => firstEvents.push('changed'));
        const unsubscribeSecond = broker.subscribe(rolloutPath, () => secondEvents.push('changed'));

        expect(watchedPaths).toEqual([rolloutPath]);
        callbacks.get(rolloutPath)?.();
        expect(firstEvents).toEqual(['changed']);
        expect(secondEvents).toEqual(['changed']);

        unsubscribeFirst();
        expect(closedPaths).toEqual([]);
        unsubscribeSecond();
        expect(closedPaths).toEqual([rolloutPath]);
    });

    it('should keep monitors for different rollout files isolated', () => {
        const callbacks = new Map<string, () => void>();
        const broker = createCodexThreadEventBroker({
            watchRolloutFile: (rolloutPath, onChange) => {
                callbacks.set(rolloutPath, onChange);
                return { close: () => {} };
            },
        });
        const events: string[] = [];
        const unsubscribeFirst = broker.subscribe('/tmp/first.jsonl', () => events.push('first'));
        const unsubscribeSecond = broker.subscribe('/tmp/second.jsonl', () => events.push('second'));

        callbacks.get('/tmp/first.jsonl')?.();

        expect(events).toEqual(['first']);
        unsubscribeFirst();
        unsubscribeSecond();
    });

    it('should ref-count repeated subscriptions even when they use the same callback', () => {
        let closeCount = 0;
        const broker = createCodexThreadEventBroker({
            watchRolloutFile: () => ({ close: () => (closeCount += 1) }),
        });
        const onChange = () => {};

        const unsubscribeFirst = broker.subscribe('/tmp/rollout.jsonl', onChange);
        const unsubscribeSecond = broker.subscribe('/tmp/rollout.jsonl', onChange);

        unsubscribeFirst();
        expect(closeCount).toBe(0);
        unsubscribeSecond();
        expect(closeCount).toBe(1);
    });

    it('should detect a real rollout file change while a live client is connected', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spiracha-codex-live-'));
        const rolloutPath = path.join(tempRoot, 'rollout.jsonl');
        await Bun.write(rolloutPath, '{}\n');
        const broker = createCodexThreadEventBroker();
        let unsubscribe = () => {};

        try {
            await Promise.race([
                new Promise<void>((resolve) => {
                    unsubscribe = broker.subscribe(rolloutPath, resolve);
                    void Bun.write(rolloutPath, '{}\n{"type":"event"}\n');
                }),
                Bun.sleep(5000).then(() => {
                    throw new Error('Timed out waiting for the rollout file monitor.');
                }),
            ]);
        } finally {
            unsubscribe();
            await rm(tempRoot, { force: true, recursive: true });
        }
    });

    it('should multiplex thread changes over one stream and release every monitor on abort', async () => {
        const notifyChange = new Map<string, () => void>();
        let cleanupCount = 0;
        const broker = {
            subscribe: (rolloutPath: string, onChange: () => void) => {
                notifyChange.set(rolloutPath, onChange);
                return () => {
                    cleanupCount += 1;
                };
            },
        };
        const abortController = new AbortController();
        const response = createCodexThreadEventResponse({
            broker,
            signal: abortController.signal,
            threads: [
                { rolloutPath: '/tmp/first.jsonl', threadId: 'thread-1' },
                { rolloutPath: '/tmp/second.jsonl', threadId: 'thread-2' },
            ],
        });
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('Expected an event stream body.');
        }

        expect(response.headers.get('content-type')).toBe('text/event-stream');
        expect(await readEvent(reader)).toContain('event: connected');

        notifyChange.get('/tmp/second.jsonl')?.();
        const changeEvent = await readEvent(reader);
        expect(changeEvent).toContain('event: transcript-changed');
        expect(changeEvent).toContain('"threadId":"thread-2"');

        abortController.abort();
        await reader.closed;
        expect(cleanupCount).toBe(2);
    });
});
