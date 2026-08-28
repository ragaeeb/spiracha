import { randomUUID } from 'node:crypto';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { createConcurrencyLimiter, mapWithConcurrency } from './concurrency';
import type {
    DeleteFxSessionResult,
    FxSessionSummary,
    FxSessionTranscript,
    FxToolCall,
    FxToolStatus,
    FxTranscriptMessage,
    FxWorkspaceGroup,
} from './fx-exporter-types';
import { getDefaultFxDataDir, resolveFxDataDir } from './fx-exporter-types';
import { getPortablePathBasename } from './portable-path';
import {
    asNumber,
    asObject,
    asString,
    cleanInlineTitle,
    type JsonValue,
    readDirectoryEntriesIfExists,
    readJsonlObjects,
} from './shared';

export { getDefaultFxDataDir, resolveFxDataDir };

const READ_CONCURRENCY = 4;
const WORKSPACE_KEY_PREFIX = 'workspace:';
const fxDeleteLimiter = createConcurrencyLimiter(1);
const isSafeSessionId = (sessionId: string): boolean =>
    Boolean(sessionId) && sessionId !== '.' && sessionId !== '..' && /^[A-Za-z0-9._-]+$/u.test(sessionId);

type ReadFxOptions = {
    includeRawPayloads?: boolean;
};

type FxSessionRecord = {
    conversationLanguage: string | null;
    createdAtMs: number | null;
    currentModelId: string | null;
    currentModelVariant: string | null;
    lastActiveAtMs: number | null;
    sessionId: string;
    title: string;
    totalInputTokens: number | null;
    totalOutputTokens: number | null;
    worktree: string;
};

type FxTurnSource = {
    createdAtMs: number | null;
    finishReason: 'in_progress' | 'stop';
    raw: Record<string, JsonValue>;
    turn: Record<string, JsonValue>;
};

type SessionStats = Pick<
    FxSessionSummary,
    | 'assistantMessageCount'
    | 'messageCount'
    | 'reasoningCount'
    | 'renderablePartCount'
    | 'toolCallCount'
    | 'toolResultCount'
    | 'userMessageCount'
>;

const getWorkspaceKey = (worktree: string): string => `${WORKSPACE_KEY_PREFIX}${encodeURIComponent(worktree)}`;

const getWorktreeFromWorkspaceKey = (workspaceKey: string): string | null => {
    if (!workspaceKey.startsWith(WORKSPACE_KEY_PREFIX)) {
        return null;
    }
    try {
        return decodeURIComponent(workspaceKey.slice(WORKSPACE_KEY_PREFIX.length));
    } catch {
        return null;
    }
};

const readJsonObject = async (filePath: string): Promise<Record<string, JsonValue> | null> => {
    const value = (await Bun.file(filePath)
        .json()
        .catch(() => null)) as JsonValue | null;
    return asObject(value);
};

const firstString = (...values: (JsonValue | undefined)[]): string | null => {
    for (const value of values) {
        const text = asString(value ?? null)?.trim();
        if (text) {
            return text;
        }
    }
    return null;
};

const firstNumber = (...values: (JsonValue | undefined)[]): number | null => {
    for (const value of values) {
        const number = asNumber(value ?? null);
        if (number !== null) {
            return number;
        }
    }
    return null;
};

const objectArray = (value: JsonValue | undefined): Record<string, JsonValue>[] =>
    Array.isArray(value)
        ? value.flatMap((item) => {
              const object = asObject(item);
              return object ? [object] : [];
          })
        : [];

const getSessionIndexRecords = async (dataDir: string): Promise<Record<string, JsonValue>[]> => {
    const root = await readJsonObject(path.join(dataDir, 'sessions', 'index.json'));
    return Array.isArray(root?.sessions)
        ? root.sessions.flatMap((value) => {
              const record = asObject(value);
              return record ? [record] : [];
          })
        : [];
};

