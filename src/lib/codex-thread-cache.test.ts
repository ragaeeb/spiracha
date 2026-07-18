import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCodexBrowserFixture } from './codex-test-helpers';
import {
    getCachedCodexTranscriptStats,
    getCachedThreadTranscriptPreview,
    getThreadRolloutLoadState,
    LARGE_THREAD_SIZE_BYTES,
} from './codex-thread-cache';
import { invalidateCacheByPrefix } from './ui-cache';

const tempPaths: string[] = [];

afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

describe('getCachedThreadTranscriptPreview', () => {
    it('should report when a rollout should defer transcript loading', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-thread-cache-state-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const state = await getThreadRolloutLoadState(fixture.threads[0]!.sessionFile, 1);

        expect(state.shouldDeferTranscriptLoad).toBe(true);
        expect(state.fileSizeBytes).toBeGreaterThan(1);
    });

    it('should return the full transcript when the rollout is below the defer threshold', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-thread-cache-full-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const transcript = await getCachedThreadTranscriptPreview(fixture.threads[0]!.sessionFile, {
            largeTranscriptThresholdBytes: Number.MAX_SAFE_INTEGER,
        });

        expect(transcript.isPartial).toBe(false);
        expect(transcript.rawIncluded).toBe(true);
        expect(transcript.events.length).toBeGreaterThan(2);
    });

    it('should switch to preview mode when a rollout exceeds the configured size threshold', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-thread-cache-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const transcript = await getCachedThreadTranscriptPreview(fixture.threads[0]!.sessionFile, {
            largeTranscriptThresholdBytes: 1,
            previewEventLimit: 2,
        });

        expect(transcript.events).toHaveLength(2);
        expect(transcript.isPartial).toBe(true);
        expect(transcript.rawIncluded).toBe(false);
        expect(transcript.statsArePartial).toBe(true);
        expect(transcript.sourceFileSizeBytes).toBeGreaterThan(1);
    });

    it('should return the last visible events for a filtered oversized rollout preview', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-thread-cache-filtered-tail-test-'));
        tempPaths.push(tempRoot);
        const sessionFile = path.join(tempRoot, 'filtered-tail.jsonl');
        await Bun.write(
            sessionFile,
            [
                JSON.stringify({
                    payload: { message: 'first user prompt', type: 'user_message' },
                    timestamp: '2026-07-07T12:00:00.000Z',
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: { message: 'first final answer', phase: 'final_answer', type: 'agent_message' },
                    timestamp: '2026-07-07T12:00:01.000Z',
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: { message: 'second user prompt', type: 'user_message' },
                    timestamp: '2026-07-07T12:00:02.000Z',
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: { message: 'second final answer', phase: 'final_answer', type: 'agent_message' },
                    timestamp: '2026-07-07T12:00:03.000Z',
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: { arguments: '{"cmd":"rtk bun test"}', name: 'exec_command', type: 'function_call' },
                    timestamp: '2026-07-07T12:00:04.000Z',
                    type: 'response_item',
                }),
            ].join('\n'),
        );

        const transcript = await getCachedThreadTranscriptPreview(sessionFile, {
            filters: {
                showCommentary: false,
                showExtraEvents: false,
                showToolCalls: false,
                showUserMessages: false,
            },
            largeTranscriptThresholdBytes: 1,
            previewEventLimit: 1,
        });

        expect(transcript.events).toHaveLength(1);
        expect(transcript.events[0]).toMatchObject({
            kind: 'message',
            role: 'assistant',
            text: 'second final answer',
        });
        expect(transcript.rawIncluded).toBe(false);
        expect(transcript.statsArePartial).toBe(true);
    });

    it('should switch to preview mode when a rollout exceeds the default size threshold', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-thread-cache-default-large-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const originalContent = await Bun.file(fixture.threads[0]!.sessionFile).text();

        await Bun.write(fixture.threads[0]!.sessionFile, `${originalContent}\n${' '.repeat(LARGE_THREAD_SIZE_BYTES)}`);

        const state = await getThreadRolloutLoadState(fixture.threads[0]!.sessionFile);
        const transcript = await getCachedThreadTranscriptPreview(fixture.threads[0]!.sessionFile);

        expect(state.shouldDeferTranscriptLoad).toBe(true);
        expect(transcript.isPartial).toBe(true);
        expect(transcript.rawIncluded).toBe(false);
        expect(transcript.sourceFileSizeBytes).toBeGreaterThan(LARGE_THREAD_SIZE_BYTES);
    });
});

describe('getCachedCodexTranscriptStats', () => {
    it('should cache only transcript statistics for thread listings', async () => {
        await invalidateCacheByPrefix('thread-list-stats-');
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-thread-list-stats-test-'));
        tempPaths.push(tempRoot);
        const sessionFile = path.join(tempRoot, 'rollout.jsonl');
        const privateMessage = 'private-message-that-must-not-enter-the-list-cache';
        await Bun.write(
            sessionFile,
            [
                JSON.stringify({
                    payload: { message: privateMessage, phase: 'final_answer', type: 'agent_message' },
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: { arguments: '{}', name: 'exec_command', type: 'function_call' },
                    type: 'response_item',
                }),
            ].join('\n'),
        );

        const stats = await getCachedCodexTranscriptStats(sessionFile);
        const cacheDir = path.join(os.tmpdir(), 'spiracha-ui-cache');
        const cacheEntries = (await readdir(cacheDir)).filter((entry) => entry.startsWith('thread-list-stats-'));
        const cachedPayloads = await Promise.all(
            cacheEntries.map((entry) => Bun.file(path.join(cacheDir, entry)).text()),
        );

        expect(stats).toMatchObject({
            finalAnswerCount: 1,
            toolCallCount: 1,
        });
        expect(cacheEntries).toHaveLength(1);
        expect(cachedPayloads.join('\n')).not.toContain(privateMessage);
    });
});
