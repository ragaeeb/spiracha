import os from 'node:os';
import path from 'node:path';
import type {
    CommandCodeSessionSummary,
    CommandCodeSessionTranscript,
    CommandCodeWorkspaceGroup,
} from './command-code-exporter-types';
import { mapWithConcurrency } from './concurrency';
import {
    createTextMessage,
    finalizeMessages,
    getToolNamespace,
    normalizeAssistantPhase,
    normalizeRole,
    normalizeToolStatus,
    toDateMs,
} from './conversation-data/adapter-helpers';
import type { ConversationMessage } from './conversation-data/types';
import { getPortablePathBasename } from './portable-path';
import { readDirectoryEntriesIfExists } from './shared';
import { asBoolean, asObject, asString, cleanInlineTitle, formatModelLabel, type JsonValue } from './shared-text';

const COMMAND_CODE_PROJECTS_DIRECTORY_NAME = 'projects';
const COMMAND_CODE_WORKSPACE_KEY_PREFIX = 'command-code:';
const COMMAND_CODE_DISCOVERY_CONCURRENCY = 4;
const MAX_COMMAND_CODE_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export const getDefaultCommandCodeDataDir = (_env: NodeJS.ProcessEnv = process.env, homeDir = os.homedir()): string => {
    return path.join(homeDir, '.commandcode');
};

export const DEFAULT_COMMAND_CODE_DATA_DIR = getDefaultCommandCodeDataDir();

export const resolveCommandCodeProjectsDir = (): string => {
    const projectsDir = process.env.SPIRACHA_COMMAND_CODE_PROJECTS_DIR?.trim();
    if (projectsDir) {
        return projectsDir;
    }

    const dataDir = process.env.SPIRACHA_COMMAND_CODE_DIR?.trim();
    return path.join(dataDir || DEFAULT_COMMAND_CODE_DATA_DIR, COMMAND_CODE_PROJECTS_DIRECTORY_NAME);
};

type CommandCodeBlock = Record<string, JsonValue>;

type CommandCodeRecord = {
    content: CommandCodeBlock[];
    id: string;
    meta: Record<string, JsonValue>;
    model: string | null;
    parentId: string | null;
    raw: Record<string, JsonValue>;
    role: string;
    timestamp: string | null;
};

type ParsedCommandCodeSession = CommandCodeSessionTranscript & {
    rawText: string;
};

const isNonBlankString = (value: JsonValue | undefined): value is string => {
    return typeof value === 'string' && value.trim().length > 0;
};

const requireObject = (value: JsonValue | undefined, message: string): Record<string, JsonValue> => {
    const object = value === undefined ? null : asObject(value);
    if (!object) {
        throw new Error(message);
    }
    return object;
};

const requireString = (value: JsonValue | undefined, message: string): string => {
    if (!isNonBlankString(value)) {
        throw new Error(message);
    }
    return value;
};

const optionalString = (value: JsonValue | undefined, message: string): string | null => {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== 'string') {
        throw new Error(message);
    }
    return value;
};

const optionalRecord = (value: JsonValue | undefined, message: string): Record<string, JsonValue> => {
    if (value === undefined || value === null) {
        return {};
    }
    return requireObject(value, message);
};

const blockId = (recordId: string, blockIndex: number, type: string) => `${recordId}:${type}:${blockIndex}`;

const blockType = (block: CommandCodeBlock): string =>
    requireString(block.type, 'Command Code content block is missing type.');

const parseCommandCodeRecord = (
    value: Record<string, JsonValue>,
    previousId: string | null,
    seenIds: Set<string>,
): CommandCodeRecord => {
    if (asString(value.type) !== 'message') {
        throw new Error('Command Code session contains an unsupported record type.');
    }

    const id = requireString(value.id, 'Command Code message is missing an id.');
    if (seenIds.has(id)) {
        throw new Error(`Command Code session contains duplicate message id: ${id}`);
    }

    const parentId = optionalString(value.parentId, `Command Code message has an invalid parent id: ${id}`);
    if (parentId !== previousId) {
        throw new Error(`Command Code message ${id} has a parent that does not match the previous record.`);
    }

    const message = requireObject(value.message, `Command Code message ${id} is missing its message payload.`);
    const role = requireString(message.role, `Command Code message ${id} is missing a role.`);
    if (!Array.isArray(message.content)) {
        throw new Error(`Command Code message ${id} is missing a content array.`);
    }

    const content = message.content.map((block, index) => {
        const object = requireObject(block, `Command Code message ${id} has an invalid content block at ${index}.`);
        blockType(object);
        return object;
    });
    const modelValue = value.model ?? message.model;
    const model = optionalString(modelValue, `Command Code message ${id} has an invalid model.`);

    seenIds.add(id);
    return {
        content,
        id,
        meta: optionalRecord(message.meta, `Command Code message ${id} has invalid metadata.`),
        model,
        parentId,
        raw: value,
        role,
        timestamp: optionalString(value.timestamp, `Command Code message ${id} has an invalid timestamp.`),
    };
};

