import { openCodePartsToMessages } from './conversation-data/opencode-message-normalizer';
import type { ConversationMessage } from './conversation-data/types';
import type { ConversationPayloadSource, PayloadConversationDraft } from './conversation-payload-types';
import type {
    OpenCodeModelInfo,
    OpenCodePartType,
    OpenCodeTranscriptMessage,
    OpenCodeTranscriptPart,
} from './opencode-exporter-types';

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

const nestedTime = (record: Record<string, unknown>, key: 'created' | 'updated'): number | null => {
    const time = isRecord(record.time) ? record.time : null;
    return timeValue(record[`${key}AtMs`] ?? record[`time${key[0]!.toUpperCase()}${key.slice(1)}`] ?? time?.[key]);
};

const jsonText = (value: unknown): string | null => {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value === 'string') {
        return value;
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        throw new Error('OpenCode payload contains a non-serializable tool value.');
    }
};

const partType = (value: unknown): OpenCodePartType => {
    if (
        value === 'reasoning' ||
        value === 'step-finish' ||
        value === 'step-start' ||
        value === 'text' ||
        value === 'tool'
    ) {
        return value;
    }
    if (typeof value === 'string') {
        return 'unknown';
    }
    throw new Error('OpenCode part type is missing or incompatible.');
};

const modelInfo = (value: unknown): OpenCodeModelInfo | null => {
    if (typeof value === 'string' && value.trim()) {
        return { id: value, providerID: null, raw: value, variant: null };
    }
    if (!isRecord(value)) {
        return null;
    }
    return {
        id: stringValue(value.id ?? value.modelID ?? value.modelId),
        providerID: stringValue(value.providerID ?? value.providerId),
        raw: null,
        variant: stringValue(value.variant),
    };
};

const modelId = (value: unknown): string | null => {
    const model = modelInfo(value);
    return model?.id ?? null;
};

type OpenCodePartContext = {
    base: {
        createdAtMs: number;
        messageId: string;
        partId: string;
        raw: Record<string, never>;
        role: string;
        type: OpenCodePartType;
        updatedAtMs: number;
    };
    data: Record<string, unknown>;
    value: Record<string, unknown>;
};

const UNKNOWN_TIME = Number.NaN;

const partTime = (record: Record<string, unknown>, key: 'created' | 'updated', fallback: number): number =>
    timeValue(record[`${key}AtMs`] ?? record[`time${key[0]!.toUpperCase()}${key.slice(1)}`]) ??
    nestedTime(record, key) ??
    fallback;

const parsePartContext = (
    value: unknown,
    messageId: string,
    messageRole: string,
    index: number,
    fallbackCreatedAtMs: number,
    fallbackUpdatedAtMs: number,
): OpenCodePartContext => {
    if (!isRecord(value)) {
        throw new Error(`OpenCode part ${index} is incompatible.`);
    }
    const data = isRecord(value.data) ? value.data : value;
    const partId =
        stringValue(value.partId ?? value.id ?? data.partId ?? data.id)?.trim() || `${messageId}:part-${index}`;
    const createdAtMs = partTime(value, 'created', partTime(data, 'created', fallbackCreatedAtMs));
    const updatedAtMs = partTime(value, 'updated', partTime(data, 'updated', fallbackUpdatedAtMs));
    const type = partType(data.type ?? value.type);
    return {
        base: {
            createdAtMs,
            messageId,
            partId,
            raw: {},
            role: stringValue(value.role ?? data.role) ?? messageRole,
            type,
            updatedAtMs,
        },
        data,
        value,
    };
};

const parseTextPart = (context: OpenCodePartContext): OpenCodeTranscriptPart => {
    const text = stringValue(context.data.text ?? context.value.text);
    if (text === null) {
        throw new Error(`OpenCode ${context.base.type} part ${context.base.partId} is missing text.`);
    }
    return { ...context.base, text };
};

const parseToolPart = (context: OpenCodePartContext): OpenCodeTranscriptPart => {
    const { base, data, value } = context;
    const state = isRecord(data.state) ? data.state : null;
    const stateTime = isRecord(state?.time) ? state.time : null;
    const argumentsValue = state?.input ?? data.input ?? value.input ?? data.arguments;
    const outputValue = state?.output ?? state?.error ?? data.output ?? value.output;
    return {
        ...base,
        argumentsText: jsonText(argumentsValue),
        callId: stringValue(data.callID ?? data.callId ?? value.callID ?? value.callId),
        endTimeMs: timeValue(stateTime?.end ?? data.endTimeMs ?? value.endTimeMs),
        outputText: jsonText(outputValue),
        startTimeMs: timeValue(stateTime?.start ?? data.startTimeMs ?? value.startTimeMs),
        status: stringValue(state?.status ?? data.status ?? value.status),
        title: stringValue(state?.title ?? data.title ?? value.title),
        toolName: stringValue(data.tool ?? data.toolName ?? value.toolName),
    };
};

