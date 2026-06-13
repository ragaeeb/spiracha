import { Database } from 'bun:sqlite';
import { mkdir, utimes } from 'node:fs/promises';
import path from 'node:path';

export type CodexFixture = {
    cwd: string;
    dbPath: string;
    inputDir: string;
    outputDir: string;
    sessionFile: string;
    threadId: string;
};

export type BrowserFixtureThread = {
    cwd: string;
    project: string;
    sessionFile: string;
    threadId: string;
    title: string;
};

export type CodexBrowserFixture = {
    dbPath: string;
    inputDir: string;
    outputDir: string;
    projects: string[];
    threads: BrowserFixtureThread[];
};

type BrowserFixtureThreadDefinition = {
    archived?: number;
    assistantText: string;
    createdAt: number;
    cwd: string;
    firstUserMessage: string;
    isoDate: string;
    model: string;
    project: string;
    threadId: string;
    title: string;
    tokensUsed: number;
    updatedAt: number;
};

type SessionMetaPayload = {
    cli_version: string;
    cwd: string;
    dynamic_tools?: unknown[];
    git?: Record<string, string | null>;
    id: string;
    model_provider?: string;
    originator: string;
    source: string;
    thread_source?: string;
    timestamp: string;
};

type ThreadInsert = {
    agentNickname?: string | null;
    agentPath?: string | null;
    agentRole?: string | null;
    approvalMode?: string;
    archived?: number;
    archivedAt?: number | null;
    cliVersion?: string;
    createdAt: number;
    createdAtMs?: number | null;
    cwd: string;
    firstUserMessage: string;
    gitBranch?: string | null;
    gitOriginUrl?: string | null;
    gitSha?: string | null;
    hasUserEvent?: number;
    memoryMode?: string;
    model?: string | null;
    modelProvider?: string;
    preview?: string;
    reasoningEffort?: string | null;
    rolloutPath: string;
    sandboxPolicy?: string;
    source?: string;
    threadId: string;
    threadSource?: string | null;
    title: string;
    tokensUsed?: number;
    updatedAt: number;
    updatedAtMs?: number | null;
};

const createBaseFixturePaths = (tempRoot: string) => {
    return {
        dbPath: path.join(tempRoot, 'state.sqlite'),
        inputDir: path.join(tempRoot, 'sessions'),
        outputDir: path.join(tempRoot, 'exports'),
    };
};

const buildSessionFilePath = (inputDir: string, isoDate: string, threadId: string) => {
    const [datePart, timePart] = isoDate.split('T');
    const [year, month, day] = datePart.split('-');
    const safeTime = timePart.replaceAll(':', '-').replace('Z', '');
    return path.join(inputDir, year, month, day, `rollout-${datePart}T${safeTime}-${threadId}.jsonl`);
};