const parseSessionRecord = async (
    dataDir: string,
    sessionId: string,
    indexRecord: Record<string, JsonValue> = {},
): Promise<FxSessionRecord | null> => {
    const sessionDir = path.join(dataDir, 'sessions', sessionId);
    const [session, display, checkpoint] = await Promise.all([
        readJsonObject(path.join(sessionDir, 'session.json')),
        readJsonObject(path.join(sessionDir, 'display.json')),
        readJsonObject(path.join(sessionDir, 'checkpoint.json')),
    ]);
    if (!session) {
        return null;
    }
    const state = asObject(checkpoint?.state ?? null);
    const preferences = asObject(session.preferences ?? null) ?? asObject(state?.preferences ?? null);
    const worktree = firstString(indexRecord.workspace_root, session.workspace_root, state?.workspace_root);
    if (!worktree) {
        return null;
    }
    const rawTitle = firstString(display?.title, indexRecord.title, indexRecord.preview);
    return {
        conversationLanguage: firstString(indexRecord.conversation_language, session.conversation_language),
        createdAtMs: firstNumber(indexRecord.created_at_ms, session.created_at_ms, state?.created_at_ms),
        currentModelId: firstString(preferences?.model),
        currentModelVariant: firstString(preferences?.effort),
        lastActiveAtMs: firstNumber(indexRecord.updated_at_ms, session.updated_at_ms, state?.updated_at_ms),
        sessionId,
        title: cleanInlineTitle(rawTitle ?? sessionId) || sessionId,
        totalInputTokens: firstNumber(session.total_input_tokens, state?.total_input_tokens),
        totalOutputTokens: firstNumber(session.total_output_tokens, state?.total_output_tokens),
        worktree,
    };
};

const normalizeToolStatus = (value: JsonValue | undefined): FxToolStatus => {
    const status = asString(value ?? null)?.toLowerCase();
    if (status && /(?:success|complete|done|finish)/u.test(status)) {
        return 'succeeded';
    }
    if (status && /(?:fail|error|reject|cancel)/u.test(status)) {
        return 'failed';
    }
    return 'unknown';
};

const resolveToolOutput = async (sessionDir: string, result: Record<string, JsonValue>): Promise<string | null> => {
    const handle = asString(result.output_handle ?? null)?.trim();
    if (handle && path.basename(handle) === handle) {
        const outputPath = path.join(sessionDir, 'tool-results', handle);
        if (await Bun.file(outputPath).exists()) {
            return (await Bun.file(outputPath).text()).trim() || null;
        }
    }
    return asString(result.output ?? null)?.trim() || asString(result.preview ?? null)?.trim() || null;
};

const commandFromArguments = (argumentsText: string | null): string | null => {
    if (!argumentsText) {
        return null;
    }
    try {
        return asString(asObject(JSON.parse(argumentsText) as JsonValue)?.command ?? null)?.trim() || null;
    } catch {
        return null;
    }
};

const parseToolCalls = async (
    sessionDir: string,
    step: Record<string, JsonValue>,
    includeRawPayloads: boolean,
): Promise<FxToolCall[]> => {
    const results = Array.isArray(step.tool_results)
        ? step.tool_results.flatMap((value) => {
              const result = asObject(value);
              return result ? [result] : [];
          })
        : [];
    const resultsById = new Map(
        results.flatMap((result) => {
            const id = asString(result.tool_call_id ?? null)?.trim();
            return id ? [[id, result] as const] : [];
        }),
    );
    if (!Array.isArray(step.tool_calls)) {
        return [];
    }
    return Promise.all(
        step.tool_calls.flatMap((value) => {
            const call = asObject(value);
            if (!call) {
                return [];
            }
            const callId = asString(call.id ?? null)?.trim() || null;
            const result = callId ? resultsById.get(callId) : undefined;
            const argumentsText = asString(call.arguments_json ?? null)?.trim() || null;
            return [
                (async (): Promise<FxToolCall> => ({
                    argumentsText,
                    callId,
                    command: commandFromArguments(argumentsText),
                    outputText: result ? await resolveToolOutput(sessionDir, result) : null,
                    raw: includeRawPayloads ? { call, ...(result ? { result } : {}) } : {},
                    status: normalizeToolStatus(result?.status),
                    toolName: asString(call.name ?? null)?.trim() || 'unknown',
                }))(),
            ];
        }),
    );
};

const createMessage = (
    input: Pick<
        FxTranscriptMessage,
        'content' | 'createdAtMs' | 'finishReason' | 'messageId' | 'role' | 'toolCalls'
    > & {
        raw: Record<string, JsonValue>;
    },
): FxTranscriptMessage => ({
    ...input,
    messageType: input.role === 'user' ? 1 : 2,
    reasoning: null,
    thinkingDurationMs: null,
});

const parseUserMessage = (
    source: FxTurnSource,
    turnIndex: number,
    includeRawPayloads: boolean,
): FxTranscriptMessage | null => {
    const user = asObject(source.turn.user ?? null);
    const content = firstString(user?.text);
    return content
        ? createMessage({
              content,
              createdAtMs: source.createdAtMs,
              finishReason: null,
              messageId: `turn:${turnIndex}:user`,
              raw: includeRawPayloads ? { user: user ?? {} } : {},
              role: 'user',
              toolCalls: [],
          })
        : null;
};

