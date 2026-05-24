import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCodexBrowserFixture } from './codex-test-helpers';
import { getCachedThreadTranscriptPreview, getThreadRolloutLoadState } from './codex-thread-cache';

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
});
