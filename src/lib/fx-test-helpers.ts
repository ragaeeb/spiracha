import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export type FxFixture = {
    dataDir: string;
    sessionDir: string;
    sessionId: string;
    sessionsDir: string;
    workspacePath: string;
};

const toolStep = (outputHandle: string) => ({
    assistant: 'I will inspect the workspace.',
    tool_calls: [
        {
            arguments_json: JSON.stringify({ command: 'pwd' }),
            id: 'call-pwd',
            name: 'bash',
            provider_result: null,
        },
    ],
    tool_results: [
        {
            created_at_ms: 1_787_000_000_031,
            output: 'preview output',
            output_bytes: 24,
            output_handle: outputHandle,
            preview: 'preview output',
            provider_native: false,
            status: 'success',
            stored_output_bytes: 24,
            tool_call_id: 'call-pwd',
            tool_name: 'bash',
            truncated: true,
        },
    ],
});

const baseTurn = {
    assistant: 'The baseline is ready.',
    execution: { files: [], schema_version: 3, tool_steps: [] },
    kind: 'assistant',
    user: { images: [], text: 'Prepare the baseline.' },
};

export const writeFxFixture = async (
    dataDir: string,
    options: { sessionId?: string; workspacePath?: string } = {},
): Promise<FxFixture> => {
    const sessionId = options.sessionId ?? '1787000000000-1787000000000000000-aabbccddeeff0011';
    const workspacePath = options.workspacePath ?? path.join(dataDir, 'project');
    const sessionsDir = path.join(dataDir, 'sessions');
    const sessionDir = path.join(sessionsDir, sessionId);
    const latestDir = path.join(sessionsDir, 'latest');
    const toolResultsDir = path.join(sessionDir, 'tool-results');
    await Promise.all([
        mkdir(toolResultsDir, { recursive: true }),
        mkdir(latestDir, { recursive: true }),
        mkdir(workspacePath, { recursive: true }),
    ]);

    const summary = {
        conversation_language: 'en',
        created_at_ms: 1_787_000_000_000,
        display_metadata_present: true,
        has_managed_children: false,
        history_len: 2,
        id: sessionId,
        origin_workspace_root: workspacePath,
        preview: 'Prepare the baseline.',
        title: 'FX router migration',
        updated_at_ms: 1_787_000_000_050,
        workspace_root: workspacePath,
    };
    await Bun.write(
        path.join(sessionsDir, 'index.json'),
        `${JSON.stringify({ schema_version: 3, sessions: [summary] })}\n`,
    );
    await Bun.write(
        path.join(sessionsDir, 'relationship-migration-index.json'),
        `${JSON.stringify({ schema_version: 3, sessions: [summary] })}\n`,
    );
    await Bun.write(
        path.join(latestDir, 'workspace.json'),
        `${JSON.stringify({
            schema_version: 2,
            session_id: sessionId,
            status: 'ready',
            updated_at_ms: summary.updated_at_ms,
            workspace_root: workspacePath,
        })}\n`,
    );
    await Bun.write(
        path.join(sessionDir, 'session.json'),
        `${JSON.stringify({
            authority_id: 'authority-fixture',
            checkpoint_seq: 5,
            conversation_language: 'en',
            created_at_ms: summary.created_at_ms,
            event_log_bytes: 100,
            history_len: 2,
            id: sessionId,
            last_event_seq: 9,
            log_generation: 'generation-fixture',
            origin_workspace_root: workspacePath,
            preferences: { effort: 'high', fast_mode: false, model: 'anthropic/claude-sonnet-4.5' },
            schema_version: 4,
            storage_format: 'event_log_v1',
            total_input_tokens: 120,
            total_output_tokens: 45,
            updated_at_ms: summary.updated_at_ms,
            workspace_root: workspacePath,
        })}\n`,
    );
    await Bun.write(
        path.join(sessionDir, 'display.json'),
        `${JSON.stringify({
            origin_workspace_root: workspacePath,
            preview: summary.preview,
            schema_version: 1,
            title: summary.title,
        })}\n`,
    );
    await Bun.write(
        path.join(sessionDir, 'checkpoint.json'),
        `${JSON.stringify({
            log_generation: 'generation-fixture',
            schema_version: 1,
            session_id: sessionId,
            state: {
                context_history_start: 0,
                conversation_language: 'en',
                created_at_ms: summary.created_at_ms,
                history: [baseTurn],
                id: sessionId,
                origin_workspace_root: workspacePath,
                preferences: { effort: 'high', fast_mode: false, model: 'anthropic/claude-sonnet-4.5' },
                total_input_tokens: 50,
                total_output_tokens: 20,
                updated_at_ms: 1_787_000_000_020,
                workspace_root: workspacePath,
            },
            through_event_id: 'event-checkpoint',
            through_event_log_bytes: 50,
            through_seq: 5,
        })}\n`,
    );
    const outputHandle = 'result-bash-fixture.txt';
    await Bun.write(path.join(toolResultsDir, outputHandle), `${workspacePath}\nfull externalized output\n`);
    const recoveryCheckpoint = {
        action: 'retrying_request',
        assistant_source: 'The in-progress response is still useful.',
        cause: 'network_interrupted',
        consumed_provider_attempts: 1,
        execution: {
            files: [],
            schema_version: 3,
            tool_steps: [
                {
                    assistant: 'I am checking the active turn.',
                    tool_calls: [],
                    tool_results: [],
                },
            ],
        },
        fast_mode: false,
        max_provider_attempts: 10,
        outstanding_reservation: false,
        requested_fast_mode: false,
        route_model: 'openai/gpt-5.4',
        tool_state: 'none',
        turn_id: 3,
        user: { images: [], text: 'Continue after the committed turn.' },
        version: 1,
    };
    const events = [
        {
            event_id: 'event-old-recovery',
            kind: 'recovery_checkpoint_set',
            log_generation: 'generation-fixture',
            payload: { checkpoint: { ...recoveryCheckpoint, assistant_source: '' } },
            schema_version: 1,
            seq: 6,
            timestamp_ms: 1_787_000_000_025,
        },
        {
            event_id: 'event-commit',
            kind: 'history_turn_committed',
            log_generation: 'generation-fixture',
            payload: {
                conversation_language: 'en',
                total_input_tokens: 100,
                total_output_tokens: 40,
                turn: {
                    assistant: 'The committed turn is complete.',
                    execution: { files: [], schema_version: 3, tool_steps: [toolStep(outputHandle)] },
                    kind: 'assistant',
                    user: { images: [], text: 'Inspect the committed turn.' },
                },
            },
            schema_version: 1,
            seq: 7,
            timestamp_ms: 1_787_000_000_035,
        },
        {
            event_id: 'event-active-recovery',
            kind: 'recovery_checkpoint_set',
            log_generation: 'generation-fixture',
            payload: { checkpoint: recoveryCheckpoint },
            schema_version: 1,
            seq: 8,
            timestamp_ms: 1_787_000_000_045,
        },
        {
            event_id: 'event-usage',
            kind: 'usage_checkpointed',
            log_generation: 'generation-fixture',
            payload: { usage: { input_tokens: 120, output_tokens: 45 } },
            schema_version: 1,
            seq: 9,
            timestamp_ms: summary.updated_at_ms,
        },
    ];
    await Bun.write(
        path.join(sessionDir, 'events.jsonl'),
        `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    );
    await Bun.write(path.join(sessionDir, 'authority.json'), '{}\n');
    await Bun.write(path.join(sessionDir, 'commit.generation-fixture.json'), '{}\n');
    await Bun.write(path.join(sessionDir, 'session.lock'), '');
    return { dataDir, sessionDir, sessionId, sessionsDir, workspacePath };
};
