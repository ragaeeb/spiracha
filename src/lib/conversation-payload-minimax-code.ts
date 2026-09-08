import { normalizeMiniMaxCodeTranscript } from './conversation-data/minimax-code-messages';
import type { ConversationPayloadSource, PayloadConversationDraft } from './conversation-payload-types';
import {
    createMiniMaxCodeSessionTranscript,
    parseMiniMaxCodeMessageRows,
    parseMiniMaxCodeSnapshotPayload,
} from './minimax-code-transcript-parser';
import type { JsonValue } from './shared-text';

const isJsonValue = (value: unknown): value is JsonValue => {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return true;
    }
    if (Array.isArray(value)) {
        return value.every(isJsonValue);
    }
    if (typeof value !== 'object') {
        return false;
    }
    return Object.values(value).every(isJsonValue);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

const asNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

const firstString = (...values: unknown[]): string | null => {
    for (const value of values) {
        const text = asString(value);
        if (text) {
            return text;
        }
    }
    return null;
};

const firstNumber = (...values: unknown[]): number | null => {
    for (const value of values) {
        const number = asNumber(value);
        if (number !== null) {
            return number;
        }
    }
    return null;
};

const toJsonRecord = (value: unknown): Record<string, JsonValue> | null =>
    isJsonValue(value) && isRecord(value) ? (value as Record<string, JsonValue>) : null;

const toDraft = (
    transcript: NonNullable<ReturnType<typeof parseMiniMaxCodeSnapshotPayload>>,
    overrides: {
        id?: string | null;
        title?: string | null;
        workspacePath?: string | null;
    } = {},
): PayloadConversationDraft => {
    const { session } = transcript;
    return {
        createdAtMs: session.createdAtMs,
        ...(overrides.id === undefined ? { id: session.sessionId } : overrides.id === null ? {} : { id: overrides.id }),
        messages: normalizeMiniMaxCodeTranscript(transcript),
        metadata: {
            agentName: session.agentName,
            appMode: session.appMode,
            currentModelVariant: session.currentModelVariant,
            runtime: session.runtime,
            sessionType: session.sessionType,
            status: session.status,
        },
        model: session.currentModelId,
        source: 'minimax-code',
        title: overrides.title === undefined ? session.title : overrides.title,
        updatedAtMs: session.lastActiveAtMs,
        workspacePath: overrides.workspacePath === undefined ? session.worktree || null : overrides.workspacePath,
    };
};

const parseSnapshot = (value: unknown): PayloadConversationDraft => {
    const jsonValue = isJsonValue(value) ? value : null;
    const root = isRecord(jsonValue) ? jsonValue : null;
    if (root && Array.isArray(root.displayMessages) && !root.displayMessages.every(isRecord)) {
        throw new Error('MiniMax Code payload has an invalid displayMessages row; each row must be an object.');
    }
    const transcript = jsonValue === null ? null : parseMiniMaxCodeSnapshotPayload(jsonValue);
    if (!transcript) {
        throw new Error('MiniMax Code payload has an invalid snapshot shape or missing session metadata.');
    }
    if (transcript.messages.length === 0) {
        throw new Error('MiniMax Code payload contains no renderable transcript messages.');
    }
    return toDraft(transcript);
};

const getMessageEnvelopeRows = (root: Record<string, unknown>): Record<string, JsonValue>[] => {
    if (!Array.isArray(root.messages)) {
        throw new Error('MiniMax Code payload has an invalid messages log; messages must be an array.');
    }
    if (!root.messages.every(isJsonValue)) {
        throw new Error('MiniMax Code payload has an invalid messages log; every row must be JSON.');
    }
    const rows = root.messages as Record<string, JsonValue>[];
    if (!rows.every((row) => isRecord(row) && isRecord(row.message))) {
        throw new Error('MiniMax Code payload has an invalid messages log row; expected a nested message object.');
    }
    return rows;
};

const getMessageEnvelopeRecord = (root: Record<string, unknown>): Record<string, unknown> => {
    for (const key of ['record', 'session', 'sessionMetadata']) {
        if (isRecord(root[key])) {
            return root[key];
        }
    }
    return {};
};

const getMessageEnvelopeTimestamps = (
    nestedRecord: Record<string, unknown>,
    root: Record<string, unknown>,
    messageRecords: ReturnType<typeof parseMiniMaxCodeMessageRows>,
): { createdAtMs: number | null; updatedAtMs: number | null } => {
    const lastMessageTimestamp = messageRecords.reduce<number | null>((latest, message) => {
        if (message.createdAtMs === null) {
            return latest;
        }
        if (latest === null) {
            return message.createdAtMs;
        }
        return Math.max(latest, message.createdAtMs);
    }, null);
    return {
        createdAtMs:
            firstNumber(nestedRecord.createdAtMs, nestedRecord.created_at_ms, root.createdAtMs) ??
            messageRecords[0]?.createdAtMs ??
            null,
        updatedAtMs:
            firstNumber(nestedRecord.updatedAtMs, nestedRecord.updated_at_ms, root.updatedAtMs) ??
            lastMessageTimestamp ??
            null,
    };
};