const parseStepFinishPart = (context: OpenCodePartContext): OpenCodeTranscriptPart => {
    const { base, data } = context;
    const tokens = isRecord(data.tokens) ? data.tokens : null;
    const cache = isRecord(tokens?.cache) ? tokens.cache : null;
    return {
        ...base,
        reason: stringValue(data.reason),
        snapshot: stringValue(data.snapshot),
        tokens: tokens
            ? {
                  cacheRead: finiteNumber(cache?.read) ?? 0,
                  cacheWrite: finiteNumber(cache?.write) ?? 0,
                  input: finiteNumber(tokens.input) ?? 0,
                  output: finiteNumber(tokens.output) ?? 0,
                  reasoning: finiteNumber(tokens.reasoning) ?? 0,
                  total: finiteNumber(tokens.total) ?? 0,
              }
            : null,
    };
};

const parsePart = (
    value: unknown,
    messageId: string,
    messageRole: string,
    index: number,
    fallbackCreatedAtMs: number,
    fallbackUpdatedAtMs: number,
): OpenCodeTranscriptPart => {
    const context = parsePartContext(value, messageId, messageRole, index, fallbackCreatedAtMs, fallbackUpdatedAtMs);
    switch (context.base.type) {
        case 'text':
        case 'reasoning':
            return parseTextPart(context);
        case 'tool':
            return parseToolPart(context);
        case 'step-finish':
            return parseStepFinishPart(context);
        case 'step-start':
            return { ...context.base, snapshot: stringValue(context.data.snapshot) };
        default:
            return context.base;
    }
};

const parseMessage = (value: unknown, index: number): OpenCodeTranscriptMessage => {
    if (!isRecord(value)) {
        throw new Error(`OpenCode message ${index} is incompatible.`);
    }
    const info = isRecord(value.info) ? value.info : null;
    const source = info ?? value;
    const messageId = stringValue(source.id ?? source.messageId)?.trim() || `message-${index}`;
    const role = stringValue(source.role) ?? 'unknown';
    const rawParts = value.parts;
    if (!Array.isArray(rawParts)) {
        throw new Error(`OpenCode message ${messageId} is missing parts.`);
    }
    const createdAtMs =
        timeValue(source.createdAtMs ?? source.timeCreated) ?? nestedTime(source, 'created') ?? UNKNOWN_TIME;
    const updatedAtMs =
        timeValue(source.updatedAtMs ?? source.timeUpdated) ?? nestedTime(source, 'updated') ?? createdAtMs;
    return {
        createdAtMs,
        messageId,
        parts: rawParts.map((part, partIndex) => parsePart(part, messageId, role, partIndex, createdAtMs, updatedAtMs)),
        raw: {},
        role,
        updatedAtMs,
    };
};

const assertUnique = (values: string[], error: string): void => {
    if (new Set(values).size !== values.length) {
        throw new Error(error);
    }
};

const sessionInfo = (record: Record<string, unknown>): Record<string, unknown> => {
    const session = isRecord(record.session) ? record.session : null;
    const info = isRecord(record.info) ? record.info : null;
    return { ...(info ?? {}), ...(session ?? {}), ...record };
};

const messageModel = (message: Record<string, unknown>): string | null => {
    const info = isRecord(message.info) ? message.info : message;
    return modelId(info.model ?? info.modelID ?? info.modelId);
};

const OPEN_CODE_NON_TEXT_PART_TYPES = new Set(['reasoning', 'step-finish', 'step-start', 'tool']);

const hasOpenCodeMessageParts = (value: unknown): boolean => {
    if (!isRecord(value) || !Array.isArray(value.parts)) {
        return false;
    }
    if (isRecord(value.info)) {
        return true;
    }
    return value.parts.some(
        (part) =>
            isRecord(part) &&
            (isRecord(part.data) || (typeof part.type === 'string' && OPEN_CODE_NON_TEXT_PART_TYPES.has(part.type))),
    );
};

const hasMessageParts = (value: unknown): boolean => isRecord(value) && Array.isArray(value.parts);

