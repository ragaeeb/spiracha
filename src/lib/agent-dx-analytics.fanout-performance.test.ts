import { expect, it } from 'bun:test';
import { buildAgentDxAnalytics, createAgentDxAccumulator, finishAgentDxAnalysis } from './agent-dx-analytics';

it('should build wide child indexes without repeatedly sorting growing sibling arrays', () => {
    const summary = finishAgentDxAnalysis(createAgentDxAccumulator({ cwd: '/repo' }));
    const descriptors = Array.from({ length: 1_001 }, (_, index) => ({
        childThreadIds: [],
        cwd: '/repo',
        firstUserMessage: '',
        gitSha: null,
        parentThreadId: index === 0 ? null : 'root',
        source: 'codex',
        summary,
        threadId: index === 0 ? 'root' : `child-${index}`,
        title: 'Goal',
    }));
    const originalSort = Array.prototype.sort;
    let sortedItems = 0;
    Array.prototype.sort = new Proxy(originalSort, {
        apply: (target, receiver, argumentsList) => {
            sortedItems += receiver.length;
            return Reflect.apply(target, receiver, argumentsList);
        },
    });
    try {
        const result = buildAgentDxAnalytics(descriptors);
        expect(result.goalSpans).toHaveLength(1);
        expect(result.goalSpans[0]!.childThreadIdsSpawnedInSpan).toHaveLength(1_000);
        expect(sortedItems).toBeLessThan(descriptors.length * 50);
    } finally {
        Array.prototype.sort = originalSort;
    }
});
