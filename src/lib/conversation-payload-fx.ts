import { normalizeFxTranscript } from './conversation-data/fx-messages';
import type { ConversationPayloadSource, PayloadConversationDraft } from './conversation-payload-types';
import {
    createFxSessionTranscript,
    parseFxPayloadMessages,
    parseFxPayloadTurnSources,
    parseFxSessionRecordPayload,
} from './fx-transcript-parser';
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

const toJsonRecord = (value: unknown): Record<string, JsonValue> | null =>
    isJsonValue(value) && isRecord(value) ? (value as Record<string, JsonValue>) : null;

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

const eventRecords = (value: unknown): Record<string, JsonValue>[] | null => {
    if (!Array.isArray(value) || !value.every(isJsonValue)) {
        return null;
    }
    return value.every(isRecord) ? (value as Record<string, JsonValue>[]) : null;
};

const FX_EVENT_KINDS = new Set(['history_turn_committed', 'recovery_checkpoint_set', 'usage_checkpointed']);

const isFxEventRecord = (value: unknown): value is Record<string, JsonValue> =>
    isRecord(value) && isJsonValue(value) && FX_EVENT_KINDS.has(asString(value.kind) ?? '');

const isCompleteFxTurnEvent = (event: Record<string, JsonValue>): boolean => {
    if (event.kind !== 'history_turn_committed') {
        return false;
    }
    const payload = isRecord(event.payload) ? event.payload : null;
    const turn = payload && isRecord(payload.turn) ? payload.turn : null;
    return Boolean(turn && ('assistant' in turn || 'execution' in turn || 'user' in turn));
};

const isSelfContainedFxEventData = (events: readonly Record<string, JsonValue>[]): boolean => {
    const turnEvents = events.filter((event) => event.kind === 'history_turn_committed');
    return turnEvents.length > 0 && turnEvents.every(isCompleteFxTurnEvent);
};

const isFxCheckpoint = (value: unknown): value is Record<string, JsonValue> => {
    if (!isRecord(value) || !isJsonValue(value) || typeof value.schema_version !== 'number') {
        return false;
    }
    const state = value.state;
    return isRecord(state) && typeof value.through_seq === 'number';
};

const toToolResults = (value: unknown): Record<string, JsonValue> => {
    if (isRecord(value) && isJsonValue(value)) {
        return value as Record<string, JsonValue>;
    }
    if (!Array.isArray(value) || !value.every(isJsonValue)) {
        throw new Error('FX payload has invalid tool results; expected a mapping or array.');
    }

    const results: Record<string, JsonValue> = {};
    for (const item of value) {
        if (!isRecord(item)) {
            throw new Error('FX payload has invalid tool results; every entry must be an object.');
        }
        const handle = firstString(item.handle, item.name, item.output_handle);
        const output = item.output ?? item.text ?? item.content;
        if (!handle || !isJsonValue(output)) {
            throw new Error('FX payload has invalid tool results; each entry needs a handle and JSON output.');
        }
        results[handle] = output;
    }
    return results;
};

const toDraft = (
    transcript: ReturnType<typeof createFxSessionTranscript>,
    root: Record<string, unknown>,
    sessionId: string | null,
): PayloadConversationDraft => {
    const { session } = transcript;
    return {
        createdAtMs: session.createdAtMs,
        ...(sessionId ? { id: sessionId } : {}),
        messages: normalizeFxTranscript(transcript),
        metadata: {
            conversationLanguage: session.conversationLanguage,
            currentModelVariant: session.currentModelVariant,
            status: session.status,
            totalInputTokens: session.totalInputTokens,
            totalOutputTokens: session.totalOutputTokens,
        },
        model: session.currentModelId,
        source: 'fx',
        title: firstString(root.title, session.title),
        updatedAtMs: session.lastActiveAtMs,
        workspacePath: session.worktree || null,
    };
};

type FxPayloadBundle = {
    checkpoint: Record<string, JsonValue> | null;
    display: Record<string, JsonValue>;
    events: Record<string, JsonValue>[];
    indexRecord: Record<string, JsonValue>;
    session: Record<string, JsonValue>;
    state: Record<string, JsonValue>;
};

type FxPayloadBundleValues = {
    checkpoint: Record<string, JsonValue> | null;
    display: Record<string, JsonValue> | null;
    events: Record<string, JsonValue>[] | null;
    indexRecord: Record<string, JsonValue> | null;
    rawCheckpoint: unknown;
    rawDisplay: unknown;
    rawEvents: unknown;
    rawIndex: unknown;
    rawSession: unknown;
    session: Record<string, JsonValue> | null;
};