const parseToolStepMessage = async (
    sessionDir: string,
    source: FxTurnSource,
    turnIndex: number,
    step: Record<string, JsonValue>,
    stepIndex: number,
    includeRawPayloads: boolean,
): Promise<FxTranscriptMessage | null> => {
    const content = firstString(step.assistant);
    const toolCalls = await parseToolCalls(sessionDir, step, includeRawPayloads);
    return content || toolCalls.length > 0
        ? createMessage({
              content,
              createdAtMs: source.createdAtMs,
              finishReason: 'toolUse',
              messageId: `turn:${turnIndex}:step:${stepIndex}`,
              raw: includeRawPayloads ? step : {},
              role: 'assistant',
              toolCalls,
          })
        : null;
};

const parseAssistantMessage = (
    source: FxTurnSource,
    turnIndex: number,
    includeRawPayloads: boolean,
): FxTranscriptMessage | null => {
    const content = firstString(source.turn.assistant);
    return content
        ? createMessage({
              content,
              createdAtMs: source.createdAtMs,
              finishReason: source.finishReason,
              messageId: `turn:${turnIndex}:assistant`,
              raw: includeRawPayloads ? source.raw : {},
              role: 'assistant',
              toolCalls: [],
          })
        : null;
};

const parseTurn = async (
    sessionDir: string,
    source: FxTurnSource,
    turnIndex: number,
    includeRawPayloads: boolean,
): Promise<FxTranscriptMessage[]> => {
    const execution = asObject(source.turn.execution ?? null);
    const stepMessages = await Promise.all(
        objectArray(execution?.tool_steps).map((step, stepIndex) =>
            parseToolStepMessage(sessionDir, source, turnIndex, step, stepIndex, includeRawPayloads),
        ),
    );
    return [
        parseUserMessage(source, turnIndex, includeRawPayloads),
        ...stepMessages,
        parseAssistantMessage(source, turnIndex, includeRawPayloads),
    ].flatMap((message) => (message ? [message] : []));
};

const recoveryToTurn = (checkpoint: Record<string, JsonValue>): Record<string, JsonValue> => ({
    assistant: checkpoint.assistant_source ?? null,
    execution: checkpoint.execution ?? null,
    kind: 'assistant',
    user: checkpoint.user ?? null,
});

const getCheckpointTurnSources = (state: Record<string, JsonValue> | null): FxTurnSource[] =>
    objectArray(state?.history).map((turn) => ({
        createdAtMs: firstNumber(state?.created_at_ms),
        finishReason: 'stop',
        raw: turn,
        turn,
    }));

type PendingTurn = { checkpoint: Record<string, JsonValue> | null; createdAtMs: number | null };

const updatePendingTurn = (
    event: Record<string, JsonValue>,
    pending: PendingTurn,
    sources: FxTurnSource[],
): PendingTurn => {
    const kind = firstString(event.kind);
    const payload = asObject(event.payload ?? null);
    if (kind === 'recovery_checkpoint_set') {
        return {
            checkpoint: asObject(payload?.checkpoint ?? null),
            createdAtMs: pending.createdAtMs ?? firstNumber(event.timestamp_ms),
        };
    }
    const committedTurn = kind === 'history_turn_committed' ? asObject(payload?.turn ?? null) : null;
    if (!committedTurn) {
        return pending;
    }
    sources.push({
        createdAtMs: pending.createdAtMs ?? firstNumber(event.timestamp_ms),
        finishReason: 'stop',
        raw: committedTurn,
        turn: committedTurn,
    });
    return { checkpoint: null, createdAtMs: null };
};

const readTurnSources = async (sessionDir: string): Promise<FxTurnSource[]> => {
    const checkpoint = await readJsonObject(path.join(sessionDir, 'checkpoint.json'));
    const state = asObject(checkpoint?.state ?? null);
    const sources = getCheckpointTurnSources(state);
    const throughSeq = firstNumber(checkpoint?.through_seq) ?? 0;
    let pending: PendingTurn = { checkpoint: null, createdAtMs: null };
    for await (const event of readJsonlObjects(path.join(sessionDir, 'events.jsonl'))) {
        const seq = firstNumber(event.seq) ?? 0;
        if (seq <= throughSeq) {
            continue;
        }
        pending = updatePendingTurn(event, pending, sources);
    }
    if (pending.checkpoint) {
        sources.push({
            createdAtMs: pending.createdAtMs,
            finishReason: 'in_progress',
            raw: pending.checkpoint,
            turn: recoveryToTurn(pending.checkpoint),
        });
    }
    return sources;
};

