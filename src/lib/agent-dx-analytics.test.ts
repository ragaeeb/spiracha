import { describe, expect, it } from 'bun:test';
import {
    AGENT_DX_CSV_COLUMNS,
    buildAgentDxAnalytics,
    captureAgentDxRecord,
    createAgentDxAccumulator,
    finishAgentDxAnalysis,
    renderAgentDxAnalyticsExport,
} from './agent-dx-analytics';
import type { JsonValue } from './shared';

const responseItem = (payload: Record<string, JsonValue>, timestamp = '2026-09-02T12:00:00.000Z') => ({
    payload,
    timestamp,
    type: 'response_item',
});

describe('agent DX analytics', () => {
    it('should retain provider-neutral event, usage, saturation, polling, and lineage metrics', () => {
        const accumulator = createAgentDxAccumulator({
            createdAtMs: Date.parse('2026-09-02T12:00:00.000Z'),
            cwd: '/repo',
            reportedUsageValue: 12,
            sourceThreadId: 'root',
        });

        const records: Array<Record<string, JsonValue>> = [
            {
                payload: {
                    assignmentId: 'assignment-1',
                    git: { commit_hash: 'base-sha' },
                    id: 'root',
                    type: 'session_meta',
                },
                timestamp: '2026-09-02T12:00:00.000Z',
                type: 'session_meta',
            },
            {
                payload: { model: 'gpt-5.6-sol', turn_id: 'turn-1', type: 'turn_context' },
                timestamp: '2026-09-02T12:00:01.000Z',
                type: 'turn_context',
            },
            responseItem({ message: 'inspect the repository', type: 'user_message' }),
            responseItem({
                arguments: JSON.stringify({ cmd: 'rtk read AGENTS.md', max_output_bytes: 100, workdir: '/repo' }),
                call_id: 'read-1',
                name: 'exec_command',
                type: 'function_call',
            }),
            responseItem({
                call_id: 'read-1',
                output: 'x'.repeat(100),
                type: 'function_call_output',
            }),
            responseItem({
                arguments: JSON.stringify({ cmd: 'rtk read AGENTS.md', max_output_bytes: 100, workdir: '/repo' }),
                call_id: 'read-2',
                name: 'exec_command',
                type: 'function_call',
            }),
            responseItem({ call_id: 'read-2', output: 'same', type: 'function_call_output' }),
            responseItem({
                arguments: JSON.stringify({ cmd: 'rtk bun test', workdir: '/repo' }),
                call_id: 'gate-1',
                name: 'exec_command',
                type: 'function_call',
            }),
            responseItem({
                arguments: JSON.stringify({ cmd: 'rtk bun test', workdir: '/repo' }),
                call_id: 'gate-2',
                name: 'exec_command',
                type: 'function_call',
            }),
            responseItem({
                arguments: JSON.stringify({
                    assignment_id: 'assignment-1',
                    operation_id: 'operation-1',
                    parent_tool_call_id: 'parent-call-1',
                }),
                call_id: 'wait-1',
                name: 'wait_agent',
                type: 'function_call',
            }),
            responseItem({
                call_id: 'wait-1',
                output: JSON.stringify({ status: 'complete' }),
                type: 'function_call_output',
            }),
            responseItem({
                arguments: JSON.stringify({ workdir: '/repo' }),
                call_id: 'terminal-1',
                name: 'read_thread_terminal',
                type: 'function_call',
            }),
            responseItem({
                call_id: 'terminal-1',
                output: JSON.stringify({
                    child_stream: { text: 'hidden', type: 'reasoning_delta' },
                    koter_invocation_id: 'koter-1',
                }),
                type: 'function_call_output',
            }),
            responseItem({
                arguments: JSON.stringify({ cmd: 'git rev-parse HEAD', workdir: '/repo' }),
                call_id: 'postimage-1',
                name: 'exec_command',
                type: 'function_call',
            }),
            responseItem({
                call_id: 'postimage-1',
                output: '0123456789abcdef0123456789abcdef01234567\n',
                type: 'function_call_output',
            }),
            responseItem({
                content: [{ text: 'implemented', type: 'output_text' }],
                phase: 'final_answer',
                role: 'assistant',
                type: 'message',
            }),
            {
                payload: {
                    info: {
                        last_token_usage: {
                            cached_input_tokens: 5,
                            input_tokens: 11,
                            output_tokens: 7,
                            reasoning_tokens: 6,
                            total_tokens: 29,
                        },
                        total_token_usage: {
                            cached_input_tokens: 2,
                            input_tokens: 10,
                            output_tokens: 4,
                            reasoning_tokens: 3,
                            total_tokens: 42,
                        },
                    },
                    type: 'token_count',
                },
                timestamp: '2026-09-02T12:00:20.000Z',
                type: 'event_msg',
            },
            {
                payload: { completed_at: 1788340820, type: 'task_complete' },
                timestamp: '2026-09-02T12:00:21.000Z',
                type: 'event_msg',
            },
        ];

        for (const record of records) {
            captureAgentDxRecord(record, accumulator);
        }

        const summary = finishAgentDxAnalysis(accumulator);

        expect(summary.turnOrGoalIds).toEqual(['turn-1']);
        expect(summary.repositoryIdentityBefore).toBe('base-sha');
        expect(summary.repositoryIdentityAfter).toBe('0123456789abcdef0123456789abcdef01234567');
        expect(summary.reportedUsage).toEqual({ semantics: 'cumulative', value: 42 });
        expect(summary.incrementalTokens).toEqual({ cachedInput: 5, input: 11, output: 7, reasoning: 6 });
        expect(summary.retainedBytesByEventClass.user).toBeGreaterThan(0);
        expect(summary.retainedBytesByEventClass.assistant).toBeGreaterThan(0);
        expect(summary.retainedBytesByEventClass.toolInput).toBeGreaterThan(0);
        expect(summary.retainedBytesByEventClass.toolOutput).toBeGreaterThan(0);
        expect(summary.outputSaturationBlocks).toBe(1);
        expect(summary.repeatedReadCalls).toBe(1);
        expect(summary.repeatedGateCalls).toBe(1);
        expect(summary.pollWaitCount).toBe(1);
        expect(summary.terminalReadCount).toBe(1);
        expect(summary.parentToolCallId).toBe('parent-call-1');
        expect(summary.assignmentId).toBe('assignment-1');
        expect(summary.operationId).toBe('operation-1');
        expect(summary.koterInvocationId).toBe('koter-1');
        expect(summary.terminalOutcome).toBe('complete');
        expect(summary.warnings.map((warning) => warning.code)).toEqual(['output-saturation', 'same-state-rerun']);
    });

    it('should count polling operations without inventing parent lineage', () => {
        const accumulator = createAgentDxAccumulator({ cwd: '/repo' });
        for (const [index, name] of ['wait_threads', 'write_stdin', 'spawn_agent'].entries()) {
            captureAgentDxRecord(
                responseItem({
                    call_id: `poll-${index}`,
                    name,
                    type: 'function_call',
                }),
                accumulator,
            );
        }

        expect(finishAgentDxAnalysis(accumulator)).toMatchObject({
            parentToolCallId: null,
            pollWaitCount: 2,
        });
    });

    it('should aggregate goal spans and warn on same-state cross-child rereads', () => {
        const makeSummary = (readFingerprint: string) => {
            const accumulator = createAgentDxAccumulator({
                cwd: '/repo',
                repositoryIdentityBefore: 'base-sha',
                sourceThreadId: 'child',
            });
            captureAgentDxRecord(
                responseItem({
                    arguments: JSON.stringify({ cmd: `rtk read ${readFingerprint}`, workdir: '/repo' }),
                    call_id: readFingerprint,
                    name: 'exec_command',
                    type: 'function_call',
                }),
                accumulator,
            );
            return finishAgentDxAnalysis(accumulator);
        };

        const analytics = buildAgentDxAnalytics([
            {
                childThreadIds: ['child-1', 'child-2'],
                cwd: '/repo',
                firstUserMessage: 'Build KALU-1',
                gitSha: 'base-sha',
                source: 'codex',
                summary: finishAgentDxAnalysis(
                    createAgentDxAccumulator({ cwd: '/repo', repositoryIdentityBefore: 'base-sha' }),
                ),
                threadId: 'root',
                title: 'KALU-1',
            },
            {
                agentRole: 'independent_verifier',
                childThreadIds: [],
                cwd: '/repo',
                firstUserMessage: 'verify',
                gitSha: 'base-sha',
                parentThreadId: 'root',
                source: 'codex',
                summary: makeSummary('AGENTS.md'),
                threadId: 'child-1',
                title: 'Verify one',
            },
            {
                agentRole: 'independent_verifier',
                childThreadIds: [],
                cwd: '/repo',
                firstUserMessage: 'verify',
                gitSha: 'base-sha',
                parentThreadId: 'root',
                source: 'codex',
                summary: makeSummary('AGENTS.md'),
                threadId: 'child-2',
                title: 'Verify two',
            },
        ]);

        expect(analytics.schema).toBe('agent-dx/v1');
        expect(analytics.goalSpans).toHaveLength(1);
        expect(analytics.goalSpans[0]).toMatchObject({
            childThreadIdsSpawnedInSpan: ['child-1', 'child-2'],
            crossChildSameStateRereads: 1,
            repositoryIdentityBefore: 'base-sha',
            roleFanout: [{ count: 2, label: 'independent_verifier' }],
            rootThreadId: 'root',
            terminalOutcome: 'unknown',
        });
        expect(analytics.goalSpans[0]?.warnings.map((warning) => warning.code)).toContain(
            'cross-child-same-state-reread',
        );
    });

    it('should keep ordinary tool output from becoming a terminal failure', () => {
        const accumulator = createAgentDxAccumulator({ cwd: '/repo' });
        captureAgentDxRecord(
            responseItem({
                arguments: JSON.stringify({ cmd: 'rtk bun test', workdir: '/repo' }),
                call_id: 'test-1',
                name: 'exec_command',
                type: 'function_call',
            }),
            accumulator,
        );
        captureAgentDxRecord(
            responseItem({
                call_id: 'test-1',
                output: 'error handling test: 0 failed',
                type: 'function_call_output',
            }),
            accumulator,
        );

        expect(finishAgentDxAnalysis(accumulator).terminalOutcome).toBe('unknown');
    });

    it('should stop discovery before the first mutation call', () => {
        const accumulator = createAgentDxAccumulator({
            createdAtMs: Date.parse('2026-09-02T12:00:00.000Z'),
            cwd: '/repo',
        });
        captureAgentDxRecord(responseItem({ message: 'make the change', type: 'user_message' }), accumulator);
        captureAgentDxRecord(
            responseItem(
                {
                    arguments: JSON.stringify({ cmd: 'touch output.txt', workdir: '/repo' }),
                    call_id: 'write-1',
                    name: 'exec_command',
                    type: 'function_call',
                },
                '2026-09-02T12:00:01.000Z',
            ),
            accumulator,
        );

        expect(finishAgentDxAnalysis(accumulator)).toMatchObject({
            discoveryCallCount: 0,
            firstMutationLatencyMs: 1000,
        });
    });

    it('should export deterministic JSON and CSV scorecards', () => {
        const analytics = buildAgentDxAnalytics([]);

        expect(renderAgentDxAnalyticsExport(analytics, 'json')).toBe(`${JSON.stringify(analytics, null, 2)}\n`);
        expect(renderAgentDxAnalyticsExport(analytics, 'csv')).toBe(`${AGENT_DX_CSV_COLUMNS.join(',')}\n`);
    });
});