const readFxPayloadBundleValues = (root: Record<string, unknown>): FxPayloadBundleValues => {
    const rawSession = root.session ?? root['session.json'];
    const rawDisplay = root.display ?? root['display.json'];
    const rawIndex = root.index ?? root['index.json'];
    const rawCheckpoint = root.checkpoint ?? root['checkpoint.json'];
    const rawEvents = root.events ?? root.eventLog ?? root.events_jsonl ?? root['events.jsonl'];
    const session = toJsonRecord(rawSession);
    const display = toJsonRecord(rawDisplay);
    const indexRecord = toJsonRecord(rawIndex);
    const checkpoint = toJsonRecord(rawCheckpoint);
    const events = rawEvents === undefined ? [] : eventRecords(rawEvents);
    return {
        checkpoint,
        display,
        events,
        indexRecord,
        rawCheckpoint,
        rawDisplay,
        rawEvents,
        rawIndex,
        rawSession,
        session,
    };
};

const validateFxPayloadPresence = (values: FxPayloadBundleValues): void => {
    if (!values.checkpoint && values.rawEvents === undefined) {
        throw new Error('FX payload is missing checkpoint and event data; session metadata alone is incomplete.');
    }
    if (
        values.rawEvents !== undefined &&
        values.rawSession === undefined &&
        values.events !== null &&
        !isSelfContainedFxEventData(values.events)
    ) {
        throw new Error('FX payload event data is missing session metadata; the export is not self-contained.');
    }
};

const validateFxPayloadRecords = (values: FxPayloadBundleValues): void => {
    if (values.rawSession !== undefined && !values.session) {
        throw new Error('FX payload has invalid session data; expected an object.');
    }
    if (values.rawDisplay !== undefined && !values.display) {
        throw new Error('FX payload has invalid display data; expected an object.');
    }
    if (values.rawIndex !== undefined && !values.indexRecord) {
        throw new Error('FX payload has invalid index data; expected an object.');
    }
    if (values.rawEvents !== undefined && !values.events) {
        throw new Error('FX payload has invalid event data; expected an array of event records.');
    }
    if (values.rawCheckpoint !== undefined && !values.checkpoint) {
        throw new Error('FX payload has invalid checkpoint data; expected an object.');
    }
};

const validateFxCheckpointHistory = (values: FxPayloadBundleValues): void => {
    if (!values.checkpoint) {
        return;
    }
    const checkpointState = isRecord(values.checkpoint.state) ? values.checkpoint.state : null;
    if (!checkpointState) {
        throw new Error('FX payload has invalid checkpoint state; expected an object.');
    }
    if (!Array.isArray(checkpointState.history)) {
        throw new Error('FX payload has invalid checkpoint history; expected an array of turns.');
    }
    if (!checkpointState.history.every(isRecord)) {
        throw new Error('FX payload has an invalid checkpoint history row; each turn must be an object.');
    }
};

const getFxPayloadBundle = (root: Record<string, unknown>): FxPayloadBundle => {
    const values = readFxPayloadBundleValues(root);
    validateFxPayloadPresence(values);
    validateFxPayloadRecords(values);
    validateFxCheckpointHistory(values);
    const resolvedCheckpoint = values.checkpoint ?? null;
    return {
        checkpoint: resolvedCheckpoint,
        display: values.display ?? {},
        events: values.events ?? [],
        indexRecord: values.indexRecord ?? {},
        session: values.session ?? {},
        state: isRecord(resolvedCheckpoint?.state) ? resolvedCheckpoint.state : {},
    };
};

const getFxPayloadSessionIdentity = (
    root: Record<string, unknown>,
    bundle: FxPayloadBundle,
): { sessionId: string | null; workspaceRoot: string | null } => ({
    sessionId: firstString(
        bundle.session.id,
        bundle.session.session_id,
        bundle.indexRecord.id,
        root.sessionId,
        root.session_id,
        bundle.state.id,
    ),
    workspaceRoot: firstString(
        bundle.session.workspace_root,
        bundle.session.workspaceRoot,
        bundle.indexRecord.workspace_root,
        bundle.indexRecord.workspaceRoot,
        bundle.state.workspace_root,
        bundle.state.workspaceRoot,
        root.workspacePath,
        root.workspace_path,
    ),
});

