import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getCodexAnalytics } from './codex-analytics';
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
});
