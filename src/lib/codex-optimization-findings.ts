import type {
    CodexOptimizationAnalytics,
    CodexOptimizationFinding,
    CodexOptimizationSummary,
    DistributionItem,
} from './codex-browser-types';
import type { ThreadOptimizationSummary } from './codex-optimization-analysis';

const sum = (summaries: ThreadOptimizationSummary[], key: keyof CodexOptimizationSummary) =>
    summaries.reduce((total, summary) => total + summary[key], 0);

const affectedThreads = (
    summaries: ThreadOptimizationSummary[],
    predicate: (summary: ThreadOptimizationSummary) => boolean,
) => summaries.filter(predicate).length;

const personaCandidates = (summaries: ThreadOptimizationSummary[]): DistributionItem[] => {
    const counts = new Map<string, number>();
    for (const label of summaries.flatMap((summary) => summary.personaTaskLabels)) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([label, count]) => ({ count, label }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
};

const addFinding = (findings: CodexOptimizationFinding[], finding: CodexOptimizationFinding) => {
    if (finding.observedCount > 0) {
        findings.push(finding);
    }
};

export const buildCodexOptimizationAnalytics = (
    threadSummaries: ThreadOptimizationSummary[],
): CodexOptimizationAnalytics => {
    const summary: CodexOptimizationSummary = {
        broadReadCalls: sum(threadSummaries, 'broadReadCalls'),
        externalAgentStreamBlocks: sum(threadSummaries, 'externalAgentStreamBlocks'),
        externalAgentStreamBytes: sum(threadSummaries, 'externalAgentStreamBytes'),
        fullContextSpawns: sum(threadSummaries, 'fullContextSpawns'),
        genericSubagentSpawns: sum(threadSummaries, 'genericSubagentSpawns'),
        parentVisibleReasoningEvents: sum(threadSummaries, 'parentVisibleReasoningEvents'),
        parentVisibleSubagentToolEvents: sum(threadSummaries, 'parentVisibleSubagentToolEvents'),
        repeatedCheckCalls: sum(threadSummaries, 'repeatedCheckCalls'),
        repeatedCommandCalls: sum(threadSummaries, 'repeatedCommandCalls'),
        repeatedReadCalls: sum(threadSummaries, 'repeatedReadCalls'),
        timedOutWaits: sum(threadSummaries, 'timedOutWaits'),
        toolOutputBytes: sum(threadSummaries, 'toolOutputBytes'),
        truncatedOutputBytes: sum(threadSummaries, 'truncatedOutputBytes'),
        truncationBlocks: sum(threadSummaries, 'truncationBlocks'),
    };
    const findings: CodexOptimizationFinding[] = [];

    addFinding(findings, {
        affectedThreads: affectedThreads(threadSummaries, (item) => item.externalAgentStreamBlocks > 0),
        id: 'external-agent-streams',
        impactBytes: summary.externalAgentStreamBytes,
        observedCount: summary.externalAgentStreamBlocks,
        recommendation: 'Use final-only JSON transport and keep complete subagent traces behind artifact references.',
        severity: 'high',
        title: 'External agent internals entered parent context',
    });
    addFinding(findings, {
        affectedThreads: affectedThreads(threadSummaries, (item) => item.truncationBlocks > 0),
        id: 'truncated-tool-output',
        impactBytes: summary.truncatedOutputBytes,
        observedCount: summary.truncationBlocks,
        recommendation:
            'Replace broad reads with bounded ranges or structured summaries and paginate before truncation.',
        severity: 'high',
        title: 'Tool output was retained after truncation',
    });
    addFinding(findings, {
        affectedThreads: affectedThreads(threadSummaries, (item) => item.fullContextSpawns > 0),
        id: 'full-context-forks',
        impactBytes: null,
        observedCount: summary.fullContextSpawns,
        recommendation: 'Default delegated work to fresh context and pass a bounded assignment capsule.',
        severity: 'high',
        title: 'Subagents inherited full parent histories',
    });
    addFinding(findings, {
        affectedThreads: affectedThreads(threadSummaries, (item) => item.timedOutWaits > 0),
        id: 'wait-timeouts',
        impactBytes: null,
        observedCount: summary.timedOutWaits,
        recommendation: 'Use one event-driven completion wait and fetch the final structured result once.',
        severity: 'medium',
        title: 'Agent waits timed out',
    });
    addFinding(findings, {
        affectedThreads: affectedThreads(threadSummaries, (item) => item.repeatedCheckCalls > 0),
        id: 'repeated-checks',
        impactBytes: null,
        observedCount: summary.repeatedCheckCalls,
        recommendation: 'Cache successful checks by exact repository state and run one authoritative closeout gate.',
        severity: 'medium',
        title: 'Identical checks were rerun',
    });
    addFinding(findings, {
        affectedThreads: affectedThreads(threadSummaries, (item) => item.genericSubagentSpawns > 0),
        id: 'generic-subagents',
        impactBytes: null,
        observedCount: summary.genericSubagentSpawns,
        recommendation:
            'Review repeated task labels below and promote stable lifecycle work into bounded project personas.',
        severity: 'medium',
        title: 'Generic subagents handled potentially repeatable roles',
    });
    addFinding(findings, {
        affectedThreads: affectedThreads(threadSummaries, (item) => item.repeatedCommandCalls > 0),
        id: 'repeated-commands',
        impactBytes: null,
        observedCount: summary.repeatedCommandCalls,
        recommendation:
            'Return unchanged or cached results when the command inputs and repository state are identical.',
        severity: 'low',
        title: 'Identical shell commands were repeated',
    });
    const authorityReads = summary.broadReadCalls + summary.repeatedReadCalls;
    addFinding(findings, {
        affectedThreads: affectedThreads(
            threadSummaries,
            (item) => item.broadReadCalls > 0 || item.repeatedReadCalls > 0,
        ),
        id: 'authority-rereads',
        impactBytes: null,
        observedCount: authorityReads,
        recommendation:
            'Generate content-addressed, role-scoped authority packets instead of chaining complete document reads.',
        severity: 'low',
        title: 'Broad or repeated repository reads were requested',
    });

    return {
        findings,
        personaCandidates: personaCandidates(threadSummaries),
        summary,
    };
};
