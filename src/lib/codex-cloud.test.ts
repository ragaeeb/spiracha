import { describe, expect, it } from 'bun:test';
import type { MessageEvent } from './codex-browser-types';
import {
    type CodexCloudAuth,
    type CodexCloudTaskDetail,
    type CodexCloudTurn,
    createCodexCloudClient,
    mapCodexCloudTurnEvents,
    normalizeCodexCloudTask,
    renderCodexCloudExport,
} from './codex-cloud';
import type { JsonValue } from './shared';

const auth: CodexCloudAuth = {
    accessToken: 'access-token',
    accountId: 'account-id',
};

const jsonResponse = (value: JsonValue, status = 200) =>
    new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json' },
        status,
    });

describe('Codex Cloud client', () => {
    it('should list all pages with the current-task filter and stop at a repeated cursor', async () => {
        const requests: URL[] = [];
        const client = createCodexCloudClient({
            fetchImpl: async (input) => {
                const url = new URL(input.toString());
                requests.push(url);
                if (!url.searchParams.has('cursor')) {
                    return jsonResponse({
                        cursor: 'next-cursor',
                        items: [
                            {
                                environment_label: 'owner/alpha',
                                id: 'task_e_1',
                                status: 'ready',
                                title: 'First task',
                                updated_at: '2026-01-01T00:00:00.000Z',
                            },
                        ],
                    });
                }

                return jsonResponse({
                    cursor: 'next-cursor',
                    items: [
                        {
                            environment_label: 'owner/beta',
                            id: 'task_e_2',
                            status: 'error',
                            title: 'Second task',
                            updated_at: '2026-01-02T00:00:00.000Z',
                        },
                    ],
                });
            },
            readAuth: async () => auth,
        });

        const result = await client.listTasks();

        expect(result.tasks.map((task) => task.id)).toEqual(['task_e_1', 'task_e_2']);
        expect(result.partial).toBe(true);
        expect(requests).toHaveLength(2);
        expect(requests[0]?.searchParams.get('task_filter')).toBe('current');
        expect(requests[0]?.searchParams.get('limit')).toBe('20');
        expect(requests[1]?.searchParams.get('cursor')).toBe('next-cursor');
    });

    it('should accept the normalized CLI list shape with project and diff metadata', async () => {
        const client = createCodexCloudClient({
            listCommandImpl: async () => ({
                cursor: null,
                tasks: [
                    {
                        environment_label: 'owner/project',
                        id: 'task_e_1',
                        status: 'ready',
                        summary: { files_changed: 2, lines_added: 5, lines_removed: 1 },
                        title: 'Cloud task',
                        updated_at: '2026-01-01T00:00:00.000Z',
                    },
                ],
            }),
            readAuth: async () => auth,
        });

        const result = await client.listTasks();
        const task = normalizeCodexCloudTask({
            environment_label: 'owner/project',
            id: 'task_e_1',
            status: 'ready',
            summary: { files_changed: 2, lines_added: 5, lines_removed: 1 },
            title: 'Cloud task',
            updated_at: '2026-01-01T00:00:00.000Z',
        });

        expect(result.tasks).toHaveLength(1);
        expect(result.tasks[0]?.environmentLabel).toBe('owner/project');
        expect(task?.diffStats).toEqual({ filesModified: 2, linesAdded: 5, linesRemoved: 1 });
    });

    it('should group CLI task summaries by project without loading task transcripts', async () => {
        const requests: URL[] = [];
        const client = createCodexCloudClient({
            fetchImpl: async (input) => {
                requests.push(new URL(input.toString()));
                return jsonResponse({});
            },
            listCommandImpl: async () => ({
                cursor: null,
                tasks: [
                    { environment_label: 'owner/alpha', id: 'task_e_1', title: 'Alpha', updated_at: 1 },
                    { environment_label: 'owner/beta', id: 'task_e_2', title: 'Beta', updated_at: 2 },
                ],
            }),
            readAuth: async () => auth,
        });

        const projects = await client.listProjects();

        expect(projects.map((project) => project.label).sort()).toEqual(['owner/alpha', 'owner/beta']);
        expect(projects.every((project) => project.id.startsWith('label:'))).toBe(true);
        expect(requests).toHaveLength(0);
    });

    it('should keep unlabeled environments in separate Cloud projects', async () => {
        const client = createCodexCloudClient({
            listCommandImpl: async () => ({
                cursor: null,
                tasks: [
                    { environment_id: 'environment-a', id: 'task_e_1', title: 'Alpha' },
                    { environment_id: 'environment-b', id: 'task_e_2', title: 'Beta' },
                ],
            }),
            readAuth: async () => auth,
        });

        const projects = await client.listProjects();

        expect(projects.map((project) => project.id).sort()).toEqual(['environment-a', 'environment-b']);
        expect(projects.map((project) => project.taskCount).sort()).toEqual([1, 1]);
    });

    it('should refresh once after an unauthorized response without exposing credentials', async () => {
        let requestCount = 0;
        let refreshCount = 0;
        const client = createCodexCloudClient({
            fetchImpl: async () => {
                requestCount += 1;
                return requestCount === 1
                    ? new Response('secret response body', { status: 401 })
                    : jsonResponse({ cursor: null, items: [] });
            },
            readAuth: async () => auth,
            refreshAuth: async () => {
                refreshCount += 1;
            },
        });

        await expect(client.listTasks()).resolves.toMatchObject({ tasks: [] });
        expect(requestCount).toBe(2);
        expect(refreshCount).toBe(1);
    });

    it('should map only completed canonical events and preserve one terminal final answer', () => {
        const turn: CodexCloudTurn = {
            branch: null,
            createdAt: null,
            environmentId: null,
            environmentLabel: null,
            id: 'turn-1',
            model: null,
            status: 'completed',
            threadEvents: {
                events: [
                    {
                        method: 'item/started',
                        params: { item: { id: 'user-1', type: 'userMessage' } },
                    },
                    {
                        method: 'item/completed',
                        params: {
                            item: {
                                content: [{ text: 'Build it', type: 'text' }],
                                id: 'user-1',
                                type: 'userMessage',
                            },
                        },
                    },
                    {
                        method: 'rawResponseItem/completed',
                        params: {
                            item: {
                                encrypted_content: 'encrypted',
                                id: 'reasoning-1',
                                summary: ['Inspecting the repository'],
                                type: 'reasoning',
                            },
                        },
                    },
                    {
                        method: 'rawResponseItem/completed',
                        params: {
                            item: {
                                arguments: '{"command":"ls"}',
                                call_id: 'call-1',
                                name: 'exec_command',
                                type: 'function_call',
                            },
                        },
                    },
                    {
                        method: 'item/completed',
                        params: {
                            item: {
                                aggregatedOutput: 'ok',
                                command: 'ls',
                                cwd: '/tmp',
                                exitCode: 0,
                                id: 'command-1',
                                status: 'completed',
                                type: 'commandExecution',
                            },
                        },
                    },
                    {
                        method: 'item/completed',
                        params: {
                            item: {
                                changes: [{ path: 'src/index.ts' }],
                                id: 'file-1',
                                type: 'fileChange',
                            },
                        },
                    },
                    {
                        method: 'item/completed',
                        params: {
                            item: {
                                id: 'agent-1',
                                text: 'Earlier update',
                                type: 'agentMessage',
                            },
                        },
                    },
                    {
                        method: 'rawResponseItem/completed',
                        params: {
                            item: {
                                content: [{ text: 'Duplicate final', type: 'output_text' }],
                                id: 'raw-final',
                                role: 'assistant',
                                type: 'message',
                            },
                        },
                    },
                    {
                        method: 'item/completed',
                        params: {
                            item: {
                                id: 'agent-2',
                                phase: null,
                                text: 'Final answer',
                                type: 'agentMessage',
                            },
                        },
                    },
                    {
                        method: 'turn/completed',
                        params: { status: 'completed', turn_id: 'turn-1' },
                    },
                ],
            },
        };

        const events = mapCodexCloudTurnEvents(turn);
        const messages = events.filter((event) => event.kind === 'message');

        expect(messages.filter((event) => !event.isHiddenByDefault).map((event) => event.text)).toEqual([
            'Build it',
            'Earlier update',
            'Final answer',
        ]);
        expect(messages.filter((event) => event.phase === 'final_answer')).toHaveLength(1);
        expect(messages.at(-1)?.phase).toBe('final_answer');
        expect(events.filter((event) => event.kind === 'reasoning')).toHaveLength(1);
        expect(events.filter((event) => event.kind === 'tool_call')).toHaveLength(1);
        expect(events.filter((event) => event.kind === 'tool_output')).toHaveLength(1);
        expect(events.filter((event) => event.kind === 'task_complete')).toHaveLength(1);
        expect(JSON.stringify(events)).not.toContain('encrypted');
    });

    it('should pair every completed command with a tool call when raw calls are absent', () => {
        const turn: CodexCloudTurn = {
            branch: null,
            createdAt: null,
            environmentId: null,
            environmentLabel: null,
            id: 'turn-1',
            model: null,
            status: 'completed',
            threadEvents: {
                events: [
                    {
                        method: 'item/completed',
                        params: { item: { command: 'pwd', id: 'command-1', type: 'commandExecution' } },
                    },
                    {
                        method: 'item/completed',
                        params: { item: { command: 'ls', id: 'command-2', type: 'commandExecution' } },
                    },
                ],
            },
        };

        const events = mapCodexCloudTurnEvents(turn);

        expect(events.filter((event) => event.kind === 'tool_call')).toHaveLength(2);
        expect(events.filter((event) => event.kind === 'tool_output')).toHaveLength(2);
    });

    it('should synthesize only the commands without a matching raw tool call', () => {
        const events = mapCodexCloudTurnEvents({
            branch: null,
            createdAt: null,
            environmentId: null,
            environmentLabel: null,
            id: 'turn-1',
            model: null,
            status: 'completed',
            threadEvents: {
                events: [
                    {
                        method: 'rawResponseItem/completed',
                        params: { item: { call_id: 'call-1', type: 'function_call' } },
                    },
                    {
                        method: 'item/completed',
                        params: { item: { command: 'first', id: 'call-1', type: 'commandExecution' } },
                    },
                    {
                        method: 'item/completed',
                        params: { item: { command: 'second', id: 'call-2', type: 'commandExecution' } },
                    },
                ],
            },
        });

        expect(events.filter((event) => event.kind === 'tool_call')).toHaveLength(2);
    });

    it('should prefer canonical reasoning and command output over mirrored raw events', () => {
        const turn: CodexCloudTurn = {
            branch: null,
            createdAt: null,
            environmentId: null,
            environmentLabel: null,
            id: 'turn-1',
            model: null,
            status: 'completed',
            threadEvents: {
                events: [
                    {
                        method: 'item/completed',
                        params: { item: { id: 'reasoning-1', summary: ['Inspecting'], type: 'reasoning' } },
                    },
                    {
                        method: 'rawResponseItem/completed',
                        params: { item: { id: 'raw-reasoning-1', summary: ['Inspecting'], type: 'reasoning' } },
                    },
                    {
                        method: 'rawResponseItem/completed',
                        params: { item: { arguments: '{"command":"ls"}', call_id: 'call-1', type: 'function_call' } },
                    },
                    {
                        method: 'rawResponseItem/completed',
                        params: { item: { call_id: 'call-1', output: 'raw output', type: 'function_call_output' } },
                    },
                    {
                        method: 'item/completed',
                        params: {
                            item: {
                                aggregatedOutput: 'canonical output',
                                command: 'ls',
                                exitCode: 0,
                                id: 'call-1',
                                type: 'commandExecution',
                            },
                        },
                    },
                ],
            },
        };

        const events = mapCodexCloudTurnEvents(turn);

        expect(events.filter((event) => event.kind === 'reasoning')).toHaveLength(1);
        expect(events.filter((event) => event.kind === 'tool_call')).toHaveLength(1);
        expect(events.filter((event) => event.kind === 'tool_output')).toHaveLength(1);
        expect(events.find((event) => event.kind === 'tool_output')?.outputText).toBe('canonical output');
    });

    it('should use output items as the assistant fallback when a turn has other events', () => {
        const events = mapCodexCloudTurnEvents({
            branch: null,
            createdAt: null,
            environmentId: null,
            environmentLabel: null,
            id: 'turn-1',
            model: null,
            outputItems: [{ content: [{ text: 'Fallback answer' }], role: 'assistant', type: 'message' }],
            status: 'completed',
            threadEvents: {
                events: [
                    {
                        method: 'item/completed',
                        params: { item: { content: [{ text: 'Question' }], id: 'user-1', type: 'userMessage' } },
                    },
                ],
            },
        });

        expect(events.filter((event) => event.kind === 'message' && event.role === 'assistant')).toHaveLength(1);
        expect(
            events.find((event): event is MessageEvent => event.kind === 'message' && event.role === 'assistant')
                ?.phase,
        ).toBe('final_answer');
    });

    it('should not promote hidden file changes or in-progress commentary to a final answer', () => {
        const completedEvents = mapCodexCloudTurnEvents({
            branch: null,
            createdAt: null,
            environmentId: null,
            environmentLabel: null,
            id: 'turn-1',
            model: null,
            status: 'completed',
            threadEvents: {
                events: [
                    {
                        method: 'item/completed',
                        params: { item: { id: 'answer', text: 'Real answer', type: 'agentMessage' } },
                    },
                    {
                        method: 'item/completed',
                        params: { item: { changes: [{ path: 'file.ts' }], id: 'file', type: 'fileChange' } },
                    },
                    { method: 'turn/completed', params: { turn_id: 'turn-1' } },
                ],
            },
        });
        const inProgressEvents = mapCodexCloudTurnEvents({
            branch: null,
            createdAt: null,
            environmentId: null,
            environmentLabel: null,
            id: 'turn-2',
            model: null,
            status: 'in_progress',
            threadEvents: {
                events: [
                    {
                        method: 'item/completed',
                        params: { item: { id: 'update', phase: 'commentary', text: 'Working', type: 'agentMessage' } },
                    },
                ],
            },
        });

        expect(
            completedEvents.find(
                (event): event is MessageEvent => event.kind === 'message' && event.text === 'Real answer',
            )?.phase,
        ).toBe('final_answer');
        expect(
            completedEvents.find(
                (event): event is MessageEvent => event.kind === 'message' && event.text.startsWith('Changed files'),
            )?.phase,
        ).not.toBe('final_answer');
        expect(
            inProgressEvents.some(
                (event): event is MessageEvent => event.kind === 'message' && event.phase === 'final_answer',
            ),
        ).toBe(false);
    });

    it('should allow a task detail response without leaking environment secrets', async () => {
        const client = createCodexCloudClient({
            fetchImpl: async () =>
                jsonResponse({
                    current_assistant_turn: {
                        branch_name: 'main',
                        environment: {
                            env_vars: { SECRET: 'do-not-leak' },
                            label: 'owner/project',
                            secrets: { token: 'do-not-leak' },
                        },
                        environment_id: 'environment-1',
                        id: 'turn-1',
                        status: 'completed',
                        thread_events: { events: [] },
                    },
                    task: {
                        denormalized_metadata: {
                            diff_stats: { files_modified: 1, lines_added: 2, lines_removed: 0 },
                        },
                        id: 'task_e_1',
                        title: 'Secure task',
                    },
                }),
            readAuth: async () => auth,
        });

        const detail = await client.getTask('task_e_1');
        const serialized = JSON.stringify(detail.safeJson);

        expect(detail.environmentLabel).toBe('owner/project');
        expect(detail.environmentId).toBe('environment-1');
        expect(serialized).not.toContain('do-not-leak');
        expect(serialized).not.toContain('env_vars');
        expect(serialized).not.toContain('secrets');
    });

    it('should read diff patch and stats from the current diff turn', async () => {
        const client = createCodexCloudClient({
            fetchImpl: async () =>
                jsonResponse({
                    current_assistant_turn: {
                        id: 'turn-1',
                        status: 'completed',
                        thread_events: { events: [] },
                    },
                    current_diff_task_turn: {
                        output_items: [
                            {
                                output_diff: {
                                    diff: 'diff --git a/file.ts b/file.ts',
                                    files_modified: 1,
                                    lines_added: 2,
                                    lines_removed: 3,
                                },
                                type: 'pr',
                            },
                        ],
                    },
                    task: { id: 'task_e_1', title: 'Diff task' },
                }),
            readAuth: async () => auth,
        });

        const detail = await client.getTask('task_e_1');

        expect(detail.diff.patch).toContain('diff --git');
        expect(detail.diff.stats).toEqual({ filesModified: 1, linesAdded: 2, linesRemoved: 3 });
    });

    it('should render filtered Markdown and plain text exports from the normalized Cloud events', () => {
        const detail = {
            availableTools: [],
            branch: 'main',
            currentTurnId: 'turn-1',
            diff: {
                patch: 'diff --git a/file.ts b/file.ts',
                stats: { filesModified: 1, linesAdded: 2, linesRemoved: 3 },
            },
            environmentId: 'environment-1',
            environmentLabel: 'owner/project',
            events: [
                {
                    isHiddenByDefault: false,
                    kind: 'message',
                    memoryCitation: null,
                    model: null,
                    phase: null,
                    raw: {},
                    role: 'user',
                    sequence: 0,
                    text: 'Please fix it.',
                    timestamp: null,
                    variant: 'user_message',
                },
                {
                    isHiddenByDefault: false,
                    kind: 'message',
                    memoryCitation: null,
                    model: null,
                    phase: 'commentary',
                    raw: {},
                    role: 'assistant',
                    sequence: 1,
                    text: 'I am inspecting it.',
                    timestamp: null,
                    variant: 'agent_message',
                },
                {
                    argumentsParseFailed: false,
                    argumentsText: '{"command":"ls"}',
                    callId: 'call-1',
                    command: 'ls',
                    kind: 'tool_call',
                    name: 'exec_command',
                    raw: {},
                    sequence: 2,
                    timestamp: null,
                    workdir: '/tmp',
                },
                {
                    callId: 'call-1',
                    exitCode: 0,
                    kind: 'tool_output',
                    outputText: 'ok',
                    raw: {},
                    sequence: 3,
                    summary: 'ok',
                    timestamp: null,
                    wallTime: null,
                },
                {
                    isHiddenByDefault: false,
                    kind: 'message',
                    memoryCitation: null,
                    model: null,
                    phase: 'final_answer',
                    raw: {},
                    role: 'assistant',
                    sequence: 4,
                    text: 'Done.',
                    timestamp: null,
                    variant: 'agent_message',
                },
            ],
            model: 'gpt-5.6-sol',
            projectId: 'environment-1',
            projectLabel: 'owner/project',
            safeJson: {},
            status: 'completed',
            task: {
                createdAt: null,
                diffStats: { filesModified: null, linesAdded: null, linesRemoved: null },
                environmentId: 'environment-1',
                environmentLabel: 'owner/project',
                id: 'task_e_1',
                status: 'ready',
                taskUrl: 'https://chatgpt.com/codex/tasks/task_e_1',
                title: 'Fix it',
                updatedAt: '2026-01-01T00:00:00.000Z',
            },
        } satisfies CodexCloudTaskDetail;

        const markdown = renderCodexCloudExport(detail, {
            includeCommentary: false,
            includeMetadata: true,
            includeTools: false,
            outputFormat: 'md',
        });
        const plainText = renderCodexCloudExport(detail, {
            includeCommentary: true,
            includeMetadata: false,
            includeTools: true,
            outputFormat: 'txt',
        });

        expect(markdown).toContain('# Fix it');
        expect(markdown).toContain('Done.');
        expect(markdown).toContain('diff --git a/file.ts b/file.ts');
        expect(markdown).toContain('Files changed: 1');
        expect(markdown).not.toContain('I am inspecting it.');
        expect(markdown).not.toContain('Command: ls');
        expect(plainText).toContain('I am inspecting it.');
        expect(plainText).toContain('Command: ls');
        expect(plainText).toContain('Done.');
    });
});
