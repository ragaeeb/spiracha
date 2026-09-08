import { cursorBubblesToMessages } from './conversation-data/cursor-message-normalizer';
import type { ConversationPayloadSource, PayloadConversationDraft } from './conversation-payload-types';
import { parseCursorAgentTranscriptRecord } from './cursor-agent-transcript';
import type { CursorBubble } from './cursor-exporter-types';

type CursorPayloadBubble = CursorBubble;

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

const jsonText = (value: unknown): string | null => {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value === 'string') {
        return value;
    }
    try {
        return JSON.stringify(value);
    } catch {
        throw new Error('Cursor payload contains a non-serializable tool argument.');
    }
};

const cursorKind = (value: unknown): CursorPayloadBubble['kind'] => {
    if (value === 1 || value === 'user') {
        return 'user';
    }
    if (value === 2 || value === 'assistant') {
        return 'assistant';
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return 'unknown';
    }
    throw new Error('Cursor bubble type is missing or incompatible.');
};

const parseToolCall = (value: unknown): CursorPayloadBubble['toolCall'] => {
    if (value === undefined || value === null) {
        return null;
    }
    if (!isRecord(value)) {
        throw new Error('Cursor toolFormerData is incompatible.');
    }
    const name = stringValue(value.name)?.trim();
    if (!name) {
        throw new Error('Cursor toolFormerData is missing a tool name.');
    }
    return {
        argumentsText: jsonText(value.rawArgs ?? value.params ?? value.input),
        callId: stringValue(value.toolCallId ?? value.callId ?? value.id),
        name,
        resultText: jsonText(value.result ?? value.output),
        status: stringValue(value.status),
    };
};

const parseThinking = (value: unknown): string | null => {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value === 'string') {
        return value;
    }
    if (isRecord(value)) {
        return stringValue(value.text ?? value.content);
    }
    throw new Error('Cursor thinking payload is incompatible.');
};

const parseComposerBubble = (value: unknown, index: number): CursorPayloadBubble => {
    if (!isRecord(value)) {
        throw new Error(`Cursor bubble ${index} is incompatible.`);
    }
    const bubbleId = stringValue(value.bubbleId ?? value.id)?.trim();
    if (!bubbleId) {
        throw new Error(`Cursor bubble ${index} is missing bubbleId.`);
    }
    const text = value.text === undefined || value.text === null ? '' : stringValue(value.text);
    if (text === null) {
        throw new Error(`Cursor bubble ${index} text is incompatible.`);
    }
    return {
        bubbleId,
        createdAtMs: timeValue(value.createdAt ?? value.createdAtMs),
        kind: cursorKind(value.type ?? value.kind),
        text,
        thinking: parseThinking(value.thinking),
        toolCall: parseToolCall(value.toolFormerData ?? value.toolCall),
    };
};

const parseAgentRecord = (value: unknown, index: number): CursorPayloadBubble => {
    if (!isRecord(value)) {
        throw new Error(`Cursor agent transcript record ${index} is incompatible.`);
    }
    const message = isRecord(value.message) ? value.message : value;
    const content = message.content ?? value.content;
    const parts = typeof content === 'string' ? [{ text: content, type: 'text' }] : content;
    if (!Array.isArray(parts) || !parts.every(isRecord)) {
        throw new Error(`Cursor agent transcript record ${index} content is incompatible.`);
    }
    for (const part of parts) {
        if (part.type === 'text' && typeof part.text !== 'string') {
            throw new Error(`Cursor agent transcript record ${index} text is incompatible.`);
        }
        if (part.type === 'tool_use') {
            parseToolCall(part);
        }
    }
    const bubble = parseCursorAgentTranscriptRecord(value, `agent-transcript:${index}`);
    if (!bubble) {
        throw new Error(`Cursor agent transcript record ${index} has no message content.`);
    }
    return bubble;
};

const modelFrom = (record: Record<string, unknown>): string | null => {
    const direct = stringValue(record.model ?? record.modelName);
    if (direct?.trim()) {
        return direct;
    }
    const config = isRecord(record.modelConfig) ? record.modelConfig : null;
    const configModel = stringValue(config?.modelName ?? config?.model);
    if (configModel?.trim()) {
        return configModel;
    }
    const selected = Array.isArray(config?.selectedModels) ? config.selectedModels[0] : null;
    return isRecord(selected) ? stringValue(selected.modelId ?? selected.id) : null;
};

