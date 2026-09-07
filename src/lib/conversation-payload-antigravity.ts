import type { AntigravityLogEntry } from './antigravity-transcript-normalizer';
import { normalizeAntigravityLogEntries } from './antigravity-transcript-normalizer';
import { normalizeAntigravityConversationMessages } from './conversation-data/antigravity-message-normalizer';
import type {
    ConversationPayloadArtifact,
    ConversationPayloadSource,
    PayloadConversationDraft,
} from './conversation-payload-types';

type AntigravityPayloadEntry = {
    command: string | null;
    content: string;
    createdAtMs: number | null;
    exitCode: number | null;
    model: string | null;
    source: string | null;
    status: string | null;
    stepIndex: number | null;
    thinking: string | null;
    toolCallId: string | null;
    toolCalls: Array<{ args: unknown; id: string | null; name: string }>;
    toolName: string | null;
    type: string | null;
    workdir: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const stringValue = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const finiteNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

const timeValue = (value: unknown): number | null => {
    const number = finiteNumber(value);
    if (number !== null) {
        return number;
    }
    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const parseToolCalls = (value: unknown, index: number): AntigravityPayloadEntry['toolCalls'] => {
    if (value === undefined || value === null) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new Error(`Antigravity transcript tool_calls at entry ${index} is incompatible.`);
    }
    return value.map((candidate, callIndex) => {
        if (!isRecord(candidate)) {
            throw new Error(`Antigravity transcript tool call ${callIndex} is incompatible.`);
        }
        const name = stringValue(candidate.name)?.trim() ?? 'unknown';
        let args = candidate.args;
        if (args === undefined && candidate.arguments !== undefined) {
            args = candidate.arguments;
        }
        return {
            args,
            id: stringValue(candidate.id ?? candidate.callId),
            name,
        };
    });
};

const parseOptionalText = (value: unknown, error: string): string | null => {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== 'string') {
        throw new Error(error);
    }
    return value;
};

const parseOptionalNumber = (value: unknown, error: string): number | null => {
    if (value === undefined || value === null) {
        return null;
    }
    const number = finiteNumber(value);
    if (number === null) {
        throw new Error(error);
    }
    return number;
};

const parseEntry = (value: unknown, index: number): AntigravityPayloadEntry => {
    if (!isRecord(value)) {
        throw new Error(`Antigravity transcript entry ${index} is incompatible.`);
    }
    const source = stringValue(value.source);
    const type = stringValue(value.type);
    const role = stringValue(value.role);
    if (!source && !type && !role) {
        throw new Error(`Antigravity transcript entry ${index} is missing source or type.`);
    }
    const contentValue = parseOptionalText(
        value.content ?? value.text,
        'Antigravity transcript content is incompatible.',
    );
    const thinkingValue = parseOptionalText(
        value.thinking,
        `Antigravity transcript thinking at entry ${index} is incompatible.`,
    );
    const exitCode = value.exit_code ?? value.exitCode;
    const parsedExitCode = parseOptionalNumber(
        exitCode,
        `Antigravity transcript exit code at entry ${index} is incompatible.`,
    );
    const stepValue = value.step_index ?? value.stepIndex;
    const stepIndex = parseOptionalNumber(
        stepValue,
        `Antigravity transcript step index at entry ${index} is incompatible.`,
    );
    return {
        command: stringValue(value.command),
        content: contentValue ?? '',
        createdAtMs: timeValue(value.created_at ?? value.createdAt ?? value.createdAtMs),
        exitCode: parsedExitCode,
        model: stringValue(value.model),
        source,
        status: stringValue(value.status),
        stepIndex,
        thinking: stringValue(thinkingValue),
        toolCallId: stringValue(value.tool_call_id ?? value.toolCallId),
        toolCalls: parseToolCalls(value.tool_calls ?? value.toolCalls, index),
        toolName: stringValue(value.tool_name ?? value.toolName),
        type,
        workdir: stringValue(value.workdir ?? value.cwd),
    };
};

const toLogEntry = (entry: AntigravityPayloadEntry): AntigravityLogEntry => ({
    command: entry.command ?? undefined,
    content: entry.content,
    created_at: entry.createdAtMs === null ? undefined : new Date(entry.createdAtMs).toISOString(),
    exit_code: entry.exitCode ?? undefined,
    model: entry.model ?? undefined,
    source: entry.source ?? undefined,
    status: entry.status ?? undefined,
    step_index: entry.stepIndex ?? undefined,
    thinking: entry.thinking ?? undefined,
    tool_call_id: entry.toolCallId ?? undefined,
    tool_calls: entry.toolCalls.length > 0 ? entry.toolCalls : undefined,
    tool_name: entry.toolName ?? undefined,
    type: entry.type ?? undefined,
    workdir: entry.workdir ?? undefined,
});