const parseCommandCodeRecords = (rawRecords: Record<string, JsonValue>[], fileId: string) => {
    const header = rawRecords[0];
    if (!header || asString(header.type) !== 'session') {
        throw new Error(`Command Code session ${fileId} is missing its session header.`);
    }

    const headerId = requireString(header.id, `Command Code session ${fileId} is missing its header id.`);
    if (headerId !== fileId) {
        throw new Error(`Command Code session header id ${headerId} does not match its filename ${fileId}.`);
    }

    const cwd = requireString(header.cwd, `Command Code session ${fileId} is missing its workspace path.`);
    const seenIds = new Set<string>();
    let previousId: string | null = null;
    const records: CommandCodeRecord[] = [];
    for (const rawRecord of rawRecords.slice(1)) {
        const record = parseCommandCodeRecord(rawRecord, previousId, seenIds);
        records.push(record);
        previousId = record.id;
    }

    return { cwd, header, records };
};

const jsonText = (value: JsonValue | undefined): string | null => {
    if (value === undefined || value === null) {
        return null;
    }
    return typeof value === 'string' ? value : JSON.stringify(value);
};

const toolResultText = (value: JsonValue | undefined): string | null => {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        const parts = value.flatMap((item) => {
            if (typeof item === 'string') {
                return [item];
            }
            const object = asObject(item);
            const text = object && asString(object.text);
            return text !== null ? [text] : [JSON.stringify(item)];
        });
        return parts.join('\n');
    }
    return JSON.stringify(value);
};

const recordTimestamp = (record: CommandCodeRecord): number | null => {
    return toDateMs(record.timestamp) ?? (typeof record.meta.createdAt === 'number' ? record.meta.createdAt : null);
};

const isHumanUserRecord = (record: CommandCodeRecord): boolean => {
    return (
        record.role === 'user' &&
        asString(record.meta.source) !== 'tool' &&
        !record.content.some((block) => blockType(block) === 'tool_result')
    );
};

const finalAssistantTextBlockIds = (records: CommandCodeRecord[]): Set<string> => {
    const finalIds = new Set<string>();
    let candidateId: string | null = null;
    let pendingTool = false;

    const closeTurn = () => {
        if (candidateId && !pendingTool) {
            finalIds.add(candidateId);
        }
        candidateId = null;
        pendingTool = false;
    };

    for (const record of records) {
        if (isHumanUserRecord(record)) {
            closeTurn();
            continue;
        }

        for (const [index, block] of record.content.entries()) {
            const type = blockType(block);
            if (record.role === 'assistant' && type === 'tool_use') {
                candidateId = null;
                pendingTool = true;
                continue;
            }
            if (record.role === 'assistant' && type === 'text' && asString(block.text)?.trim()) {
                candidateId = blockId(record.id, index, type);
                pendingTool = false;
            }
        }
    }

    closeTurn();
    return finalIds;
};

type ToolDescriptor = {
    inputText: string | null;
    name: string;
};

const collectToolDescriptors = (records: CommandCodeRecord[]): Map<string, ToolDescriptor> => {
    const descriptors = new Map<string, ToolDescriptor>();
    for (const record of records) {
        for (const block of record.content) {
            if (blockType(block) !== 'tool_use') {
                continue;
            }

            const id = asString(block.id);
            if (!id) {
                continue;
            }
            const descriptor = {
                inputText: jsonText(block.input),
                name: asString(block.name) || 'unknown',
            };
            const previous = descriptors.get(id);
            if (previous && JSON.stringify(previous) !== JSON.stringify(descriptor)) {
                throw new Error(`Command Code session contains conflicting tool call id: ${id}`);
            }
            descriptors.set(id, descriptor);
        }
    }
    return descriptors;
};