const workspaceFrom = (record: Record<string, unknown>): string | null => {
    const direct = stringValue(record.workspacePath ?? record.workspaceFolder ?? record.folder);
    if (direct) {
        return direct;
    }
    const workspace = record.workspaceIdentifier;
    if (!isRecord(workspace)) {
        return null;
    }
    const uri = isRecord(workspace.uri) ? workspace.uri : null;
    return stringValue(uri?.fsPath ?? uri?.path ?? workspace.path);
};

const isComposerRecord = (record: Record<string, unknown>): boolean =>
    'bubbles' in record || 'fullConversationHeadersOnly' in record || 'composerId' in record || 'composer' in record;

const duplicateIds = (drafts: PayloadConversationDraft[]): void => {
    const ids = drafts.map((draft) => draft.id).filter((id): id is string => Boolean(id));
    if (new Set(ids).size !== ids.length) {
        throw new Error('Cursor payload contains duplicate conversation IDs.');
    }
};

const parseComposerBubbles = (record: Record<string, unknown>): CursorBubble[] => {
    const rawBubbles = record.bubbles ?? record.messages;
    if (!Array.isArray(rawBubbles)) {
        if ('fullConversationHeadersOnly' in record) {
            throw new Error('Cursor composer payload is missing its bubble bodies.');
        }
        throw new Error('Cursor composer payload is missing bubbles.');
    }
    const bubbles = rawBubbles.map(parseComposerBubble);
    const ids = bubbles.map((bubble) => bubble.bubbleId);
    if (new Set(ids).size !== ids.length) {
        throw new Error('Cursor payload contains duplicate bubble IDs.');
    }
    if (bubbles.every((bubble) => !bubble.text.trim() && !bubble.thinking?.trim() && !bubble.toolCall)) {
        throw new Error('Cursor composer payload contains no message bodies.');
    }
    return bubbles;
};

const parseComposer = (value: Record<string, unknown>): PayloadConversationDraft => {
    const record = isRecord(value.composer) ? { ...value, ...value.composer } : value;
    const bubbles = parseComposerBubbles(record);
    const id = stringValue(record.composerId ?? record.id);
    const title = stringValue(record.name ?? record.title);
    const model = modelFrom(record);
    return {
        createdAtMs: timeValue(record.createdAt ?? record.createdAtMs),
        id: id?.trim() || null,
        messages: cursorBubblesToMessages(bubbles),
        metadata: {
            ...(stringValue(record.unifiedMode ?? record.mode)
                ? { mode: stringValue(record.unifiedMode ?? record.mode) }
                : {}),
        },
        model: model?.trim() || null,
        source: 'cursor',
        title: title?.trim() || null,
        updatedAtMs: timeValue(record.lastUpdatedAt ?? record.updatedAtMs),
        workspacePath: workspaceFrom(record),
    };
};

const parseAgentTranscript = (records: unknown[], explicitHint: boolean): PayloadConversationDraft | null => {
    if (!explicitHint) {
        return null;
    }
    const bubbles = records.map(parseAgentRecord);
    return {
        messages: cursorBubblesToMessages(bubbles),
        source: 'cursor',
    };
};

const parseCursorArray = (value: unknown[], explicitHint: boolean): PayloadConversationDraft[] | null => {
    if (!explicitHint && !value.some((record) => isRecord(record) && isComposerRecord(record))) {
        return null;
    }
    if (value.length === 0) {
        return null;
    }
    const records = value.filter(isRecord);
    if (records.length !== value.length) {
        throw new Error('Cursor payload contains an incompatible record.');
    }
    if (records.every(isComposerRecord)) {
        const drafts = records.map(parseComposer);
        duplicateIds(drafts);
        return drafts;
    }
    if (records.some(isComposerRecord)) {
        throw new Error('Cursor payload mixes composer and transcript records.');
    }
    const draft = parseAgentTranscript(records, explicitHint);
    return draft ? [draft] : null;
};

export const parseCursorPayload = (
    value: unknown,
    sourceHint?: ConversationPayloadSource,
): PayloadConversationDraft[] | null => {
    if (sourceHint !== undefined && sourceHint !== 'cursor') {
        return null;
    }
    const explicitHint = sourceHint === 'cursor';
    if (Array.isArray(value)) {
        return parseCursorArray(value, explicitHint);
    }
    if (!isRecord(value)) {
        return null;
    }
    if (isComposerRecord(value)) {
        return [parseComposer(value)];
    }
    if (explicitHint) {
        return [parseAgentTranscript([value], true)].filter(
            (draft): draft is PayloadConversationDraft => draft !== null,
        );
    }
    return null;
};