const parseArtifacts = (value: unknown): ConversationPayloadArtifact[] => {
    if (value === undefined || value === null) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new Error('Antigravity artifacts are incompatible.');
    }
    return value.map((candidate, index) => {
        if (!isRecord(candidate)) {
            throw new Error(`Antigravity artifact ${index} is incompatible.`);
        }
        const id = stringValue(candidate.id)?.trim() || `artifact-${index}`;
        const title = stringValue(candidate.title ?? candidate.name)?.trim() || id;
        const content = stringValue(candidate.content ?? candidate.text ?? candidate.body);
        if (content === null) {
            if (candidate.path || candidate.filePath || candidate.external) {
                throw new Error('Antigravity artifact references external content; inline it before conversion.');
            }
            throw new Error(`Antigravity artifact ${index} is missing inline content.`);
        }
        return { content, id, title };
    });
};

const ANTIGRAVITY_ENTRY_TYPES = new Set([
    'PLANNER_RESPONSE',
    'RUN_COMMAND',
    'SYSTEM_MESSAGE',
    'USER_INPUT',
    'VIEW_FILE',
]);

const isAntigravityEntry = (value: unknown): boolean => {
    if (!isRecord(value)) {
        return false;
    }
    const source = stringValue(value.source);
    const type = stringValue(value.type);
    return Boolean(
        source === 'MODEL' ||
            source === 'SYSTEM' ||
            source?.startsWith('USER') ||
            (type !== null && ANTIGRAVITY_ENTRY_TYPES.has(type)),
    );
};

const ANTIGRAVITY_WRAPPER_KEYS = [
    'binary',
    'conversationId',
    'conversationPath',
    'protobuf',
    'summaryPath',
    'transcriptPath',
    'workspaceFolder',
    'workspacePath',
];

const hasAnyKey = (record: Record<string, unknown>, keys: string[]): boolean => keys.some((key) => key in record);

const hasAntigravityCollection = (value: unknown): boolean => {
    if (Array.isArray(value)) {
        return value.some(isAntigravityEntry);
    }
    if (!isRecord(value)) {
        return false;
    }
    const nested = value.entries ?? value.records;
    return Array.isArray(nested) && nested.some(isAntigravityEntry);
};

const hasAntigravityNestedWrapper = (value: unknown): boolean => {
    if (!isRecord(value)) {
        return false;
    }
    return hasAnyKey(value, ['conversationId', 'entries', 'records', 'transcript']) || isAntigravityEntry(value);
};

const hasAntigravityWrapper = (record: Record<string, unknown>): boolean =>
    hasAnyKey(record, ANTIGRAVITY_WRAPPER_KEYS) ||
    hasAntigravityNestedWrapper(record.conversation) ||
    [record.entries, record.records, record.transcript].some(hasAntigravityCollection);

const rawEntries = (record: Record<string, unknown>): unknown[] | null => {
    const direct = record.entries ?? record.records;
    if (direct !== undefined) {
        if (!Array.isArray(direct)) {
            throw new Error('Antigravity transcript entries are incompatible.');
        }
        return direct;
    }
    const transcript = record.transcript;
    if (Array.isArray(transcript)) {
        return transcript;
    }
    if (isRecord(transcript)) {
        const nested = transcript.entries ?? transcript.records;
        if (!Array.isArray(nested)) {
            throw new Error('Antigravity transcript is missing entries.');
        }
        return nested;
    }
    return null;
};

const mergeConversationRecord = (value: Record<string, unknown>): Record<string, unknown> => {
    const nested = isRecord(value.conversation) ? value.conversation : null;
    return nested ? { ...value, ...nested } : value;
};

const readConversationEntries = (record: Record<string, unknown>): unknown[] => {
    const values = rawEntries(record);
    if (values) {
        return values;
    }
    if (hasAnyKey(record, ['conversationPath', 'protobuf', 'summaryPath', 'transcriptPath', 'binary'])) {
        throw new Error('Antigravity payload requires external or binary data; provide decoded inline JSON.');
    }
    throw new Error('Antigravity payload is missing transcript entries.');
};

const entryTimestamps = (entries: AntigravityPayloadEntry[]): number[] =>
    entries.map((entry) => entry.createdAtMs).filter((timestamp): timestamp is number => timestamp !== null);