const parseMessageEnvelope = (root: Record<string, unknown>): PayloadConversationDraft => {
    const rows = getMessageEnvelopeRows(root);
    const nestedRecord = getMessageEnvelopeRecord(root);
    const sessionId = firstString(nestedRecord.sessionId, nestedRecord.session_id, root.sessionId, root.session_id);
    const workspaceDir = firstString(
        nestedRecord.workspaceDir,
        nestedRecord.workspace_dir,
        nestedRecord.projectWorkspaceDir,
        root.workspaceDir,
        root.workspace_dir,
    );
    const metadata = toJsonRecord(nestedRecord) ?? {};
    const messageRecords = parseMiniMaxCodeMessageRows(rows);
    const timestamps = getMessageEnvelopeTimestamps(nestedRecord, root, messageRecords);
    const model = firstString(nestedRecord.effectiveModel, nestedRecord.currentModelId, nestedRecord.model, root.model);
    const title = firstString(
        nestedRecord.title,
        root.title,
        messageRecords.find((message) => message.role === 'user')?.content,
        messageRecords[0]?.content,
    );
    const record: Record<string, JsonValue> = {
        ...metadata,
        ...(model ? { effectiveModel: model } : {}),
        ...(firstString(nestedRecord.effectiveModelVariant, nestedRecord.currentModelVariant, root.modelVariant)
            ? {
                  effectiveModelVariant: firstString(
                      nestedRecord.effectiveModelVariant,
                      nestedRecord.currentModelVariant,
                      root.modelVariant,
                  ),
              }
            : {}),
        ...(timestamps.createdAtMs !== null
            ? {
                  createdAtMs: timestamps.createdAtMs,
              }
            : {}),
        sessionId: sessionId ?? 'payload',
        ...(title ? { title } : {}),
        ...(timestamps.updatedAtMs !== null
            ? {
                  updatedAtMs: timestamps.updatedAtMs,
              }
            : {}),
        ...(workspaceDir ? { workspaceDir } : {}),
    };
    const transcript = createMiniMaxCodeSessionTranscript({
        allowMissingWorktree: true,
        messages: messageRecords,
        piHistory: isJsonValue(root.piHistory) ? root.piHistory : undefined,
        record,
        sessionId: sessionId ?? 'payload',
        snapshotPath: '<payload>/messages.jsonl',
    });
    if (!transcript) {
        throw new Error('MiniMax Code payload has invalid session metadata; workspaceDir is required.');
    }
    if (transcript.messages.length === 0) {
        throw new Error('MiniMax Code payload contains no renderable transcript messages.');
    }

    return toDraft(transcript, {
        id: sessionId,
        title: title ?? null,
        workspacePath: workspaceDir,
    });
};

const looksLikeNativeMessageRow = (value: unknown): value is Record<string, unknown> =>
    isRecord(value) &&
    typeof value.message_id === 'string' &&
    isRecord(value.message) &&
    ['assistant', 'toolResult', 'user'].includes(typeof value.message.role === 'string' ? value.message.role : '');

const parseMiniMaxCodeArray = (value: unknown[], explicitHint: boolean): PayloadConversationDraft[] | null => {
    if (value.length > 0 && value.some(looksLikeNativeMessageRow)) {
        return [parseMessageEnvelope({ messages: value })];
    }
    if (explicitHint) {
        throw new Error('MiniMax Code payload is an empty or unrecognized messages log.');
    }
    return null;
};

const parseMiniMaxCodeObject = (
    value: Record<string, unknown>,
    explicitHint: boolean,
): PayloadConversationDraft[] | null => {
    if ('displayMessages' in value || ('record' in value && !('messages' in value))) {
        return [parseSnapshot(value)];
    }
    const messages = value.messages;
    const isNativeEnvelope = Array.isArray(messages) && messages.some(looksLikeNativeMessageRow);
    if ('messages' in value && (explicitHint || isNativeEnvelope)) {
        return [parseMessageEnvelope(value)];
    }
    if (explicitHint) {
        throw new Error('MiniMax Code payload is missing snapshot or messages data.');
    }
    return null;
};

export const parseMiniMaxCodePayload = (
    value: unknown,
    sourceHint?: ConversationPayloadSource,
): PayloadConversationDraft[] | null => {
    if (sourceHint && sourceHint !== 'minimax-code') {
        return null;
    }

    if (Array.isArray(value)) {
        return parseMiniMaxCodeArray(value, sourceHint === 'minimax-code');
    }

    if (!isRecord(value)) {
        if (sourceHint === 'minimax-code') {
            throw new Error('MiniMax Code payload must be a JSON object or messages array.');
        }
        return null;
    }
    return parseMiniMaxCodeObject(value, sourceHint === 'minimax-code');
};
