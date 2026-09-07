import os from 'node:os';
import path from 'node:path';
import type {
    DynamicToolDefinition,
    MessageEvent,
    ThreadEvent,
    ThreadTranscriptStats,
    ToolCallEvent,
} from './codex-browser-types';
import {
    asFiniteNumber,
    asRecord,
    asString,
    type CloudRecord,
    type CodexCloudTurn,
    mapCodexCloudTurnEvents,
    normalizeCodexCloudTurn,
    pickFirstRecord,
    toIsoTimestamp,
    toSafeJsonValue,
} from './codex-cloud-transcript';
import type { JsonValue } from './shared-text';

const CODEX_CLOUD_BASE_URL = 'https://chatgpt.com/backend-api/wham';

const DEFAULT_PAGE_SIZE = 20;

const DEFAULT_MAX_TASKS = 200;

const MAX_CURSOR_PAGES = 100;

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type CodexCloudAuth = {
    accessToken: string;
    accountId: string;
};

export type CodexCloudDiffStats = {
    filesModified: number | null;
    linesAdded: number | null;
    linesRemoved: number | null;
};

export type CodexCloudTask = {
    createdAt: string | null;
    diffStats: CodexCloudDiffStats;
    environmentId: string | null;
    environmentLabel: string | null;
    id: string;
    status: string;
    taskUrl: string;
    title: string;
    updatedAt: string | null;
};

export type CodexCloudProject = {
    environmentId: string | null;
    id: string;
    label: string;
    lastUpdatedAt: string | null;
    partial: boolean;
    statuses: string[];
    tasks: CodexCloudTask[];
    taskCount: number;
};

export type CodexCloudTaskDetail = {
    availableTools: DynamicToolDefinition[];
    branch: string | null;
    currentTurnId: string | null;
    diff: {
        patch: string | null;
        stats: CodexCloudDiffStats;
    };
    environmentId: string | null;
    environmentLabel: string | null;
    events: ThreadEvent[];
    model: string | null;
    projectId: string;
    projectLabel: string;
    safeJson: JsonValue;
    status: string | null;
    task: CodexCloudTask;
};

export type CodexCloudTaskList = {
    cursor: string | null;
    partial: boolean;
    tasks: CodexCloudTask[];
};

type CodexCloudClientOptions = {
    fetchImpl?: FetchImplementation;
    listCommandImpl?: (options: { cursor?: string; limit: number }) => Promise<unknown>;
    maxTasks?: number;
    readAuth?: () => Promise<CodexCloudAuth>;
    refreshAuth?: () => Promise<void>;
};

type CloudListResponse = {
    cursor?: unknown;
    items?: unknown;
    tasks?: unknown;
};

type CloudClient = {
    getTask: (taskId: string) => Promise<CodexCloudTaskDetail>;
    listProject: (projectId: string) => Promise<CodexCloudProject>;
    listProjects: () => Promise<CodexCloudProject[]>;
    listTasks: () => Promise<CodexCloudTaskList>;
};

export class CodexCloudError extends Error {
    readonly status: number | null;

    constructor(message: string, status: number | null = null) {
        super(message);
        this.name = 'CodexCloudError';
        this.status = status;
    }
}

const asNonNegativeInteger = (value: unknown): number | null => {
    const number = asFiniteNumber(value);
    return number !== null && number >= 0 ? Math.round(number) : null;
};

const getNestedNumber = (record: CloudRecord | null, keys: string[]) => {
    if (!record) {
        return null;
    }

    for (const key of keys) {
        const number = asNonNegativeInteger(record[key]);
        if (number !== null) {
            return number;
        }
    }

    return null;
};

export const normalizeCodexCloudDiffStats = (value: unknown): CodexCloudDiffStats => {
    const record = asRecord(value);
    const nested = pickFirstRecord(
        record?.diff_stats,
        record?.diffStats,
        asRecord(record?.denormalized_metadata)?.diff_stats,
        asRecord(record?.summary)?.diff_stats,
        record?.summary,
        record,
    );

    return {
        filesModified: getNestedNumber(nested, ['files_modified', 'filesModified', 'files_changed', 'files']),
        linesAdded: getNestedNumber(nested, ['lines_added', 'linesAdded', 'additions']),
        linesRemoved: getNestedNumber(nested, ['lines_removed', 'linesRemoved', 'deletions']),
    };
};

const getStatus = (record: CloudRecord) => {
    const display = asRecord(record.task_status_display);
    return asString(record.status) ?? asString(display?.label) ?? asString(display?.status) ?? 'unknown';
};