const getSessionStats = (messages: FxTranscriptMessage[]): SessionStats => {
    const toolCalls = messages.flatMap((message) => message.toolCalls);
    const reasoningCount = messages.filter((message) => Boolean(message.reasoning)).length;
    const toolResultCount = toolCalls.filter((toolCall) => Boolean(toolCall.outputText)).length;
    return {
        assistantMessageCount: messages.filter((message) => message.role === 'assistant').length,
        messageCount: messages.length,
        reasoningCount,
        renderablePartCount:
            messages.filter((message) => Boolean(message.content)).length +
            reasoningCount +
            toolCalls.length +
            toolResultCount,
        toolCallCount: toolCalls.length,
        toolResultCount,
        userMessageCount: messages.filter((message) => message.role === 'user').length,
    };
};

const toSessionSummary = (
    dataDir: string,
    record: FxSessionRecord,
    messages: FxTranscriptMessage[],
): FxSessionSummary => {
    const stats = getSessionStats(messages);
    return {
        ...stats,
        conversationLanguage: record.conversationLanguage,
        createdAtMs: record.createdAtMs,
        currentModelId: record.currentModelId,
        currentModelVariant: record.currentModelVariant,
        lastActiveAtMs: record.lastActiveAtMs,
        sessionDir: path.join(dataDir, 'sessions', record.sessionId),
        sessionId: record.sessionId,
        status: messages.at(-1)?.finishReason === 'in_progress' ? 'in_progress' : 'complete',
        title: record.title,
        totalInputTokens: record.totalInputTokens,
        totalOutputTokens: record.totalOutputTokens,
        workspaceKey: getWorkspaceKey(record.worktree),
        workspaceLabel: getPortablePathBasename(record.worktree) || record.worktree,
        worktree: record.worktree,
    };
};

export const readFxSessionTranscript = async (
    dataDir: string = resolveFxDataDir(),
    sessionId: string,
    options: ReadFxOptions = {},
): Promise<FxSessionTranscript | null> => {
    if (!isSafeSessionId(sessionId)) {
        return null;
    }
    const indexRecord = (await getSessionIndexRecords(dataDir)).find(
        (record) => asString(record.id ?? null) === sessionId,
    );
    const record = await parseSessionRecord(dataDir, sessionId, indexRecord);
    if (!record) {
        return null;
    }
    const includeRawPayloads = options.includeRawPayloads ?? true;
    const sources = await readTurnSources(path.join(dataDir, 'sessions', sessionId));
    const messages = (
        await Promise.all(
            sources.map((source, turnIndex) =>
                parseTurn(path.join(dataDir, 'sessions', sessionId), source, turnIndex, includeRawPayloads),
            ),
        )
    ).flat();
    const session = toSessionSummary(dataDir, record, messages);
    return {
        messages,
        rawPayloadsOmitted: includeRawPayloads ? undefined : true,
        renderablePartCount: session.renderablePartCount,
        session,
    };
};

const listFxTranscripts = async (dataDir: string): Promise<FxSessionTranscript[]> => {
    const records = await getSessionIndexRecords(dataDir);
    const transcripts = await mapWithConcurrency(records, READ_CONCURRENCY, async (record) => {
        const sessionId = asString(record.id ?? null)?.trim();
        return sessionId ? await readFxSessionTranscript(dataDir, sessionId, { includeRawPayloads: false }) : null;
    });
    return transcripts.flatMap((transcript) => (transcript ? [transcript] : []));
};

const compareNullableMsDesc = (left: number | null, right: number | null): number => (right ?? 0) - (left ?? 0);