const messageMetadata = (
    record: CommandCodeRecord,
    block: CommandCodeBlock,
    blockIndex: number,
): Record<string, unknown> => ({
    blockIndex,
    blockType: blockType(block),
    parentId: record.parentId,
    recordId: record.id,
    source: asString(record.meta.source),
});

const createCommandCodeMessage = (input: {
    createdAtMs: number | null;
    id: string;
    metadata: Record<string, unknown>;
    model: string | null;
    phase: ConversationMessage['phase'];
    role: ConversationMessage['role'];
    text: string | null;
    toolEvidence?: ConversationMessage['toolEvidence'];
}) =>
    createTextMessage({
        createdAtMs: input.createdAtMs,
        id: input.id,
        ...(input.model ? { model: input.model } : {}),
        metadata: input.metadata,
        order: 0,
        phase: input.phase,
        role: input.role,
        text: input.text,
        ...(input.toolEvidence ? { toolEvidence: input.toolEvidence } : {}),
    });

const textBlockToMessages = (
    record: CommandCodeRecord,
    block: CommandCodeBlock,
    index: number,
    finalIds: Set<string>,
) => {
    const id = blockId(record.id, index, 'text');
    return createCommandCodeMessage({
        createdAtMs: recordTimestamp(record),
        id,
        metadata: messageMetadata(record, block, index),
        model: record.model,
        phase:
            record.role === 'assistant'
                ? normalizeAssistantPhase(finalIds.has(id) ? 'final_answer' : 'commentary', 'commentary')
                : 'unknown',
        role: normalizeRole(record.role),
        text: asString(block.text),
    });
};

const thinkingBlockToMessages = (record: CommandCodeRecord, block: CommandCodeBlock, index: number) =>
    createCommandCodeMessage({
        createdAtMs: recordTimestamp(record),
        id: blockId(record.id, index, 'thinking'),
        metadata: messageMetadata(record, block, index),
        model: record.model,
        phase: 'reasoning',
        role: 'assistant',
        text: asString(block.thinking),
    });

const toolUseBlockToMessages = (record: CommandCodeRecord, block: CommandCodeBlock, index: number) => {
    const toolName = asString(block.name) || 'unknown';
    const inputText = jsonText(block.input);
    const callId = asString(block.id);
    return createCommandCodeMessage({
        createdAtMs: recordTimestamp(record),
        id: blockId(record.id, index, 'tool_use'),
        metadata: { ...messageMetadata(record, block, index), callId, toolName },
        model: null,
        phase: 'tool_call',
        role: 'tool',
        text: [toolName, inputText].filter(Boolean).join('\n'),
        toolEvidence: {
            callId,
            command: null,
            durationMs: null,
            exitCode: null,
            inputText,
            name: toolName,
            namespace: getToolNamespace(toolName),
            outputText: null,
            status: normalizeToolStatus(null),
            workdir: null,
        },
    });
};

const toolResultBlockToMessages = (
    record: CommandCodeRecord,
    block: CommandCodeBlock,
    index: number,
    toolDescriptors: Map<string, ToolDescriptor>,
) => {
    const callId = asString(block.tool_use_id);
    const toolName = (callId ? toolDescriptors.get(callId)?.name : null) ?? 'tool_result';
    const outputText = toolResultText(block.content);
    const isError = asBoolean(block.is_error);
    return createCommandCodeMessage({
        createdAtMs: recordTimestamp(record),
        id: blockId(record.id, index, 'tool_result'),
        metadata: {
            ...messageMetadata(record, block, index),
            content: block.content ?? null,
            isError,
            toolUseId: callId,
        },
        model: null,
        phase: 'tool_output',
        role: 'tool',
        text: outputText,
        toolEvidence: {
            callId,
            command: null,
            durationMs: null,
            exitCode: null,
            inputText: null,
            name: toolName,
            namespace: getToolNamespace(toolName),
            outputText,
            status: normalizeToolStatus(isError ? 'error' : 'success', null, isError),
            workdir: null,
        },
    });
};

const blockToMessages = (
    record: CommandCodeRecord,
    block: CommandCodeBlock,
    index: number,
    finalIds: Set<string>,
    toolDescriptors: Map<string, ToolDescriptor>,
) => {
    switch (blockType(block)) {
        case 'text':
            return textBlockToMessages(record, block, index, finalIds);
        case 'thinking':
            return thinkingBlockToMessages(record, block, index);
        case 'tool_use':
            return toolUseBlockToMessages(record, block, index);
        case 'tool_result':
            return toolResultBlockToMessages(record, block, index, toolDescriptors);
        default:
            return [];
    }
};