const getEnvironmentLabel = (record: CloudRecord) => {
    return (
        asString(record.environment_label) ??
        asString(record.environmentLabel) ??
        asString(asRecord(record.environment)?.label) ??
        asString(asRecord(record.creator_workspace)?.label)
    );
};

export const normalizeCodexCloudTask = (value: unknown): CodexCloudTask | null => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }

    const id = asString(record.id) ?? asString(record.task_id);
    if (!id) {
        return null;
    }

    const title = asString(record.title) ?? asString(record.name) ?? `Codex task ${id}`;
    return {
        createdAt: toIsoTimestamp(record.created_at ?? record.createdAt),
        diffStats: normalizeCodexCloudDiffStats(record),
        environmentId: asString(record.environment_id) ?? asString(record.environmentId),
        environmentLabel: getEnvironmentLabel(record),
        id,
        status: getStatus(record),
        taskUrl: `https://chatgpt.com/codex/tasks/${encodeURIComponent(id)}`,
        title,
        updatedAt: toIsoTimestamp(record.updated_at ?? record.updatedAt),
    };
};

export const buildCodexCloudTranscriptStats = (events: ThreadEvent[]): ThreadTranscriptStats => {
    const assistantMessages = events.filter((event) => event.kind === 'message' && event.role === 'assistant');
    return {
        assistantMessageCount: assistantMessages.length,
        commentaryCount: assistantMessages.filter((event) => event.kind === 'message' && event.phase === 'commentary')
            .length,
        execCommandCount: events.filter(
            (event) => event.kind === 'tool_call' && (event.name === 'exec_command' || event.command !== null),
        ).length,
        finalAnswerCount: assistantMessages.filter(
            (event) => event.kind === 'message' && event.phase === 'final_answer',
        ).length,
        messageCount: events.filter((event) => event.kind === 'message').length,
        modelNames: [
            ...new Set(
                events
                    .filter((event): event is MessageEvent => event.kind === 'message' && Boolean(event.model))
                    .map((event) => event.model!)
                    .filter(Boolean),
            ),
        ],
        toolCallCount: events.filter((event) => event.kind === 'tool_call').length,
        toolOutputCount: events.filter((event) => event.kind === 'tool_output').length,
        userMessageCount: events.filter((event) => event.kind === 'message' && event.role === 'user').length,
        webSearchEventCount: events.filter((event) => event.kind === 'web_search').length,
    };
};

const getObservedTools = (events: ThreadEvent[]): DynamicToolDefinition[] => {
    return [
        ...new Map(
            events
                .filter((event): event is ToolCallEvent => event.kind === 'tool_call')
                .map((event) => [event.name, event.name]),
        ).values(),
    ].map((name) => ({
        deferLoading: false,
        description: 'Observed in the Codex Cloud transcript.',
        inputSchema: null,
        name,
        namespace: null,
    }));
};

const findTextByKeys = (value: unknown, keys: string[], depth = 0): string | null => {
    if (depth >= 6) {
        return null;
    }
    if (Array.isArray(value)) {
        for (const child of value) {
            const found = findTextByKeys(child, keys, depth + 1);
            if (found) {
                return found;
            }
        }
        return null;
    }
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    for (const key of keys) {
        const found = asString(record[key]);
        if (found) {
            return found;
        }
    }
    for (const child of Object.values(record)) {
        const found = findTextByKeys(child, keys, depth + 1);
        if (found) {
            return found;
        }
    }
    return null;
};

const buildSafeTaskDetailJson = (
    task: CodexCloudTask,
    events: ThreadEvent[],
    turn: CodexCloudTurn,
    diff: { patch: string | null; stats: CodexCloudDiffStats },
): JsonValue =>
    toSafeJsonValue({
        diff,
        events: events.map((event) => event.raw),
        task,
        turn: {
            branch: turn.branch,
            createdAt: turn.createdAt,
            environmentId: turn.environmentId,
            eventCount: events.length,
            id: turn.id,
            model: turn.model,
            status: turn.status,
        },
    });

const resolveProjectId = (environmentId: string | null, environmentLabel: string | null, taskId: string) =>
    environmentLabel ? `label:${encodeURIComponent(environmentLabel)}` : (environmentId ?? `task:${taskId}`);

