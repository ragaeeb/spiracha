import { Database } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export type CodexFixture = {
    dbPath: string;
    inputDir: string;
    outputDir: string;
    sessionFile: string;
    threadId: string;
    cwd: string;
};

export const createCodexFixture = async (tempRoot: string): Promise<CodexFixture> => {
    const dbPath = path.join(tempRoot, 'state.sqlite');
    const inputDir = path.join(tempRoot, 'sessions');
    const outputDir = path.join(tempRoot, 'exports');
    const sessionDir = path.join(inputDir, '2026', '04', '23');
    const threadId = '019da28f-ee5b-7881-afe0-68b3d3bd2c77';
    const cwd = '/tmp/summer';
    const sessionFile = path.join(sessionDir, `rollout-2026-04-23T10-00-00-${threadId}.jsonl`);

    await mkdir(sessionDir, { recursive: true });
    await Bun.write(
        sessionFile,
        [
            JSON.stringify({
                payload: {
                    cli_version: '0.1.0',
                    cwd,
                    id: threadId,
                    originator: 'Codex Desktop',
                    source: 'vscode',
                    timestamp: '2026-04-23T10:00:00.000Z',
                },
                type: 'session_meta',
            }),
            JSON.stringify({
                payload: {
                    content: [{ text: 'export this', type: 'input_text' }],
                    role: 'user',
                    type: 'message',
                },
                type: 'response_item',
            }),
            JSON.stringify({
                payload: {
                    content: [{ text: 'done', type: 'output_text' }],
                    role: 'assistant',
                    type: 'message',
                },
                type: 'response_item',
            }),
            JSON.stringify({
                payload: {
                    arguments: JSON.stringify({
                        cmd: 'echo hi',
                        workdir: cwd,
                    }),
                    call_id: 'call_1',
                    name: 'exec_command',
                    type: 'function_call',
                },
                type: 'response_item',
            }),
            JSON.stringify({
                payload: {
                    call_id: 'call_1',
                    output: ['Command: echo hi', 'Process exited with code 0', 'Wall time: 0.1 seconds'].join('\n'),
                    type: 'function_call_output',
                },
                type: 'response_item',
            }),
        ].join('\n'),
    );

    const db = new Database(dbPath);
    db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      model_provider TEXT NOT NULL,
      cwd TEXT NOT NULL,
      title TEXT NOT NULL,
      sandbox_policy TEXT NOT NULL,
      approval_mode TEXT NOT NULL,
      tokens_used INTEGER NOT NULL,
      has_user_event INTEGER NOT NULL,
      archived INTEGER NOT NULL,
      archived_at INTEGER,
      git_sha TEXT,
      git_branch TEXT,
      git_origin_url TEXT,
      cli_version TEXT NOT NULL,
      first_user_message TEXT NOT NULL,
      agent_nickname TEXT,
      agent_role TEXT,
      memory_mode TEXT NOT NULL,
      model TEXT,
      reasoning_effort TEXT,
      agent_path TEXT
    );
    CREATE TABLE thread_spawn_edges (
      parent_thread_id TEXT NOT NULL,
      child_thread_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `);
    db.prepare(`
      INSERT INTO threads (
        id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
        sandbox_policy, approval_mode, tokens_used, has_user_event, archived, archived_at,
        git_sha, git_branch, git_origin_url, cli_version, first_user_message,
        agent_nickname, agent_role, memory_mode, model, reasoning_effort, agent_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        threadId,
        sessionFile,
        1776948000,
        1776948060,
        'vscode',
        'openai',
        cwd,
        'Test export',
        JSON.stringify({ type: 'danger-full-access' }),
        'never',
        42,
        1,
        0,
        null,
        null,
        'main',
        null,
        '0.1.0',
        'export this',
        null,
        null,
        'enabled',
        'gpt-5.4',
        'high',
        null,
    );
    db.close();

    return {
        cwd,
        dbPath,
        inputDir,
        outputDir,
        sessionFile,
        threadId,
    };
};