const createFxPayloadSessionRecord = (
    root: Record<string, unknown>,
    bundle: FxPayloadBundle,
    workspaceRoot: string | null,
    sessionId: string,
) => {
    const sessionRecord: Record<string, JsonValue> = {
        ...bundle.session,
        ...(firstNumber(bundle.session.created_at_ms, bundle.session.createdAtMs, root.createdAtMs) !== null
            ? {
                  created_at_ms: firstNumber(
                      bundle.session.created_at_ms,
                      bundle.session.createdAtMs,
                      root.createdAtMs,
                  ),
              }
            : {}),
        ...(firstNumber(bundle.session.updated_at_ms, bundle.session.updatedAtMs, root.updatedAtMs) !== null
            ? {
                  updated_at_ms: firstNumber(
                      bundle.session.updated_at_ms,
                      bundle.session.updatedAtMs,
                      root.updatedAtMs,
                  ),
              }
            : {}),
        ...(workspaceRoot ? { workspace_root: workspaceRoot } : {}),
    };
    const title = firstString(bundle.display.title, bundle.session.title, root.title);
    const displayRecord: Record<string, JsonValue> = title ? { ...bundle.display, title } : bundle.display;
    return parseFxSessionRecordPayload({
        allowMissingWorktree: true,
        checkpoint: bundle.checkpoint,
        display: displayRecord,
        indexRecord: bundle.indexRecord,
        session: sessionRecord,
        sessionId,
    });
};

const parseBundle = (root: Record<string, unknown>): PayloadConversationDraft => {
    const bundle = getFxPayloadBundle(root);
    const { sessionId, workspaceRoot } = getFxPayloadSessionIdentity(root, bundle);
    const record = createFxPayloadSessionRecord(root, bundle, workspaceRoot, sessionId ?? 'payload');
    if (!record) {
        throw new Error('FX payload has invalid session metadata.');
    }

    const toolResultsValue = root.toolResults ?? root.tool_results ?? root['tool-results'];
    const toolResults = toolResultsValue === undefined ? {} : toToolResults(toolResultsValue);
    const sources = parseFxPayloadTurnSources(bundle.checkpoint, bundle.events, {
        defaultThroughSeq: bundle.checkpoint ? 0 : -1,
    });
    const messages = parseFxPayloadMessages(sources, toolResults);
    if (messages.length === 0) {
        throw new Error('FX payload contains no renderable transcript messages.');
    }
    return toDraft(createFxSessionTranscript({ messages, record }), root, sessionId);
};

const parseFxEventArray = (value: unknown[], explicitHint: boolean): PayloadConversationDraft[] | null => {
    const events = eventRecords(value);
    const recognizedEvents = events?.filter(isFxEventRecord) ?? [];
    if (recognizedEvents.length === 0) {
        if (explicitHint) {
            throw new Error('FX payload must be a self-contained session bundle.');
        }
        return null;
    }
    if (!events || !isSelfContainedFxEventData(events)) {
        throw new Error('FX payload is an event log without complete transcript turns.');
    }
    return [parseBundle({ events })];
};

const hasFxBundleSignature = (value: Record<string, unknown>): boolean => {
    if ('checkpoint' in value || 'checkpoint.json' in value) {
        return true;
    }
    const rawEvents = value.events ?? value.eventLog ?? value.events_jsonl ?? value['events.jsonl'];
    const events = eventRecords(rawEvents);
    return Boolean(events?.some(isFxEventRecord));
};

export const parseFxPayload = (
    value: unknown,
    sourceHint?: ConversationPayloadSource,
): PayloadConversationDraft[] | null => {
    if (sourceHint && sourceHint !== 'fx') {
        return null;
    }

    if (Array.isArray(value)) {
        return parseFxEventArray(value, sourceHint === 'fx');
    }

    if (!isRecord(value)) {
        if (sourceHint === 'fx') {
            throw new Error('FX payload must be a JSON object or event array.');
        }
        return null;
    }

    if (isFxCheckpoint(value)) {
        return [parseBundle({ checkpoint: value })];
    }
    if (!hasFxBundleSignature(value)) {
        if (sourceHint === 'fx') {
            throw new Error('FX payload is missing checkpoint and event data; session metadata alone is incomplete.');
        }
        return null;
    }
    return [parseBundle(value)];
};