const hasOpenCodeInfoMarker = (value: unknown): boolean => {
    if (!isRecord(value)) {
        return false;
    }
    return [
        'agent',
        'directory',
        'model',
        'modelID',
        'modelId',
        'permission',
        'projectID',
        'projectId',
        'providerID',
        'providerId',
        'time',
        'title',
        'variant',
        'worktree',
    ].some((key) => key in value);
};

const hasOpenCodeEnvelope = (record: Record<string, unknown>): boolean =>
    isRecord(record.session) ||
    hasOpenCodeInfoMarker(record.info) ||
    (isRecord(record.transcript) &&
        (isRecord(record.transcript.session) || hasOpenCodeInfoMarker(record.transcript.info)));

const rawMessages = (record: Record<string, unknown>, allowGenericMessages = false): unknown[] | null => {
    const transcript = record.transcript;
    const messages = Array.isArray(record.messages)
        ? record.messages
        : isRecord(transcript) && Array.isArray(transcript.messages)
          ? transcript.messages
          : null;
    if (!messages) {
        return null;
    }
    if (
        messages.length > 0 &&
        messages.every(
            (message) => hasOpenCodeMessageParts(message) || (allowGenericMessages && hasMessageParts(message)),
        )
    ) {
        return messages;
    }
    if (messages.length === 0 && hasOpenCodeEnvelope(record)) {
        return messages;
    }
    if (hasOpenCodeEnvelope(record)) {
        return messages;
    }
    return null;
};

const conversationModel = (record: Record<string, unknown>, values: unknown[]): string | null => {
    const direct = modelId(record.model ?? record.modelID ?? record.modelId);
    if (direct) {
        return direct;
    }
    return (
        values
            .map((message) => (isRecord(message) ? messageModel(message) : null))
            .find((model): model is string => Boolean(model)) ?? null
    );
};

const conversationTimes = (
    record: Record<string, unknown>,
    messages: OpenCodeTranscriptMessage[],
): { createdAtMs: number | null; updatedAtMs: number | null } => {
    const timestamps = messages.map((message) => message.createdAtMs).filter(Number.isFinite);
    const firstTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : null;
    const lastTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : null;
    return {
        createdAtMs:
            timeValue(record.createdAtMs ?? record.timeCreated ?? record.createdAt) ??
            nestedTime(record, 'created') ??
            firstTimestamp,
        updatedAtMs:
            timeValue(record.updatedAtMs ?? record.timeUpdated ?? record.updatedAt) ??
            nestedTime(record, 'updated') ??
            lastTimestamp,
    };
};

const conversationTotalTokens = (record: Record<string, unknown>): number =>
    finiteNumber(record.totalTokens) ??
    ['tokensInput', 'tokensOutput', 'tokensReasoning', 'tokensCacheRead', 'tokensCacheWrite']
        .map((key) => finiteNumber(record[key]) ?? 0)
        .reduce((sum, value) => sum + value, 0);

const conversationWorkspace = (record: Record<string, unknown>): string | null =>
    stringValue(record.worktree ?? record.directory ?? record.workspacePath);

const parseConversation = (value: Record<string, unknown>, allowGenericMessages = false): PayloadConversationDraft => {
    const record = sessionInfo(value);
    const values = rawMessages(value, allowGenericMessages);
    if (!values) {
        throw new Error('OpenCode payload is missing session messages.');
    }
    const messages = values.map(parseMessage);
    assertUnique(
        messages.map((message) => message.messageId),
        'OpenCode payload contains duplicate message IDs.',
    );
    assertUnique(
        messages.flatMap((message) => message.parts.map((part) => part.partId)),
        'OpenCode payload contains duplicate part IDs.',
    );
    const sessionId = stringValue(record.sessionId ?? record.id)?.trim() || null;
    const title = stringValue(record.title ?? record.name)?.trim() || null;
    const model = conversationModel(record, values);
    const normalizedMessages = openCodePartsToMessages(messages.flatMap((message) => message.parts)).map(
        (message): ConversationMessage => ({
            ...message,
            createdAtMs: Number.isFinite(message.createdAtMs) ? message.createdAtMs : null,
        }),
    );
    const { createdAtMs, updatedAtMs } = conversationTimes(record, messages);
    const cost = finiteNumber(record.cost) ?? 0;
    const totalTokens = conversationTotalTokens(record);
    const workspacePath = conversationWorkspace(record);
    return {
        ...(sessionId ? { id: sessionId } : {}),
        ...(title ? { title } : {}),
        ...(model ? { model } : {}),
        createdAtMs,
        messages: normalizedMessages,
        metadata: {
            agent: stringValue(record.agent),
            cost,
            totalTokens,
        },
        source: 'opencode',
        updatedAtMs,
        ...(workspacePath ? { workspacePath } : {}),
    };
};