const conversationMetadata = (
    record: Record<string, unknown>,
    entries: AntigravityPayloadEntry[],
): {
    createdAtMs: number | null;
    id: string | null;
    model: string | null;
    title: string | null;
    updatedAtMs: number | null;
    workspacePath: string | null;
} => {
    const timestamps = entryTimestamps(entries);
    const firstTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : null;
    const lastTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : null;
    return {
        createdAtMs: timeValue(record.createdAtMs ?? record.created_at) ?? firstTimestamp,
        id: stringValue(record.conversationId ?? record.id)?.trim() || null,
        model: stringValue(record.model)?.trim() || entries.find((entry) => entry.model?.trim())?.model || null,
        title: stringValue(record.title ?? record.name)?.trim() || null,
        updatedAtMs: timeValue(record.updatedAtMs ?? record.lastUpdatedAtMs ?? record.last_updated_at) ?? lastTimestamp,
        workspacePath: stringValue(record.workspaceFolder ?? record.workspacePath ?? record.worktree),
    };
};

const parseConversation = (value: Record<string, unknown>): PayloadConversationDraft => {
    const record = mergeConversationRecord(value);
    const entries = readConversationEntries(record).map(parseEntry);
    const sourceMessages = normalizeAntigravityLogEntries(entries.map(toLogEntry));
    const metadata = conversationMetadata(record, entries);
    const messages = normalizeAntigravityConversationMessages(
        metadata.id ?? 'antigravity',
        'transcript',
        sourceMessages,
    );
    if (messages.length === 0) {
        throw new Error('Antigravity payload contains no message bodies.');
    }
    const draft: PayloadConversationDraft = {
        artifacts: parseArtifacts(record.artifacts),
        createdAtMs: metadata.createdAtMs,
        messages,
        metadata: isRecord(record.metadata) ? record.metadata : {},
        source: 'antigravity',
        updatedAtMs: metadata.updatedAtMs,
    };
    if (metadata.id) {
        draft.id = metadata.id;
    }
    if (metadata.title) {
        draft.title = metadata.title;
    }
    if (metadata.model) {
        draft.model = metadata.model;
    }
    if (metadata.workspacePath) {
        draft.workspacePath = metadata.workspacePath;
    }
    return draft;
};

const duplicateIds = (drafts: PayloadConversationDraft[]): void => {
    const ids = drafts.map((draft) => draft.id).filter((id): id is string => Boolean(id));
    if (new Set(ids).size !== ids.length) {
        throw new Error('Antigravity payload contains duplicate conversation IDs.');
    }
};

const parseAntigravityArray = (value: unknown[], explicitHint: boolean): PayloadConversationDraft[] | null => {
    if (value.length === 0) {
        return null;
    }
    const records = value.filter(isRecord);
    if (records.length !== value.length) {
        throw new Error('Antigravity payload contains an incompatible record.');
    }
    const wrappers = records.filter(hasAntigravityWrapper);
    if (wrappers.length === records.length && wrappers.length > 0) {
        const drafts = records.map((record) => parseConversation(record));
        duplicateIds(drafts);
        return drafts;
    }
    if (wrappers.length > 0) {
        throw new Error('Antigravity payload mixes conversation and transcript records.');
    }
    if (!records.some(isAntigravityEntry) && !explicitHint) {
        return null;
    }
    return [parseConversation({ entries: records })];
};

const parseAntigravityObject = (
    value: Record<string, unknown>,
    explicitHint: boolean,
): PayloadConversationDraft[] | null => {
    if (hasAntigravityWrapper(value)) {
        return [parseConversation(value)];
    }
    if (isAntigravityEntry(value)) {
        return [parseConversation({ entries: [value] })];
    }
    if (hasAnyKey(value, ['conversationPath', 'transcriptPath', 'protobuf', 'binary'])) {
        return [parseConversation(value)];
    }
    return explicitHint ? [parseConversation(value)] : null;
};

export const parseAntigravityPayload = (
    value: unknown,
    sourceHint?: ConversationPayloadSource,
): PayloadConversationDraft[] | null => {
    if (sourceHint !== undefined && sourceHint !== 'antigravity') {
        return null;
    }
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
        throw new Error('Antigravity protobuf payloads are binary; provide decoded JSON instead.');
    }
    const explicitHint = sourceHint === 'antigravity';
    if (Array.isArray(value)) {
        return parseAntigravityArray(value, explicitHint);
    }
    if (!isRecord(value)) {
        return null;
    }
    return parseAntigravityObject(value, explicitHint);
};