const createDbSchema = (db: Database) => {
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
            tokens_used INTEGER NOT NULL DEFAULT 0,
            has_user_event INTEGER NOT NULL DEFAULT 0,
            archived INTEGER NOT NULL DEFAULT 0,
            archived_at INTEGER,
            git_sha TEXT,
            git_branch TEXT,
            git_origin_url TEXT,
            cli_version TEXT NOT NULL DEFAULT '',
            first_user_message TEXT NOT NULL DEFAULT '',
            agent_nickname TEXT,
            agent_role TEXT,
            memory_mode TEXT NOT NULL DEFAULT 'enabled',
            model TEXT,
            reasoning_effort TEXT,
            agent_path TEXT,
            created_at_ms INTEGER,
            updated_at_ms INTEGER,
            thread_source TEXT,
            preview TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE thread_spawn_edges (
            parent_thread_id TEXT NOT NULL,
            child_thread_id TEXT NOT NULL,
            status TEXT NOT NULL
        );

        CREATE TABLE thread_dynamic_tools (
            thread_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            input_schema TEXT NOT NULL,
            defer_loading INTEGER NOT NULL DEFAULT 0,
            namespace TEXT
        );

        CREATE TABLE thread_goals (
            thread_id TEXT NOT NULL,
            goal_id TEXT NOT NULL,
            objective TEXT NOT NULL,
            status TEXT NOT NULL,
            token_budget INTEGER,
            tokens_used INTEGER NOT NULL DEFAULT 0,
            time_used_seconds INTEGER NOT NULL DEFAULT 0,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
    `);
};

const normalizeThreadIdentity = (input: ThreadInsert) => {
    return {
        agentNickname: input.agentNickname ?? null,
        agentPath: input.agentPath ?? null,
        agentRole: input.agentRole ?? null,
        gitBranch: input.gitBranch ?? 'main',
        gitOriginUrl: input.gitOriginUrl ?? null,
        gitSha: input.gitSha ?? null,
        model: input.model ?? 'gpt-5.4',
        modelProvider: input.modelProvider ?? 'openai',
    };
};

const normalizeThreadRuntime = (input: ThreadInsert) => {
    return {
        approvalMode: input.approvalMode ?? 'never',
        archived: input.archived ?? 0,
        archivedAt: input.archivedAt ?? null,
        cliVersion: input.cliVersion ?? '0.1.0',
        hasUserEvent: input.hasUserEvent ?? 1,
        memoryMode: input.memoryMode ?? 'enabled',
        reasoningEffort: input.reasoningEffort ?? 'high',
        sandboxPolicy: input.sandboxPolicy ?? JSON.stringify({ type: 'danger-full-access' }),
        source: input.source ?? 'vscode',
        tokensUsed: input.tokensUsed ?? 0,
    };
};

const normalizeThreadDerivedValues = (input: ThreadInsert) => {
    return {
        createdAtMs: input.createdAtMs ?? input.createdAt * 1000,
        preview: input.preview ?? input.firstUserMessage,
        threadSource: input.threadSource ?? 'user',
        updatedAtMs: input.updatedAtMs ?? input.updatedAt * 1000,
    };
};

const insertThread = (db: Database, input: ThreadInsert) => {
    const normalized = {
        ...normalizeThreadIdentity(input),
        ...normalizeThreadRuntime(input),
        ...normalizeThreadDerivedValues(input),
    };
    db.prepare(`
        INSERT INTO threads (
            id,
            rollout_path,
            created_at,
            updated_at,
            source,
            model_provider,
            cwd,
            title,
            sandbox_policy,
            approval_mode,
            tokens_used,
            has_user_event,
            archived,
            archived_at,
            git_sha,
            git_branch,
            git_origin_url,
            cli_version,
            first_user_message,
            agent_nickname,
            agent_role,
            memory_mode,
            model,
            reasoning_effort,
            agent_path,
            created_at_ms,
            updated_at_ms,
            thread_source,
            preview
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        input.threadId,
        input.rolloutPath,
        input.createdAt,
        input.updatedAt,
        normalized.source,
        normalized.modelProvider,
        input.cwd,
        input.title,
        normalized.sandboxPolicy,
        normalized.approvalMode,
        normalized.tokensUsed,
        normalized.hasUserEvent,
        normalized.archived,
        normalized.archivedAt,
        normalized.gitSha,
        normalized.gitBranch,
        normalized.gitOriginUrl,
        normalized.cliVersion,
        input.firstUserMessage,
        normalized.agentNickname,
        normalized.agentRole,
        normalized.memoryMode,
        normalized.model,
        normalized.reasoningEffort,
        normalized.agentPath,
        normalized.createdAtMs,
        normalized.updatedAtMs,
        normalized.threadSource,
        normalized.preview,
    );
};

const insertDynamicTools = (db: Database, threadId: string, tools: Array<{ description: string; name: string }>) => {
    const statement = db.prepare(`
        INSERT INTO thread_dynamic_tools (
            thread_id,
            position,
            name,
            description,
            input_schema,
            defer_loading,
            namespace
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const [index, tool] of tools.entries()) {
        statement.run(
            threadId,
            index,
            tool.name,
            tool.description,
            JSON.stringify({ additionalProperties: false, properties: {}, type: 'object' }),
            0,
            tool.name.includes('.') ? tool.name.split('.')[0] : null,
        );
    }
};

const writeSessionFile = async (sessionFile: string, records: unknown[]) => {
    await mkdir(path.dirname(sessionFile), { recursive: true });
    await Bun.write(sessionFile, records.map((record) => JSON.stringify(record)).join('\n'));
};

const buildBasicRecords = (sessionMeta: SessionMetaPayload, userText: string, assistantText: string) => {
    return [
        {
            payload: sessionMeta,
            type: 'session_meta',
        },
        {
            payload: {
                content: [{ text: userText, type: 'input_text' }],
                role: 'user',
                type: 'message',
            },
            type: 'response_item',
        },
        {
            payload: {
                content: [{ text: assistantText, type: 'output_text' }],
                model: 'gpt-5.4',
                role: 'assistant',
                type: 'message',
            },
            type: 'response_item',
        },
        {
            payload: {
                arguments: JSON.stringify({
                    cmd: 'echo hi',
                    workdir: sessionMeta.cwd,
                }),
                call_id: 'call_1',
                name: 'exec_command',
                type: 'function_call',
            },
            type: 'response_item',
        },
        {
            payload: {
                call_id: 'call_1',
                output: ['Command: echo hi', 'Process exited with code 0', 'Wall time: 0.1 seconds'].join('\n'),
                type: 'function_call_output',
            },
            type: 'response_item',
        },
    ];
};

const buildRichRecords = (sessionMeta: SessionMetaPayload, userText: string, assistantText: string) => {
    return [
        {
            payload: sessionMeta,
            timestamp: sessionMeta.timestamp,
            type: 'session_meta',
        },
        {
            payload: {
                approval_policy: 'never',
                collaboration_mode: {
                    mode: 'default',
                    settings: {
                        model: 'gpt-5.4',
                        reasoning_effort: 'low',
                    },
                },
                current_date: '2026-05-17',
                cwd: sessionMeta.cwd,
                model: 'gpt-5.4',
                permission_profile: { type: 'disabled' },
                sandbox_policy: { type: 'danger-full-access' },
                summary: 'none',
                timezone: 'America/Toronto',
                turn_id: `${sessionMeta.id}-turn-1`,
                user_instructions: 'Use rtk for shell commands.',
            },
            timestamp: sessionMeta.timestamp,
            type: 'turn_context',
        },
        {
            payload: {
                collaboration_mode_kind: 'default',
                model_context_window: 950000,
                started_at: 1779036805,
                turn_id: `${sessionMeta.id}-turn-1`,
                type: 'task_started',
            },
            timestamp: sessionMeta.timestamp,
            type: 'event_msg',
        },
        {
            payload: {
                images: [],
                local_images: [],
                message: `${userText}\n`,
                text_elements: [],
                type: 'user_message',
            },
            timestamp: sessionMeta.timestamp,
            type: 'response_item',
        },
        {
            payload: {
                content: [{ text: userText, type: 'input_text' }],
                role: 'user',
                type: 'message',
            },
            timestamp: sessionMeta.timestamp,
            type: 'response_item',
        },
        {
            payload: {
                memory_citation: null,
                message: 'Checking repo structure before planning.',
                model: 'gpt-5.4',
                phase: 'commentary',
                type: 'agent_message',
            },
            timestamp: sessionMeta.timestamp,
            type: 'response_item',
        },
        {
            payload: {
                content: [{ text: assistantText, type: 'output_text' }],
                model: 'gpt-5.4',
                phase: 'final_answer',
                role: 'assistant',
                type: 'message',
            },
            timestamp: sessionMeta.timestamp,
            type: 'response_item',
        },
        {
            payload: {
                info: null,
                rate_limits: {
                    limit_id: 'codex',
                    plan_type: 'free',
                    primary: {
                        resets_at: 1779603078,
                        used_percent: 20,
                        window_minutes: 10080,
                    },
                },
                type: 'token_count',
            },
            timestamp: sessionMeta.timestamp,
            type: 'response_item',
        },
        {
            payload: {
                arguments: JSON.stringify({
                    cmd: 'rtk bun test',
                    workdir: sessionMeta.cwd,
                }),
                call_id: 'call_exec_1',
                name: 'exec_command',
                type: 'function_call',
            },
            timestamp: sessionMeta.timestamp,
            type: 'response_item',
        },
        {
            payload: {
                arguments: JSON.stringify({
                    search_query: [{ q: 'tanstack start docs' }],
                }),
                call_id: 'call_web_1',
                name: 'web.run',
                type: 'function_call',
            },
            timestamp: sessionMeta.timestamp,
            type: 'response_item',
        },
        {
            payload: {
                call_id: 'call_exec_1',
                output: ['Command: rtk bun test', 'Process exited with code 0', 'Wall time: 0.2 seconds'].join('\n'),
                type: 'function_call_output',
            },
            timestamp: sessionMeta.timestamp,
            type: 'response_item',
        },
        {
            payload: {
                action: { type: 'search_query' },
                status: 'completed',
                type: 'web_search_call',
            },
            timestamp: sessionMeta.timestamp,
            type: 'response_item',
        },
        {
            payload: {
                action: { type: 'search_query' },
                call_id: 'ws_call_1',
                query: 'tanstack start docs',
                type: 'web_search_end',
            },
            timestamp: sessionMeta.timestamp,
            type: 'response_item',
        },
        {
            payload: {
                content: null,
                encrypted_content: 'encrypted',
                summary: ['Summarized reasoning step'],
                type: 'reasoning',
            },
            timestamp: sessionMeta.timestamp,
            type: 'response_item',
        },
        {
            payload: {
                completed_at: 1779036828,
                duration_ms: 22845,
                last_agent_message: assistantText,
                time_to_first_token_ms: 2227,
                turn_id: `${sessionMeta.id}-turn-1`,
                type: 'task_complete',
            },
            timestamp: sessionMeta.timestamp,
            type: 'event_msg',
        },
    ];
};

export const createCodexFixture = async (tempRoot: string): Promise<CodexFixture> => {
    const { dbPath, inputDir, outputDir } = createBaseFixturePaths(tempRoot);
    const threadId = '019da28f-ee5b-7881-afe0-68b3d3bd2c77';
    const cwd = '/tmp/summer';
    const sessionFile = buildSessionFilePath(inputDir, '2026-04-23T10:00:00.000Z', threadId);

    await writeSessionFile(
        sessionFile,
        buildBasicRecords(
            {
                cli_version: '0.1.0',
                cwd,
                id: threadId,
                originator: 'Codex Desktop',
                source: 'vscode',
                timestamp: '2026-04-23T10:00:00.000Z',
            },
            'export this',
            'done',
        ),
    );
    const mtime = new Date(1776948060 * 1000);
    await utimes(sessionFile, mtime, mtime);

    const db = new Database(dbPath);
    createDbSchema(db);
    insertThread(db, {
        createdAt: 1776948000,
        cwd,
        firstUserMessage: 'export this',
        rolloutPath: sessionFile,
        threadId,
        title: 'Test export',
        tokensUsed: 42,
        updatedAt: 1776948060,
    });
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

export const createCodexBrowserFixture = async (tempRoot: string): Promise<CodexBrowserFixture> => {
    const { dbPath, inputDir, outputDir } = createBaseFixturePaths(tempRoot);
    const db = new Database(dbPath);
    createDbSchema(db);

    const threads: BrowserFixtureThread[] = [];
    const definitions: BrowserFixtureThreadDefinition[] = [
        {
            assistantText:
                'Implemented /Users/example/workspace/spiracha/src/index.ts after reviewing /Users/other/workspace/other-project/docs/notes.md.',
            createdAt: 1779036500,
            cwd: '/Users/example/workspace/spiracha',
            firstUserMessage: 'Build the Spiracha UI',
            isoDate: '2026-05-17T16:49:28.109Z',
            model: 'gpt-5.4',
            project: 'spiracha',
            threadId: '019e36d7-ba2d-7fa1-b662-3f70fbbda248',
            title: 'Implement the Spiracha UI',
            tokensUsed: 460668,
            updatedAt: 1779037924,
        },
        {
            assistantText: 'Stabilized the transcript parsing and export formatting.',
            createdAt: 1779031000,
            cwd: '/Users/example/workspace/spiracha',
            firstUserMessage: 'Fix transcript parsing regressions',
            isoDate: '2026-05-17T15:10:00.000Z',
            model: 'gpt-5.5',
            project: 'spiracha',
            threadId: '019e33a9-a225-7433-b299-6cb1ed299ffb',
            title: 'Fix transcript parsing regressions',
            tokensUsed: 180123,
            updatedAt: 1779033600,
        },
        {
            archived: 1,
            assistantText: 'Reviewed flaky fixture output and updated expectations.',
            createdAt: 1778990000,
            cwd: '/Users/example/workspace/shibuk',
            firstUserMessage: 'Review fixture failures',
            isoDate: '2026-05-16T20:00:00.000Z',
            model: 'gpt-5.4',
            project: 'shibuk',
            threadId: '019e348d-ac75-7e12-9582-35b0f9b74906',
            title: 'Review fixture failures',
            tokensUsed: 91000,
            updatedAt: 1778997684,
        },
    ];

    for (const definition of definitions) {
        const sessionFile = buildSessionFilePath(inputDir, definition.isoDate, definition.threadId);
        const sessionMeta = {
            cli_version: '0.131.0-alpha.9',
            cwd: definition.cwd,
            dynamic_tools: [
                {
                    description: 'Read the current terminal output.',
                    inputSchema: { additionalProperties: false, properties: {}, type: 'object' },
                    name: 'read_thread_terminal',
                },
                {
                    description: 'Run shell commands.',
                    inputSchema: {
                        additionalProperties: false,
                        properties: { cmd: { type: 'string' }, workdir: { type: 'string' } },
                        type: 'object',
                    },
                    name: 'exec_command',
                },
            ],
            git: {
                branch: 'main',
                commit_hash: '36ed476dc8418f2e02cd15c46fe824624801ed99',
                repository_url: 'git@github.com:ragaeeb/spiracha.git',
            },
            id: definition.threadId,
            model_provider: 'openai',
            originator: 'Codex Desktop',
            source: 'vscode',
            thread_source: 'user',
            timestamp: definition.isoDate,
        } satisfies SessionMetaPayload;

        await writeSessionFile(
            sessionFile,
            buildRichRecords(sessionMeta, definition.firstUserMessage, definition.assistantText),
        );
        const mtime = new Date(definition.updatedAt * 1000);
        await utimes(sessionFile, mtime, mtime);

        insertThread(db, {
            archived: definition.archived ?? 0,
            archivedAt: definition.archived ? definition.updatedAt : null,
            createdAt: definition.createdAt,
            cwd: definition.cwd,
            firstUserMessage: definition.firstUserMessage,
            model: definition.model,
            preview: definition.firstUserMessage,
            rolloutPath: sessionFile,
            threadId: definition.threadId,
            title: definition.title,
            tokensUsed: definition.tokensUsed,
            updatedAt: definition.updatedAt,
        });
        insertDynamicTools(db, definition.threadId, [
            { description: 'Read the current terminal output.', name: 'read_thread_terminal' },
            { description: 'Run shell commands.', name: 'exec_command' },
        ]);
        threads.push({
            cwd: definition.cwd,
            project: definition.project,
            sessionFile,
            threadId: definition.threadId,
            title: definition.title,
        });
    }

    db.prepare(`
        INSERT INTO thread_spawn_edges (
            parent_thread_id,
            child_thread_id,
            status
        ) VALUES (?, ?, ?)
    `).run(threads[0].threadId, threads[1].threadId, 'completed');

    db.close();

    return {
        dbPath,
        inputDir,
        outputDir,
        projects: ['shibuk', 'spiracha'],
        threads,
    };
};