const normalizeTaskWithTurn = (value: unknown, turn: CodexCloudTurn, taskId: string): CodexCloudTask => {
    const record = asRecord(value) ?? {};
    return {
        ...(normalizeCodexCloudTask({ ...record, id: taskId }) ?? {
            createdAt: null,
            diffStats: normalizeCodexCloudDiffStats(record),
            environmentId: null,
            environmentLabel: null,
            id: taskId,
            status: 'unknown',
            taskUrl: `https://chatgpt.com/codex/tasks/${encodeURIComponent(taskId)}`,
            title: `Codex task ${taskId}`,
            updatedAt: null,
        }),
        environmentId: turn.environmentId ?? asString(record.environment_id) ?? asString(record.environmentId),
        environmentLabel: turn.environmentLabel ?? getEnvironmentLabel(record),
    };
};

const resolveAuthPath = () => {
    const configuredAuthPath = process.env.SPIRACHA_CODEX_AUTH?.trim();
    if (configuredAuthPath) {
        return configuredAuthPath;
    }

    const codexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
    return path.join(codexHome, 'auth.json');
};

const readCodexCloudAuth = async (): Promise<CodexCloudAuth> => {
    let value: unknown;
    try {
        value = await Bun.file(resolveAuthPath()).json();
    } catch {
        throw new CodexCloudError('Codex Cloud login is unavailable. Run `codex login` and try again.');
    }

    const tokens = asRecord(asRecord(value)?.tokens);
    const accessToken = asString(tokens?.access_token);
    const accountId = asString(tokens?.account_id);
    if (!accessToken || !accountId) {
        throw new CodexCloudError('Codex Cloud requires a ChatGPT login. Run `codex login` and try again.');
    }

    return { accessToken, accountId };
};

const refreshCodexCloudAuth = async () => {
    const command = process.env.CODEX_BIN?.trim() || 'codex';
    let child: ReturnType<typeof Bun.spawn>;
    try {
        child = Bun.spawn([command, 'cloud', 'list', '--json', '--limit', '1'], {
            stderr: 'ignore',
            stdout: 'ignore',
        });
    } catch {
        throw new CodexCloudError(
            'Could not start the Codex CLI to refresh login. Check `CODEX_BIN` or install Codex.',
        );
    }
    if ((await child.exited) !== 0) {
        throw new CodexCloudError('Codex Cloud login refresh failed. Run `codex login` and try again.');
    }
};

const runCodexCloudList = async ({ cursor, limit }: { cursor?: string; limit: number }) => {
    const command = process.env.CODEX_BIN?.trim() || 'codex';
    const args = ['cloud', 'list', '--json', '--limit', String(limit)];
    if (cursor) {
        args.push('--cursor', cursor);
    }

    let child: ReturnType<typeof Bun.spawn>;
    try {
        child = Bun.spawn([command, ...args], { stderr: 'ignore', stdout: 'pipe' });
    } catch {
        throw new CodexCloudError('Could not start the Codex CLI for inventory. Check `CODEX_BIN` or install Codex.');
    }
    const output = await new Response(child.stdout as ReadableStream<Uint8Array>).text();
    if ((await child.exited) !== 0) {
        throw new CodexCloudError('Codex CLI inventory command failed. Run `codex login` and try again.');
    }
    try {
        return JSON.parse(output) as unknown;
    } catch {
        throw new CodexCloudError('Codex CLI returned invalid inventory JSON. Update Codex and try again.');
    }
};

const validateTaskId = (taskId: string) => {
    if (!/^task_[a-z0-9_]+$/iu.test(taskId)) {
        throw new CodexCloudError('Invalid Codex Cloud task id.');
    }
};

const performCloudRequest = async (
    fetchImpl: FetchImplementation,
    endpoint: string,
    searchParams: Record<string, string | undefined>,
    auth: CodexCloudAuth,
) => {
    const url = new URL(`${CODEX_CLOUD_BASE_URL}${endpoint}`);
    for (const [key, value] of Object.entries(searchParams)) {
        if (value) {
            url.searchParams.set(key, value);
        }
    }

    try {
        return await fetchImpl(url, {
            headers: {
                Authorization: `Bearer ${auth.accessToken}`,
                'ChatGPT-Account-Id': auth.accountId,
                'User-Agent': 'spiracha-codex-cloud',
            },
            redirect: 'error',
        });
    } catch {
        throw new CodexCloudError('Codex Cloud could not be reached. Check the network and try again.');
    }
};

