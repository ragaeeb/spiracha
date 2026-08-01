import { Database } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export const MINIMAX_CODE_SESSION_ID = 'mvs_08a9fc9128b443a7b5cc92bc690ca37b';
export const MINIMAX_CODE_WORKSPACE_KEY_PREFIX = 'workspace:';

export const writeMiniMaxCodeRuntimeFixture = async ({
    assetPath,
    locked = false,
    runtimeDbPath,
    sessionId = MINIMAX_CODE_SESSION_ID,
}: {
    assetPath?: string;
    locked?: boolean;
    runtimeDbPath: string;
    sessionId?: string;
}) => {
    await mkdir(path.dirname(runtimeDbPath), { recursive: true });
    const db = new Database(runtimeDbPath, { create: true, strict: true });
    try {
        db.run(
            'CREATE TABLE local_runtime_sessions (session_id TEXT PRIMARY KEY, record_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL)',
        );
        db.run(
            'CREATE TABLE local_runtime_message_rows (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, msg_id TEXT NOT NULL, role TEXT, turn_id TEXT, created_at_ms INTEGER NOT NULL, data_json TEXT NOT NULL)',
        );
        db.run(
            'CREATE TABLE local_runtime_pi_history_rows (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT, created_at_ms INTEGER NOT NULL, data_json TEXT NOT NULL)',
        );
        db.run(
            'CREATE TABLE local_runtime_token_usage (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, agent_name TEXT NOT NULL, framework_type TEXT NOT NULL, ts INTEGER NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, reasoning_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL, cache_write_tokens INTEGER NOT NULL)',
        );
        db.run(
            'CREATE TABLE local_runtime_turn_diffs (change_set_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, turn_id TEXT NOT NULL, workspace_dir TEXT NOT NULL, captured_at_ms INTEGER NOT NULL, status TEXT NOT NULL, file_changes_json TEXT NOT NULL)',
        );
        db.run(
            'CREATE TABLE local_runtime_communication_messages (message_id TEXT PRIMARY KEY, from_session TEXT NOT NULL, to_session TEXT NOT NULL, command TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL, created_at_ms INTEGER NOT NULL)',
        );
        db.run(
            'CREATE TABLE local_runtime_background_tasks (task_id TEXT PRIMARY KEY, owner_session_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, record_json TEXT NOT NULL)',
        );
        db.run(
            'CREATE TABLE local_runtime_background_task_events (id INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, task_id TEXT NOT NULL, owner_session_id TEXT NOT NULL, type TEXT NOT NULL, timestamp_ms INTEGER NOT NULL)',
        );
        db.run(
            'CREATE TABLE local_runtime_session_assets (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, msg_id TEXT NOT NULL, message_created_at_ms INTEGER NOT NULL, asset_index INTEGER NOT NULL, asset_key TEXT NOT NULL, source_tag TEXT NOT NULL, path TEXT NOT NULL, data_json TEXT NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL)',
        );
        db.run(
            'CREATE TABLE local_runtime_session_locks (session_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, owner_kind TEXT NOT NULL, acquired_at_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL)',
        );
        db.run(
            'CREATE TABLE local_runtime_legacy_migrations (legacy_session_id TEXT PRIMARY KEY, local_session_id TEXT NOT NULL, source_runtime TEXT NOT NULL, status TEXT NOT NULL, migrated_at_ms INTEGER NOT NULL, legacy_daemon_session_id TEXT, legacy_framework_session_id TEXT)',
        );

        const keepSessionId = 'mvs_keep';
        for (const targetSessionId of [sessionId, keepSessionId]) {
            db.query(
                'INSERT INTO local_runtime_sessions (session_id, record_json, updated_at_ms) VALUES (?, ?, ?)',
            ).run(targetSessionId, JSON.stringify({ sessionId: targetSessionId, status: 'finished' }), 1);
            db.query(
                'INSERT INTO local_runtime_message_rows (id, session_id, msg_id, created_at_ms, data_json) VALUES (?, ?, ?, ?, ?)',
            ).run(targetSessionId === sessionId ? 1 : 2, targetSessionId, `${targetSessionId}-message`, 1, '{}');
            db.query(
                'INSERT INTO local_runtime_pi_history_rows (id, session_id, created_at_ms, data_json) VALUES (?, ?, ?, ?)',
            ).run(targetSessionId === sessionId ? 1 : 2, targetSessionId, 1, '{}');
            db.query(
                'INSERT INTO local_runtime_token_usage (id, session_id, agent_name, framework_type, ts, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ).run(targetSessionId === sessionId ? 1 : 2, targetSessionId, 'main', 'pi-agent', 1, 1, 1, 1, 1, 1);
            db.query(
                'INSERT INTO local_runtime_turn_diffs (change_set_id, session_id, turn_id, workspace_dir, captured_at_ms, status, file_changes_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
            ).run(
                `${targetSessionId}-change`,
                targetSessionId,
                `${targetSessionId}-turn`,
                '/workspace',
                1,
                'active',
                '[]',
            );
            db.query(
                'INSERT INTO local_runtime_session_assets (id, session_id, msg_id, message_created_at_ms, asset_index, asset_key, source_tag, path, data_json, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ).run(
                targetSessionId === sessionId ? 1 : 2,
                targetSessionId,
                `${targetSessionId}-message`,
                1,
                0,
                `${targetSessionId}-asset`,
                'tool',
                targetSessionId === sessionId
                    ? (assetPath ?? `/workspace/${targetSessionId}.md`)
                    : `/workspace/${targetSessionId}.md`,
                '{}',
                1,
                1,
            );
        }
        db.query(
            'INSERT INTO local_runtime_communication_messages (message_id, from_session, to_session, command, content, status, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run('communication-target', sessionId, keepSessionId, 'send', 'hello', 'done', 1);
        db.query(
            'INSERT INTO local_runtime_communication_messages (message_id, from_session, to_session, command, content, status, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run('communication-keep', keepSessionId, keepSessionId, 'send', 'keep', 'done', 1);
        db.query(
            'INSERT INTO local_runtime_background_tasks (task_id, owner_session_id, kind, status, created_at_ms, updated_at_ms, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run('task-target', sessionId, 'shell', 'finished', 1, 1, '{}');
        db.query(
            'INSERT INTO local_runtime_background_task_events (id, event_id, task_id, owner_session_id, type, timestamp_ms) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(1, 'event-target', 'task-target', sessionId, 'finished', 1);
        db.query(
            'INSERT INTO local_runtime_legacy_migrations (legacy_session_id, local_session_id, source_runtime, status, migrated_at_ms) VALUES (?, ?, ?, ?, ?)',
        ).run('legacy-target', sessionId, 'legacy', 'finished', 1);
        db.query(
            'INSERT INTO local_runtime_legacy_migrations (legacy_session_id, local_session_id, source_runtime, status, migrated_at_ms, legacy_daemon_session_id) VALUES (?, ?, ?, ?, ?, ?)',
        ).run('legacy-daemon-target', 'local-daemon-target', 'legacy', 'finished', 1, sessionId);
        db.query(
            'INSERT INTO local_runtime_legacy_migrations (legacy_session_id, local_session_id, source_runtime, status, migrated_at_ms, legacy_framework_session_id) VALUES (?, ?, ?, ?, ?, ?)',
        ).run('legacy-framework-target', 'local-framework-target', 'legacy', 'finished', 1, sessionId);
        if (locked) {
            db.query(
                'INSERT INTO local_runtime_session_locks (session_id, owner_id, owner_kind, acquired_at_ms, expires_at_ms) VALUES (?, ?, ?, ?, ?)',
            ).run(sessionId, 'owner', 'turn', 1, Date.now() + 60_000);
        }
    } finally {
        db.close();
    }

    return { keepSessionId: 'mvs_keep' };
};

const writeJson = async (filePath: string, value: unknown) => {
    await Bun.write(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

export const writeMiniMaxCodeSessionFixture = async ({
    sessionId = MINIMAX_CODE_SESSION_ID,
    sessionsDir,
    workspacePath,
}: {
    sessionId?: string;
    sessionsDir: string;
    workspacePath: string;
}) => {
    const encodedSessionId = Buffer.from(sessionId).toString('base64').replace(/=+$/u, '');
    const sessionDir = path.join(sessionsDir, '2026', '07', '22', `21-38-36-307-session_${encodedSessionId}`);
    await mkdir(sessionDir, { recursive: true });

    await writeJson(path.join(sessionDir, 'manifest.json'), {
        createdAtMs: 1_784_770_716_307,
        layout: 'v2-final-dated-session',
        paths: {
            display: path.join(sessionDir, 'display.jsonl'),
            ledger: path.join(sessionDir, 'ledger.jsonl'),
            reports: path.join(sessionDir, 'reports'),
            sessionDir,
            snapshot: path.join(sessionDir, 'snapshot.json'),
        },
        schemaVersion: 1,
        sessionId,
        source: 'local-runtime',
        updatedAtMs: 1_784_771_171_856,
    });

    await writeJson(path.join(sessionDir, 'snapshot.json'), {
        createdAtMs: 1_784_771_171_852,
        deleted: false,
        displayMessages: [
            {
                msg_content:
                    'Come up with a plan to decompose and refactor src/cleanup-briefs/rename-evidence/evidence-extraction.ts.',
                msg_id: 'user-1',
                msg_type: 1,
                role: 'user',
                timestamp: 1_784_770_716_404,
            },
            {
                finish_reason: 'toolUse',
                msg_content: "I'll investigate this thoroughly before sketching a plan.",
                msg_id: 'assistant-progress',
                msg_type: 2,
                role: 'assistant',
                thinking_content: "I need the complete picture. Let me also look at what's imported.",
                thinking_duration_ms: 1_229,
                timestamp: 1_784_770_724_176,
                tool_calls: [
                    {
                        tool_call_args: JSON.stringify({
                            command: 'grep -rn "evidence-extraction" /Users/rhaq/workspace/ushman/CHANGELOG.md',
                        }),
                        tool_call_id: 'call-success',
                        tool_call_result_data: JSON.stringify({
                            content: [{ text: 'CHANGELOG.md:42:evidence-extraction', type: 'text' }],
                            details: {},
                        }),
                        tool_call_status: 2,
                        tool_name: 'bash',
                    },
                ],
            },
            {
                finish_reason: 'toolUse',
                msg_content: '',
                msg_id: 'assistant-retry',
                msg_type: 2,
                role: 'assistant',
                thinking_content: 'That path was wrong, so I will retry from the workspace root.',
                timestamp: 1_784_770_725_176,
                tool_calls: [
                    {
                        tool_call_args: JSON.stringify({ command: 'grep -rn missing-file .' }),
                        tool_call_id: 'call-failed',
                        tool_call_result_data: JSON.stringify({
                            content: [{ text: 'Command exited with code 1', type: 'text' }],
                            details: {},
                        }),
                        tool_call_status: 3,
                        tool_name: 'bash',
                    },
                ],
            },
            {
                msg_content: JSON.stringify([{ content: 'Inspect module boundaries', status: 'completed' }]),
                msg_id: 'local_todo_1',
                msg_type: 3,
            },
            {
                finish_reason: 'stop',
                msg_content: 'The detailed decomposition plan is ready.',
                msg_id: 'assistant-final',
                msg_type: 1,
                role: 'assistant',
                timestamp: 1_784_771_171_421,
                tool_calls: [],
            },
        ],
        piHistory: [],
        piHistoryFacts: true,
        record: {
            agentName: 'main',
            appMode: 'coding',
            archived: false,
            createdAtMs: 1_784_770_716_307,
            effectiveModel: 'minimax/MiniMax-M3',
            effectiveModelVariant: 'thinking',
            isDefaultWorkspace: false,
            origin: 'user',
            parentSessionId: null,
            runtime: 'pi-agent',
            sessionDataVersion: 3,
            sessionId,
            sessionOrigin: 'local-runtime',
            sessionType: 'branch',
            status: 'finished',
            title: 'Refactor evidence extraction module',
            updatedAtMs: 1_784_771_171_843,
            workspaceDir: workspacePath,
        },
        schemaVersion: 1,
        sessionId,
        snapshotId: 'snapshot-1',
        watermark: {
            byteOffset: 1,
            lastEventId: 'event-1',
            lastSeq: 1,
            sessionId,
            updatedAtMs: 1_784_771_171_856,
        },
    });

    return {
        sessionDir,
        sessionId,
        snapshotPath: path.join(sessionDir, 'snapshot.json'),
        workspaceKey: `${MINIMAX_CODE_WORKSPACE_KEY_PREFIX}${encodeURIComponent(workspacePath)}`,
    };
};
