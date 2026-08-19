import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseCodexOptimizationFile } from './codex-optimization-analysis';

const tempPaths: string[] = [];

afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

const responseItem = (payload: Record<string, unknown>) =>
    JSON.stringify({
        payload,
        type: 'response_item',
    });

describe('parseCodexOptimizationFile', () => {
    it('should identify deterministic context leakage and repeated-work signals', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-optimization-test-'));
        tempPaths.push(tempRoot);
        const transcriptPath = path.join(tempRoot, 'rollout.jsonl');
        const broadReadCommand = 'rtk read AGENTS.md && rtk read docs/tasks/example/TASK.md';
        const checkCommand = 'rtk bun run check:fast';
        const leakingOutput = [
            'Warning: truncated output (original token count: 12000)',
            '{"type":"thinking_delta","delta":"hidden reasoning"}',
            '{"type":"tool_call","name":"read_file"}',
        ].join('\n');

        await Bun.write(
            transcriptPath,
            [
                responseItem({
                    arguments: JSON.stringify({
                        fork_turns: 'all',
                        task_name: 'audit_capture_runtime',
                    }),
                    call_id: 'spawn-1',
                    name: 'spawn_agent',
                    type: 'function_call',
                }),
                responseItem({
                    arguments: JSON.stringify({ cmd: broadReadCommand }),
                    call_id: 'read-1',
                    name: 'exec_command',
                    type: 'function_call',
                }),
                responseItem({ call_id: 'read-1', output: leakingOutput, type: 'function_call_output' }),
                responseItem({
                    arguments: JSON.stringify({ cmd: broadReadCommand }),
                    call_id: 'read-2',
                    name: 'exec_command',
                    type: 'function_call',
                }),
                responseItem({
                    arguments: JSON.stringify({ cmd: checkCommand }),
                    call_id: 'check-1',
                    name: 'exec_command',
                    type: 'function_call',
                }),
                responseItem({
                    arguments: JSON.stringify({ cmd: checkCommand }),
                    call_id: 'check-2',
                    name: 'exec_command',
                    type: 'function_call',
                }),
                responseItem({
                    arguments: JSON.stringify({ timeout_ms: 30_000 }),
                    call_id: 'wait-1',
                    name: 'wait_agent',
                    type: 'function_call',
                }),
                responseItem({
                    call_id: 'wait-1',
                    output: JSON.stringify({ message: 'Wait timed out.', timed_out: true }),
                    type: 'function_call_output',
                }),
            ].join('\n'),
        );

        const summary = await parseCodexOptimizationFile(transcriptPath);

        expect(summary).toMatchObject({
            broadReadCalls: 2,
            commandCalls: 4,
            externalAgentStreamBlocks: 1,
            fullContextSpawns: 1,
            genericSubagentSpawns: 1,
            parentVisibleReasoningEvents: 1,
            parentVisibleSubagentToolEvents: 1,
            repeatedCheckCalls: 1,
            repeatedCommandCalls: 2,
            repeatedReadCalls: 1,
            timedOutWaits: 1,
            truncationBlocks: 1,
        });
        expect(summary.personaTaskLabels).toEqual(['audit and review']);
        expect(summary.toolOutputBytes).toBeGreaterThan(leakingOutput.length);
    });

    it('should leave final-only bounded agent results unflagged', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-optimization-final-only-test-'));
        tempPaths.push(tempRoot);
        const transcriptPath = path.join(tempRoot, 'rollout.jsonl');

        await Bun.write(
            transcriptPath,
            [
                responseItem({
                    arguments: JSON.stringify({
                        agent_type: 'independent_verifier',
                        fork_turns: 'none',
                        task_name: 'verify_capture',
                    }),
                    call_id: 'spawn-1',
                    name: 'spawn_agent',
                    type: 'function_call',
                }),
                responseItem({
                    call_id: 'spawn-1',
                    output: JSON.stringify({ disposition: 'proved', status: 'complete' }),
                    type: 'function_call_output',
                }),
            ].join('\n'),
        );

        const summary = await parseCodexOptimizationFile(transcriptPath);

        expect(summary).toMatchObject({
            externalAgentStreamBlocks: 0,
            fullContextSpawns: 0,
            genericSubagentSpawns: 0,
            parentVisibleReasoningEvents: 0,
            parentVisibleSubagentToolEvents: 0,
            timedOutWaits: 0,
            truncationBlocks: 0,
        });
        expect(summary.personaTaskLabels).toEqual([]);
    });
});