const parseCloudResponse = async (response: Response) => {
    if (!response.ok) {
        throw new CodexCloudError(`Codex Cloud request failed (${response.status}).`, response.status);
    }

    try {
        return (await response.json()) as unknown;
    } catch {
        throw new CodexCloudError('Codex Cloud returned an invalid response.');
    }
};

const appendCloudTasks = (rawItems: unknown[], tasks: CodexCloudTask[], seenTaskIds: Set<string>, maxTasks: number) => {
    for (const rawItem of rawItems) {
        const task = normalizeCodexCloudTask(rawItem);
        if (!task || seenTaskIds.has(task.id)) {
            continue;
        }
        seenTaskIds.add(task.id);
        tasks.push(task);
        if (tasks.length >= maxTasks) {
            return;
        }
    }
};

const getCloudListItems = (response: unknown) => {
    const record = asRecord(response);
    if (Array.isArray(record?.items)) {
        return record.items;
    }
    if (Array.isArray(record?.tasks)) {
        return record.tasks;
    }
    throw new CodexCloudError('Codex Cloud returned an invalid inventory response.');
};

const updateCloudListCursor = ({
    cursor,
    maxTasks,
    nextCursor,
    seenCursors,
    taskCount,
}: {
    cursor: string | undefined;
    maxTasks: number;
    nextCursor: string | null;
    seenCursors: Set<string>;
    taskCount: number;
}) => {
    if (taskCount >= maxTasks || !nextCursor || seenCursors.has(nextCursor)) {
        return {
            cursor: nextCursor ?? cursor,
            done: true,
            partial: Boolean(nextCursor),
        };
    }

    seenCursors.add(nextCursor);
    return { cursor: nextCursor, done: false, partial: false };
};

const groupCloudTasks = (tasks: CodexCloudTask[]) => {
    const groups = new Map<string, CodexCloudTask[]>();
    for (const task of tasks) {
        const key = task.environmentLabel ?? task.environmentId ?? '__unassigned__';
        const group = groups.get(key) ?? [];
        group.push(task);
        groups.set(key, group);
    }
    return groups;
};

const sortCloudTasks = (tasks: CodexCloudTask[]) =>
    [...tasks].sort(
        (left, right) => (Date.parse(right.updatedAt ?? '') || 0) - (Date.parse(left.updatedAt ?? '') || 0),
    );

const buildCloudProject = (key: string, tasks: CodexCloudTask[], partial: boolean): CodexCloudProject => {
    const environmentId = tasks.find((task) => task.environmentId)?.environmentId ?? null;
    const environmentLabel = tasks.find((task) => task.environmentLabel)?.environmentLabel ?? null;
    const sortedTasks = sortCloudTasks(tasks);
    return {
        environmentId,
        id: resolveProjectId(environmentId, environmentLabel, tasks[0]?.id ?? key),
        label: environmentLabel ?? environmentId ?? 'Unassigned Cloud tasks',
        lastUpdatedAt: sortedTasks[0]?.updatedAt ?? null,
        partial,
        statuses: [...new Set(tasks.map((task) => task.status))].sort(),
        taskCount: tasks.length,
        tasks: sortedTasks,
    };
};