const recordsToMessages = (records: CommandCodeRecord[]): ConversationMessage[] => {
    const finalIds = finalAssistantTextBlockIds(records);
    const toolDescriptors = collectToolDescriptors(records);
    return finalizeMessages(
        records.flatMap((record) =>
            record.content.flatMap((block, index) => blockToMessages(record, block, index, finalIds, toolDescriptors)),
        ),
    );
};

const maxTimestamp = (values: Array<number | null>): number | null => {
    const finiteValues = values.filter((value): value is number => value !== null && Number.isFinite(value));
    return finiteValues.length > 0 ? Math.max(...finiteValues) : null;
};

const minTimestamp = (values: Array<number | null>): number | null => {
    const finiteValues = values.filter((value): value is number => value !== null && Number.isFinite(value));
    return finiteValues.length > 0 ? Math.min(...finiteValues) : null;
};

export const createCommandCodeWorkspaceKey = (cwd: string): string => {
    return `${COMMAND_CODE_WORKSPACE_KEY_PREFIX}${Buffer.from(cwd, 'utf8').toString('base64url')}`;
};

const buildSessionSummary = (
    sessionId: string,
    filePath: string,
    cwd: string,
    header: Record<string, JsonValue>,
    records: CommandCodeRecord[],
    messages: ConversationMessage[],
): CommandCodeSessionSummary => {
    const timestamps = [toDateMs(asString(header.timestamp)), ...records.map(recordTimestamp)];
    const firstUserMessage = messages.find((message) => message.role === 'user');
    const firstTextMessage = messages.find((message) => message.role === 'assistant');
    const model = records.findLast((record) => record.role === 'assistant' && record.model)?.model ?? null;
    const workspaceKey = createCommandCodeWorkspaceKey(cwd);
    const workspaceLabel = getPortablePathBasename(cwd) || cwd;

    return {
        assistantMessageCount: messages.filter((message) => message.role === 'assistant').length,
        createdAtMs: minTimestamp(timestamps),
        cwd,
        filePath,
        lastActiveAtMs: maxTimestamp(timestamps),
        messageCount: messages.length,
        model,
        modelLabel: model ? formatModelLabel(model) : null,
        recordCount: records.length,
        renderableMessageCount: messages.length,
        sessionId,
        title: cleanInlineTitle(firstUserMessage?.text || firstTextMessage?.text || sessionId),
        toolCallCount: messages.filter((message) => message.phase === 'tool_call').length,
        toolOutputCount: messages.filter((message) => message.phase === 'tool_output').length,
        userMessageCount: messages.filter((message) => message.role === 'user').length,
        workspaceKey,
        workspaceLabel,
        worktree: cwd,
    };
};

const parseCommandCodeSession = (rawText: string, filePath: string, fileId: string): ParsedCommandCodeSession => {
    const rawRecords: Record<string, JsonValue>[] = [];
    for (const [index, line] of rawText.split(/\r?\n/u).entries()) {
        if (!line.trim()) {
            continue;
        }
        let value: JsonValue;
        try {
            value = JSON.parse(line) as JsonValue;
        } catch {
            throw new Error(`Command Code session ${fileId} has invalid JSONL at line ${index + 1}.`);
        }
        const record = asObject(value);
        if (!record) {
            throw new Error(`Command Code session ${fileId} has a non-object record at line ${index + 1}.`);
        }
        rawRecords.push(record);
    }

    const parsed = parseCommandCodeRecords(rawRecords, fileId);
    const messages = recordsToMessages(parsed.records);
    return {
        messages,
        rawRecords,
        rawText,
        session: buildSessionSummary(fileId, filePath, parsed.cwd, parsed.header, parsed.records, messages),
    };
};

const fileIdFromPath = (filePath: string): string => path.basename(filePath, '.jsonl');

const listCommandCodeSessionFiles = async (projectsDir: string): Promise<string[]> => {
    const projectEntries = (await readDirectoryEntriesIfExists(projectsDir))
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => left.name.localeCompare(right.name));
    const files: string[] = [];
    for (const projectEntry of projectEntries) {
        const projectDir = path.join(projectsDir, projectEntry.name);
        const entries = (await readDirectoryEntriesIfExists(projectDir)).sort((left, right) =>
            left.name.localeCompare(right.name),
        );
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.jsonl') && !entry.name.endsWith('.checkpoints.jsonl')) {
                files.push(path.join(projectDir, entry.name));
            }
        }
    }
    return files;
};