const isConversationRecord = (value: unknown): boolean => {
    if (!isRecord(value)) {
        return false;
    }
    if (!Array.isArray(value.messages)) {
        return false;
    }
    return hasOpenCodeEnvelope(value)
        ? true
        : value.messages.length > 0 && value.messages.every(hasOpenCodeMessageParts);
};

const isEventRecord = (value: unknown): boolean => {
    if (!isRecord(value)) {
        return false;
    }
    return ['session', 'message', 'part'].includes(stringValue(value.type) ?? '') || 'event' in value;
};

const eventValue = (record: Record<string, unknown>): Record<string, unknown> => {
    for (const key of ['session', 'message', 'part', 'data', 'value']) {
        const value = record[key];
        if (isRecord(value)) {
            return value;
        }
    }
    return record;
};

const eventSession = (records: Record<string, unknown>[]): Record<string, unknown> =>
    records.map((record) => (stringValue(record.type) === 'session' ? eventValue(record) : null)).find(isRecord) ?? {};

const addEventRecord = (
    record: Record<string, unknown>,
    messages: Map<string, Record<string, unknown>>,
    partIndex: number,
): number => {
    const type = stringValue(record.type ?? record.event);
    const payload = eventValue(record);
    if (type === 'message') {
        const messageId = stringValue(payload.id ?? payload.messageId) ?? `message-${messages.size}`;
        messages.set(messageId, {
            ...payload,
            id: messageId,
            parts: Array.isArray(payload.parts) ? payload.parts : [],
        });
        return partIndex;
    }
    if (type !== 'part') {
        return partIndex;
    }
    const messageId = stringValue(payload.messageId ?? payload.message_id ?? record.messageId) ?? 'message-0';
    const message = messages.get(messageId) ?? { id: messageId, parts: [], role: 'assistant' };
    const parts = Array.isArray(message.parts) ? message.parts : [];
    parts.push({ ...payload, id: stringValue(payload.id) ?? `part-${partIndex}` });
    messages.set(messageId, { ...message, parts });
    return partIndex + 1;
};

const parseEvents = (records: Record<string, unknown>[]): PayloadConversationDraft => {
    const session = eventSession(records);
    const messages = new Map<string, Record<string, unknown>>();
    let partIndex = 0;
    for (const record of records) {
        partIndex = addEventRecord(record, messages, partIndex);
    }
    return parseConversation({ ...session, messages: [...messages.values()] });
};

const duplicateIds = (drafts: PayloadConversationDraft[]): void => {
    const ids = drafts.map((draft) => draft.id).filter((id): id is string => Boolean(id));
    if (new Set(ids).size !== ids.length) {
        throw new Error('OpenCode payload contains duplicate conversation IDs.');
    }
};

const parseOpenCodeArray = (
    records: Record<string, unknown>[],
    explicitHint: boolean,
): PayloadConversationDraft[] | null => {
    if (records.every(isEventRecord)) {
        return [parseEvents(records)];
    }
    if (records.every(isConversationRecord)) {
        const drafts = records.map((record) => parseConversation(record));
        duplicateIds(drafts);
        return drafts;
    }
    if (records.every((record) => isConversationRecord(record) || hasOpenCodeMessageParts(record))) {
        return [parseConversation({ messages: records }, explicitHint)];
    }
    return explicitHint ? [parseConversation({ messages: records }, true)] : null;
};

const parseOpenCodeObject = (
    value: Record<string, unknown>,
    explicitHint: boolean,
): PayloadConversationDraft[] | null => {
    if (rawMessages(value) !== null) {
        return [parseConversation(value)];
    }
    if (isEventRecord(value)) {
        return [parseEvents([value])];
    }
    return explicitHint ? [parseConversation(value, true)] : null;
};

export const parseOpenCodePayload = (
    value: unknown,
    sourceHint?: ConversationPayloadSource,
): PayloadConversationDraft[] | null => {
    if (sourceHint !== undefined && sourceHint !== 'opencode') {
        return null;
    }
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
        throw new Error('OpenCode payload must be decoded JSON, not binary data.');
    }
    const explicitHint = sourceHint === 'opencode';
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return null;
        }
        const records = value.filter(isRecord);
        if (records.length !== value.length) {
            throw new Error('OpenCode payload contains an incompatible record.');
        }
        return parseOpenCodeArray(records, explicitHint);
    }
    if (!isRecord(value)) {
        return null;
    }
    return parseOpenCodeObject(value, explicitHint);
};