export const createCodexCloudClient = (options: CodexCloudClientOptions = {}): CloudClient => {
    const fetchImpl = options.fetchImpl ?? fetch;
    const readAuth = options.readAuth ?? readCodexCloudAuth;
    const refreshAuth = options.refreshAuth ?? refreshCodexCloudAuth;
    const listCommand = options.listCommandImpl ?? (options.fetchImpl ? null : runCodexCloudList);
    const maxTasks = Math.min(Math.max(options.maxTasks ?? DEFAULT_MAX_TASKS, 1), DEFAULT_MAX_TASKS);

    const requestJson = async (endpoint: string, searchParams: Record<string, string | undefined> = {}) => {
        const auth = await readAuth();
        const response = await performCloudRequest(fetchImpl, endpoint, searchParams, auth);
        if (response.status !== 401) {
            return parseCloudResponse(response);
        }

        await response.body?.cancel();
        try {
            await refreshAuth();
        } catch (error) {
            if (error instanceof CodexCloudError) {
                throw error;
            }
            throw new CodexCloudError('Codex Cloud login refresh failed. Run `codex login` and try again.');
        }
        const refreshedResponse = await performCloudRequest(fetchImpl, endpoint, searchParams, await readAuth());
        if (refreshedResponse.status === 401) {
            await refreshedResponse.body?.cancel();
            throw new CodexCloudError(
                'Codex Cloud is still unauthorized after refreshing login. Run `codex login` and try again.',
                401,
            );
        }
        return parseCloudResponse(refreshedResponse);
    };

    const listTasks = async (): Promise<CodexCloudTaskList> => {
        const tasks: CodexCloudTask[] = [];
        const seenTaskIds = new Set<string>();
        const seenCursors = new Set<string>();
        let cursor: string | undefined;
        let partial = false;
        let pages = 0;

        while (tasks.length < maxTasks && pages < MAX_CURSOR_PAGES) {
            pages += 1;
            const response = (
                listCommand
                    ? await listCommand({ cursor, limit: DEFAULT_PAGE_SIZE })
                    : await requestJson('/tasks/list', {
                          cursor,
                          limit: String(DEFAULT_PAGE_SIZE),
                          task_filter: 'current',
                      })
            ) as CloudListResponse;
            const rawItems = getCloudListItems(response);
            appendCloudTasks(rawItems, tasks, seenTaskIds, maxTasks);
            const cursorState = updateCloudListCursor({
                cursor,
                maxTasks,
                nextCursor: asString(response.cursor),
                seenCursors,
                taskCount: tasks.length,
            });
            cursor = cursorState.cursor;
            partial ||= cursorState.partial;
            if (cursorState.done) {
                break;
            }
        }

        if (pages >= MAX_CURSOR_PAGES && cursor) {
            partial = true;
        }

        return { cursor: cursor ?? null, partial, tasks };
    };

    const getTask = async (taskId: string): Promise<CodexCloudTaskDetail> => {
        validateTaskId(taskId);
        const body = asRecord(await requestJson(`/tasks/${encodeURIComponent(taskId)}`)) ?? {};
        const taskRecord = asRecord(body.task) ?? {};
        const userTurn = asRecord(body.current_user_turn);
        const rawTurn = pickFirstRecord(body.current_assistant_turn, body.current_diff_task_turn);
        const turn = normalizeCodexCloudTurn(rawTurn, userTurn);
        const events = mapCodexCloudTurnEvents(turn);
        const environmentId = turn.environmentId ?? asString(taskRecord.environment_id);
        const environmentLabel = turn.environmentLabel ?? getEnvironmentLabel(taskRecord);
        const task = normalizeTaskWithTurn(taskRecord, turn, taskId);
        const diffTurn = asRecord(body.current_diff_task_turn);
        const diffOutput = Array.isArray(diffTurn?.output_items)
            ? diffTurn.output_items.map(asRecord).find((item) => item?.output_diff !== undefined)?.output_diff
            : null;
        const diffTurnStats = normalizeCodexCloudDiffStats(diffOutput ?? diffTurn);
        const taskStats = normalizeCodexCloudDiffStats(taskRecord);
        const stats = {
            filesModified: diffTurnStats.filesModified ?? taskStats.filesModified,
            linesAdded: diffTurnStats.linesAdded ?? taskStats.linesAdded,
            linesRemoved: diffTurnStats.linesRemoved ?? taskStats.linesRemoved,
        };
        const patch = findTextByKeys(body.current_diff_task_turn, ['patch', 'unified_diff', 'diff']);
        const diff = { patch, stats };

        return {
            availableTools: getObservedTools(events),
            branch: turn.branch,
            currentTurnId: turn.id,
            diff,
            environmentId,
            environmentLabel,
            events,
            model: turn.model,
            projectId: resolveProjectId(environmentId, environmentLabel, taskId),
            projectLabel: environmentLabel ?? environmentId ?? 'Unassigned Cloud tasks',
            safeJson: buildSafeTaskDetailJson(task, events, turn, diff),
            status: turn.status,
            task,
        };
    };

    const listProjects = async () => {
        const taskList = await listTasks();
        const groups = groupCloudTasks(taskList.tasks);

        const projects: CodexCloudProject[] = [];
        for (const [key, tasks] of groups) {
            projects.push(buildCloudProject(key, tasks, taskList.partial));
        }

        return projects.sort(
            (left, right) => (Date.parse(right.lastUpdatedAt ?? '') || 0) - (Date.parse(left.lastUpdatedAt ?? '') || 0),
        );
    };

    const listProject = async (projectId: string) => {
        const project = (await listProjects()).find((candidate) => candidate.id === projectId);
        if (!project) {
            throw new CodexCloudError('Codex Cloud project not found. Refresh the Cloud inventory and try again.');
        }
        return project;
    };

    return { getTask, listProject, listProjects, listTasks };
};

export const codexCloudClient = createCodexCloudClient();

