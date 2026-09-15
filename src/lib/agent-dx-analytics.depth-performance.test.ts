import { expect, it } from 'bun:test';
import { buildAgentDxAnalytics, createAgentDxAccumulator, finishAgentDxAnalysis } from './agent-dx-analytics';

it('should traverse deeply nested agent threads without consuming the call stack', () => {
    const summary = finishAgentDxAnalysis(createAgentDxAccumulator({ cwd: '/repo' }));
    const descriptors = Array.from({ length: 15_000 }, (_, index) => ({
        childThreadIds: [],
        cwd: '/repo',
        firstUserMessage: '',
        gitSha: null,
        parentThreadId: index === 0 ? null : `thread-${index - 1}`,
        source: 'codex',
        summary,
        threadId: `thread-${index}`,
        title: 'Goal',
    }));
    const result = buildAgentDxAnalytics(descriptors);
    expect(result.goalSpans).toHaveLength(1);
    expect(result.goalSpans[0]!.childThreadIdsSpawnedInSpan).toHaveLength(14_999);
});