const readCommandCodeSessionFile = async (filePath: string): Promise<ParsedCommandCodeSession | null> => {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
        return null;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_COMMAND_CODE_FILE_SIZE_BYTES) {
        throw new Error(
            `Command Code session file is larger than ${MAX_COMMAND_CODE_FILE_SIZE_BYTES} bytes: ${filePath}`,
        );
    }

    let rawText: string;
    try {
        rawText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        throw new Error(`Command Code session file is not valid UTF-8: ${filePath}`);
    }

    return parseCommandCodeSession(rawText, filePath, fileIdFromPath(filePath));
};

const resolveDuplicateSessions = (sessions: ParsedCommandCodeSession[]): ParsedCommandCodeSession[] => {
    const byId = new Map<string, ParsedCommandCodeSession>();
    for (const session of [...sessions].sort((left, right) =>
        left.session.filePath.localeCompare(right.session.filePath),
    )) {
        const previous = byId.get(session.session.sessionId);
        if (!previous) {
            byId.set(session.session.sessionId, session);
            continue;
        }
        if (previous.rawText !== session.rawText) {
            throw new Error(
                `Command Code session ${session.session.sessionId} has conflicting copies in ${previous.session.filePath} and ${session.session.filePath}.`,
            );
        }
    }
    return [...byId.values()];
};

const readAllCommandCodeSessions = async (projectsDir: string): Promise<ParsedCommandCodeSession[]> => {
    const files = await listCommandCodeSessionFiles(projectsDir);
    const sessions = await mapWithConcurrency(files, COMMAND_CODE_DISCOVERY_CONCURRENCY, async (filePath) =>
        readCommandCodeSessionFile(filePath),
    );
    return resolveDuplicateSessions(
        sessions.filter((session): session is ParsedCommandCodeSession => session !== null),
    );
};

const sortSessions = (left: CommandCodeSessionSummary, right: CommandCodeSessionSummary) => {
    return (right.lastActiveAtMs ?? 0) - (left.lastActiveAtMs ?? 0) || left.sessionId.localeCompare(right.sessionId);
};

export const listCommandCodeSessionSummaries = async (
    projectsDir = resolveCommandCodeProjectsDir(),
): Promise<CommandCodeSessionSummary[]> => {
    const sessions = await readAllCommandCodeSessions(projectsDir);
    return sessions.map((session) => session.session).sort(sortSessions);
};

export const listCommandCodeSessionSummariesForWorkspace = async (
    projectsDir: string,
    workspaceKey: string,
): Promise<CommandCodeSessionSummary[]> => {
    return (await listCommandCodeSessionSummaries(projectsDir)).filter(
        (session) => session.workspaceKey === workspaceKey,
    );
};

export const listCommandCodeWorkspaceGroups = async (
    projectsDir = resolveCommandCodeProjectsDir(),
): Promise<CommandCodeWorkspaceGroup[]> => {
    const groups = new Map<string, CommandCodeWorkspaceGroup>();
    for (const session of await listCommandCodeSessionSummaries(projectsDir)) {
        const group = groups.get(session.workspaceKey) ?? {
            assistantMessageCount: 0,
            key: session.workspaceKey,
            label: session.workspaceLabel,
            lastActiveAtMs: null,
            messageCount: 0,
            sessionCount: 0,
            toolCallCount: 0,
            toolOutputCount: 0,
            userMessageCount: 0,
            worktree: session.worktree,
        };
        group.assistantMessageCount += session.assistantMessageCount;
        group.lastActiveAtMs = Math.max(group.lastActiveAtMs ?? 0, session.lastActiveAtMs ?? 0) || null;
        group.messageCount += session.messageCount;
        group.sessionCount += 1;
        group.toolCallCount += session.toolCallCount;
        group.toolOutputCount += session.toolOutputCount;
        group.userMessageCount += session.userMessageCount;
        groups.set(session.workspaceKey, group);
    }
    return [...groups.values()].sort(
        (left, right) =>
            (right.lastActiveAtMs ?? 0) - (left.lastActiveAtMs ?? 0) || left.worktree.localeCompare(right.worktree),
    );
};

export const readCommandCodeSessionTranscript = async (
    projectsDir: string,
    sessionId: string,
): Promise<CommandCodeSessionTranscript | null> => {
    const sessions = await readAllCommandCodeSessions(projectsDir);
    return sessions.find((session) => session.session.sessionId === sessionId) ?? null;
};