export type CodexCloudExportOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: 'md' | 'txt';
};

const getCloudEventTitle = (event: ThreadEvent, model: string | null) => {
    if (event.kind === 'message') {
        if (event.variant === 'agent_message') {
            return event.role === 'assistant' ? (model ?? 'Assistant') : 'Assistant update';
        }
        return event.role === 'user' ? 'User' : event.role === 'system' ? 'System' : (model ?? 'Assistant');
    }

    switch (event.kind) {
        case 'reasoning':
            return 'Reasoning';
        case 'task_started':
            return 'Task started';
        case 'task_complete':
            return 'Task complete';
        case 'token_count':
            return 'Token update';
        case 'tool_call':
            return `Tool call: ${event.name}`;
        case 'tool_output':
            return 'Tool output';
        case 'web_search':
            return 'Web search';
    }
};

const getCloudEventBody = (event: ThreadEvent) => {
    switch (event.kind) {
        case 'message':
            return event.text || 'No text content';
        case 'reasoning':
            return event.summary.join(' ') || 'Reasoning content is not directly available.';
        case 'task_started':
            return `Context window: ${event.modelContextWindow ?? 'n/a'}\n\nCollaboration mode: ${event.collaborationModeKind ?? 'n/a'}`;
        case 'task_complete':
            return `Duration: ${event.durationMs ?? 'n/a'} ms\n\nFirst token: ${event.timeToFirstTokenMs ?? 'n/a'} ms`;
        case 'token_count':
            return JSON.stringify(event.rateLimits, null, 2);
        case 'tool_call':
            return [
                event.command ? `Command: ${event.command}` : event.name,
                event.workdir ? `Working directory: ${event.workdir}` : null,
            ]
                .filter(Boolean)
                .join('\n\n');
        case 'tool_output':
            return [event.exitCode === null ? null : `Exit code: ${event.exitCode}`, event.summary || event.outputText]
                .filter(Boolean)
                .join('\n\n');
        case 'web_search':
            return [`Phase: ${event.phase}`, event.status, event.query].filter(Boolean).join('\n\n');
    }
};

const shouldIncludeCloudExportEvent = (event: ThreadEvent, options: CodexCloudExportOptions) => {
    if (event.kind === 'message' && event.role === 'assistant' && event.phase === 'commentary') {
        return options.includeCommentary;
    }
    if (event.kind === 'tool_call' || event.kind === 'tool_output' || event.kind === 'web_search') {
        return options.includeTools;
    }
    return true;
};

const getCloudDiffSection = (detail: CodexCloudTaskDetail, outputFormat: 'md' | 'txt') => {
    const { filesModified, linesAdded, linesRemoved } = detail.diff.stats;
    const stats = [
        filesModified === null ? null : `Files changed: ${filesModified}`,
        linesAdded === null ? null : `Additions: +${linesAdded}`,
        linesRemoved === null ? null : `Deletions: -${linesRemoved}`,
    ].filter((value): value is string => value !== null);
    const body = [...stats, detail.diff.patch].filter((value): value is string => Boolean(value)).join('\n\n');
    if (!body) {
        return null;
    }
    return outputFormat === 'md' ? `## Diff\n\n${body}` : `Diff\n\n${body}`;
};

export const renderCodexCloudExport = (detail: CodexCloudTaskDetail, options: CodexCloudExportOptions) => {
    const metadata = [
        `Source: Codex Cloud`,
        `Task ID: ${detail.task.id}`,
        `Project: ${detail.projectLabel}`,
        `Status: ${detail.status ?? detail.task.status}`,
        `Updated: ${detail.task.updatedAt ?? 'n/a'}`,
        `URL: ${detail.task.taskUrl}`,
    ];
    const sections = detail.events
        .filter((event) => shouldIncludeCloudExportEvent(event, options))
        .map((event) => {
            const title = getCloudEventTitle(event, detail.model);
            const body = getCloudEventBody(event);
            return options.outputFormat === 'md' ? `## ${title}\n\n${body}` : `${title}\n\n${body}`;
        });
    const diffSection = getCloudDiffSection(detail, options.outputFormat);
    if (diffSection) {
        sections.push(diffSection);
    }
    const heading = options.outputFormat === 'md' ? `# ${detail.task.title}` : detail.task.title;
    const metadataSection = options.includeMetadata ? `${metadata.join('\n')}\n\n` : '';
    return `${heading}\n\n${metadataSection}${sections.join('\n\n')}`.trimEnd() + '\n';
};