export const listFxWorkspaceGroups = async (dataDir: string = resolveFxDataDir()): Promise<FxWorkspaceGroup[]> => {
    const transcripts = await listFxTranscripts(dataDir);
    const grouped = Map.groupBy(transcripts, (transcript) => transcript.session.worktree);
    return [...grouped.entries()]
        .map(([worktree, workspaceTranscripts]) => {
            const sessions = workspaceTranscripts.map((transcript) => transcript.session);
            return {
                assistantMessageCount: sessions.reduce((sum, session) => sum + session.assistantMessageCount, 0),
                key: getWorkspaceKey(worktree),
                label: getPortablePathBasename(worktree) || worktree,
                lastActiveAtMs: sessions.reduce<number | null>(
                    (latest, session) => Math.max(latest ?? 0, session.lastActiveAtMs ?? 0) || null,
                    null,
                ),
                messageCount: sessions.reduce((sum, session) => sum + session.messageCount, 0),
                reasoningCount: sessions.reduce((sum, session) => sum + session.reasoningCount, 0),
                sessionCount: sessions.length,
                toolCallCount: sessions.reduce((sum, session) => sum + session.toolCallCount, 0),
                toolResultCount: sessions.reduce((sum, session) => sum + session.toolResultCount, 0),
                uri: path.isAbsolute(worktree) ? `file://${worktree}` : worktree,
                userMessageCount: sessions.reduce((sum, session) => sum + session.userMessageCount, 0),
                worktree,
            };
        })
        .sort((left, right) => compareNullableMsDesc(left.lastActiveAtMs, right.lastActiveAtMs));
};

export const listFxSessionsForGroup = async (
    workspaceKey: string,
    dataDir: string = resolveFxDataDir(),
): Promise<FxSessionSummary[]> => {
    const worktree = getWorktreeFromWorkspaceKey(workspaceKey);
    if (!worktree) {
        return [];
    }
    return (await listFxTranscripts(dataDir))
        .map((transcript) => transcript.session)
        .filter((session) => session.worktree === worktree)
        .sort((left, right) => compareNullableMsDesc(left.lastActiveAtMs, right.lastActiveAtMs));
};

const listFilesRecursively = async (root: string): Promise<string[]> => {
    const entries = await readDirectoryEntriesIfExists(root);
    const files: string[] = [];
    for (const entry of entries) {
        const entryPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await listFilesRecursively(entryPath)));
        } else {
            files.push(entryPath);
        }
    }
    return files;
};

const removeSessionFromIndex = async (indexPath: string, sessionId: string): Promise<void> => {
    if (!(await Bun.file(indexPath).exists())) {
        return;
    }
    const root = await readJsonObject(indexPath);
    if (!root || !Array.isArray(root.sessions)) {
        throw new Error(`Invalid FX session index: ${indexPath}`);
    }
    const sessions = root.sessions.filter((value) => asString(asObject(value)?.id ?? null) !== sessionId);
    const tempPath = `${indexPath}.${randomUUID()}.tmp`;
    await Bun.write(tempPath, `${JSON.stringify({ ...root, sessions }, null, 2)}\n`);
    await rename(tempPath, indexPath);
};

const removeLatestReferences = async (sessionsDir: string, sessionId: string): Promise<string[]> => {
    const latestDir = path.join(sessionsDir, 'latest');
    const entries = await readDirectoryEntriesIfExists(latestDir);
    const deleted: string[] = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
            continue;
        }
        const entryPath = path.join(latestDir, entry.name);
        const latest = await readJsonObject(entryPath);
        if (asString(latest?.session_id ?? null) !== sessionId) {
            continue;
        }
        await rm(entryPath, { force: true });
        deleted.push(entryPath);
    }
    return deleted;
};

export const deleteFxSession = async (
    dataDir: string = resolveFxDataDir(),
    sessionId: string,
): Promise<DeleteFxSessionResult> => {
    if (!isSafeSessionId(sessionId)) {
        return { deletedFiles: [], deletedSessionIds: [] };
    }
    return fxDeleteLimiter(async () => {
        const sessionsDir = path.join(dataDir, 'sessions');
        const sessionDir = path.join(sessionsDir, sessionId);
        if (!(await Bun.file(path.join(sessionDir, 'session.json')).exists())) {
            return { deletedFiles: [], deletedSessionIds: [] };
        }
        const deletedFiles = await listFilesRecursively(sessionDir);
        const quarantineDir = path.join(sessionsDir, `.spiracha-delete-${sessionId}-${randomUUID()}`);
        await rename(sessionDir, quarantineDir);
        try {
            await Promise.all([
                removeSessionFromIndex(path.join(sessionsDir, 'index.json'), sessionId),
                removeSessionFromIndex(path.join(sessionsDir, 'relationship-migration-index.json'), sessionId),
            ]);
            deletedFiles.push(...(await removeLatestReferences(sessionsDir, sessionId)));
            await rm(quarantineDir, { force: true, recursive: true });
        } catch (error) {
            await rename(quarantineDir, sessionDir).catch(() => undefined);
            throw error;
        }
        return { deletedFiles, deletedSessionIds: [sessionId] };
    });
};
