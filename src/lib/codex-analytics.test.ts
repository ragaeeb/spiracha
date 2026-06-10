import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    buildCodexAnalyticsCacheKey,
    computeCodexAnalyticsFromThreads,
    getCodexAnalytics,
    resolveAnalyticsTranscriptConcurrency,
} from './codex-analytics';
import type { ThreadRow } from './codex-exporter-types';
import { createCodexBrowserFixture } from './codex-test-helpers';

const tempPaths: string[] = [];

afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

describe('getCodexAnalytics', () => {
    it('should aggregate global analytics from thread rows and parsed transcript events', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-analytics-global-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const analytics = await getCodexAnalytics({
            dbPath: fixture.dbPath,
            project: null,
        });

        expect(analytics.summary).toMatchObject({
            archivedThreads: 1,
            averageTokensPerThread: 243930.33,
            totalProjects: 2,
            totalThreads: 3,
            totalTokens: 731791,
        });
        expect(analytics.toolUsage).toEqual([
            { count: 3, name: 'exec_command' },
            { count: 3, name: 'web.run' },
        ]);
        expect(analytics.summary.threadsWithWebSearch).toBe(3);
        expect(analytics.summary.distinctToolNames).toBe(2);
    });

    it('should restrict analytics to a single derived project', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-analytics-project-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const analytics = await getCodexAnalytics({
            dbPath: fixture.dbPath,
            project: 'spiracha',
        });

        expect(analytics.summary).toMatchObject({
            archivedThreads: 0,
            totalProjects: 1,
            totalThreads: 2,
            totalTokens: 640791,
        });
        expect(analytics.modelsByTokens[0]).toEqual({
            model: 'gpt-5.4',
            threadCount: 1,
            totalTokens: 460668,
        });
    });

    it('should build cache keys from DB row metadata without statting rollout files', () => {
        const thread = createThreadRow({
            id: 'thread-a',
            rollout_path: '/does/not/exist/rollout.jsonl',
            updated_at_ms: 1779037924000,
        });

        const firstKey = buildCodexAnalyticsCacheKey('/tmp/state.sqlite', [thread], null);
        const updatedKey = buildCodexAnalyticsCacheKey(
            '/tmp/state.sqlite',
            [{ ...thread, updated_at_ms: 1779037925000 }],
            null,
        );

        expect(firstKey).toStartWith('analytics-');
        expect(updatedKey).not.toBe(firstKey);
    });

    it('should reuse the analytics cache without touching rollout files when DB metadata is unchanged', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-analytics-cache-hit-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const firstAnalytics = await getCodexAnalytics({
            dbPath: fixture.dbPath,
            project: null,
        });
        await rm(fixture.inputDir, { force: true, recursive: true });
        const cachedAnalytics = await getCodexAnalytics({
            dbPath: fixture.dbPath,
            project: null,
        });

        expect(cachedAnalytics).toEqual(firstAnalytics);
    });

    it('should cap concurrent transcript analytics work for large thread sets', async () => {
        const threadCount = 250;
        const concurrency = 7;
        let activeLoads = 0;
        let maxActiveLoads = 0;
        let loadCount = 0;
        const threads = Array.from({ length: threadCount }, (_value, index) =>
            createThreadRow({
                id: `thread-${index}`,
                rollout_path: `/tmp/rollout-${index}.jsonl`,
            }),
        );

        const analytics = await computeCodexAnalyticsFromThreads(threads, {
            loadThreadAnalytics: async (thread) => {
                activeLoads += 1;
                loadCount += 1;
                maxActiveLoads = Math.max(maxActiveLoads, activeLoads);
                await Bun.sleep(1);
                activeLoads -= 1;

                return {
                    hasWebSearch: thread.id.endsWith('0'),
                    toolNames: ['exec_command'],
                };
            },
            transcriptConcurrency: concurrency,
        });

        expect(loadCount).toBe(threadCount);
        expect(maxActiveLoads).toBeLessThanOrEqual(concurrency);
        expect(analytics.summary.totalThreads).toBe(threadCount);
        expect(analytics.summary.threadsWithWebSearch).toBe(25);
        expect(analytics.toolUsage).toEqual([{ count: threadCount, name: 'exec_command' }]);
    });

    it('should resolve tunable analytics transcript concurrency from explicit config', () => {
        expect(resolveAnalyticsTranscriptConcurrency('12')).toBe(12);
        expect(resolveAnalyticsTranscriptConcurrency('0')).toBe(8);
        expect(resolveAnalyticsTranscriptConcurrency('not-a-number')).toBe(8);
    });
});

const createThreadRow = (overrides: Partial<ThreadRow>): ThreadRow => ({
    agent_nickname: null,
    agent_path: null,
    agent_role: null,
    approval_mode: 'never',
    archived: 0,
    archived_at: null,
    cli_version: '0.1.0',
    created_at: 1779036500,
    created_at_ms: 1779036500000,
    cwd: '/Users/example/workspace/spiracha',
    first_user_message: 'Build analytics',
    git_branch: 'main',
    git_origin_url: null,
    git_sha: null,
    has_user_event: 1,
    id: 'thread-a',
    memory_mode: 'enabled',
    model: 'gpt-5.4',
    model_provider: 'openai',
    preview: 'Build analytics',
    reasoning_effort: 'high',
    rollout_path: '/tmp/rollout.jsonl',
    sandbox_policy: '{}',
    source: 'vscode',
    thread_source: 'user',
    title: 'Build analytics',
    tokens_used: 10,
    updated_at: 1779037924,
    updated_at_ms: 1779037924000,
    ...overrides,
});
