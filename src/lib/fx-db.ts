import { randomUUID } from 'node:crypto';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { createConcurrencyLimiter, mapWithConcurrency } from './concurrency';
import type {
    DeleteFxSessionResult,
    FxSessionSummary,
    FxSessionTranscript,
    FxToolCall,
    FxTranscriptMessage,
    FxWorkspaceGroup,
} from './fx-exporter-types';
import { getDefaultFxDataDir, resolveFxDataDir } from './fx-exporter-types';
import {
    consumeFxTurnSourceEvent,
    createFxToolCall,
    createFxTurnSourceParseState,
    createMessage,
    type FxSessionRecord,
    type FxTurnSource,
    finalizeFxTurnSourceParse,
    firstString,
    getToolCallInputs,
    getWorkspaceKey,
    objectArray,
    parseAssistantMessage,
    parseFxSessionRecordPayload,
    parseUserMessage,
    toSessionSummary,
    WORKSPACE_KEY_PREFIX,
} from './fx-transcript-parser';
import { getPortablePathBasename } from './portable-path';
import { readDirectoryEntriesIfExists, readJsonlObjects } from './shared';
import { asObject, asString, type JsonValue } from './shared-text';

export { getDefaultFxDataDir, resolveFxDataDir };

const READ_CONCURRENCY = 4;

const fxDeleteLimiter = createConcurrencyLimiter(1);

const isSafeSessionId = (sessionId: string): boolean =>
    Boolean(sessionId) && sessionId !== '.' && sessionId !== '..' && /^[A-Za-z0-9._-]+$/u.test(sessionId);

type ReadFxOptions = {
    includeRawPayloads?: boolean;
};

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
    return parseFxSessionRecordPayload({
        checkpoint,
        display,
        indexRecord,
        session,
        sessionId,
    });
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

const parseToolCalls = async (
    sessionDir: string,
    step: Record<string, JsonValue>,
    includeRawPayloads: boolean,
): Promise<FxToolCall[]> => {
    return Promise.all(
        getToolCallInputs(step).map(async (input) =>
            createFxToolCall(
                input,
                includeRawPayloads,
                input.result ? await resolveToolOutput(sessionDir, input.result) : null,
            ),
        ),
    );
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

const readTurnSources = async (sessionDir: string): Promise<FxTurnSource[]> => {
    const checkpoint = await readJsonObject(path.join(sessionDir, 'checkpoint.json'));
    const state = createFxTurnSourceParseState(checkpoint, 0);
    for await (const event of readJsonlObjects(path.join(sessionDir, 'events.jsonl'))) {
        consumeFxTurnSourceEvent(event, state);
    }
    return finalizeFxTurnSourceParse(state);
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
    const session = toSessionSummary(path.join(dataDir, 'sessions', record.sessionId), record, messages);
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
