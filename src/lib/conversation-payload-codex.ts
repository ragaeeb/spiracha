import type { MessageEvent, ThreadEvent } from './codex-browser-types';
import { mapCodexCloudTurnEvents, normalizeCodexCloudTurn } from './codex-cloud-transcript';
import { parseCodexTranscriptRecords } from './codex-transcript-records';
import { normalizeCodexEvents } from './conversation-data/codex-messages';
import type { ConversationPayloadSource, PayloadConversationDraft } from './conversation-payload-types';
import type { JsonValue } from './shared-text';

const CODEX_RECORD_TYPES = new Set([
    'event_msg',
    'response_item',
    'session_meta',
    'thread_settings_applied',
    'turn_context',
]);

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

const toTimestampMs = (value: unknown): number | null => {
    const number = asNumber(value);
    if (number !== null) {
        return number;
    }
    const text = asString(value);
    if (!text) {
        return null;
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
};

const isCodexRecord = (value: unknown): value is Record<string, JsonValue> => {
    return (
        isRecord(value) && isJsonValue(value) && typeof value.type === 'string' && CODEX_RECORD_TYPES.has(value.type)
    );
};

const assertCodexRecord = (value: unknown): Record<string, JsonValue> => {
    if (!isJsonValue(value) || !isRecord(value)) {
        throw new Error('Codex payload has an invalid transcript record; expected a JSON object.');
    }
    const type = asString(value.type);
    if (!type || !CODEX_RECORD_TYPES.has(type)) {
        throw new Error(`Codex payload has an unsupported transcript record type: ${type ?? 'unknown'}.`);
    }
    if (type !== 'turn_context' && type !== 'thread_settings_applied' && !isRecord(value.payload)) {
        throw new Error(`Codex payload has an invalid ${type} record; payload must be an object.`);
    }
    if (
        (type === 'turn_context' || type === 'thread_settings_applied') &&
        value.payload !== undefined &&
        !isRecord(value.payload)
    ) {
        throw new Error(`Codex payload has an invalid ${type} record; payload must be an object.`);
    }
    return value;
};

const isThreadEvent = (value: unknown): value is ThreadEvent => {
    if (!isRecord(value) || typeof value.kind !== 'string' || typeof value.sequence !== 'number') {
        return false;
    }
    if (!isJsonValue(value)) {
        return false;
    }
    if (value.kind === 'message') {
        return typeof value.role === 'string' && typeof value.text === 'string';
    }
    if (value.kind === 'reasoning') {
        return Array.isArray(value.summary) && value.summary.every((entry) => typeof entry === 'string');
    }
    if (value.kind === 'tool_call') {
        return typeof value.name === 'string';
    }
    return ['task_complete', 'task_started', 'token_count', 'tool_output', 'web_search'].includes(value.kind);
};

const visibleMessages = (events: ThreadEvent[]): MessageEvent[] =>
    events.filter(
        (event): event is MessageEvent =>
            event.kind === 'message' && !event.isHiddenByDefault && Boolean(event.text.trim()),
    );

const draftFromEvents = ({
    events,
    id,
    metadata = {},
    model,
    title,
    createdAtMs,
    updatedAtMs,
    workspacePath,
}: {
    events: ThreadEvent[];
    id?: string | null;
    metadata?: Record<string, unknown>;
    model?: string | null;
    title?: string | null;
    createdAtMs?: number | null;
    updatedAtMs?: number | null;
    workspacePath?: string | null;
}): PayloadConversationDraft => {
    const messages = visibleMessages(events);
    const firstVisibleText = messages.find((event) => event.role === 'user')?.text ?? messages[0]?.text ?? null;
    const messageTimestamps = events
        .map((event) => toTimestampMs(event.timestamp))
        .filter((timestamp): timestamp is number => timestamp !== null);
    const resolvedCreatedAtMs = createdAtMs ?? messageTimestamps[0] ?? null;
    const resolvedUpdatedAtMs = updatedAtMs ?? messageTimestamps.at(-1) ?? resolvedCreatedAtMs;
    return {
        createdAtMs: resolvedCreatedAtMs,
        ...(id === undefined ? {} : { id }),
        metadata,
        ...(model ? { model } : {}),
        messages: normalizeCodexEvents(events),
        source: 'codex',
        title: title ?? firstVisibleText,
        updatedAtMs: resolvedUpdatedAtMs,
        workspacePath: workspacePath ?? null,
    };
};

const parseNativeRecords = (records: readonly unknown[]): PayloadConversationDraft[] | null => {
    if (records.length === 0 || !records.some(isCodexRecord)) {
        return null;
    }
    const parsedRecords = validateNativeRecords(records);
    return groupNativeRecords(parsedRecords).map(parseNativeGroup);
};

const validateNativeRecords = (records: readonly unknown[]): Record<string, JsonValue>[] => {
    // Codex JSONL contains auxiliary record types that the transcript parser
    // intentionally ignores. Validate recognized records while preserving that
    // tolerance for newer or unrelated auxiliary records.
    return records.flatMap((record) => {
        if (!isJsonValue(record) || !isRecord(record)) {
            throw new Error('Codex payload has an invalid transcript record; expected a JSON object.');
        }
        return isCodexRecord(record) ? [assertCodexRecord(record)] : [];
    });
};

const groupNativeRecords = (records: readonly Record<string, JsonValue>[]): Record<string, JsonValue>[][] => {
    const groups: Record<string, JsonValue>[][] = [];
    let currentGroup: Record<string, JsonValue>[] = [];
    for (const record of records) {
        if (
            currentGroup.length === 0 ||
            (record.type === 'session_meta' && currentGroup.some((entry) => entry.type !== 'session_meta'))
        ) {
            currentGroup = [];
            groups.push(currentGroup);
        }
        currentGroup.push(record);
    }
    return groups;
};

const parseNativeGroup = (group: Record<string, JsonValue>[]): PayloadConversationDraft => {
    const transcript = parseCodexTranscriptRecords(group, { includeRaw: false });
    if (transcript.events.length === 0) {
        throw new Error('Codex payload contains no renderable transcript events.');
    }
    const sessionMeta = transcript.sessionMeta;
    const assistantModel = transcript.stats.modelNames.at(-1) ?? null;
    const messages = visibleMessages(transcript.events);
    return draftFromEvents({
        createdAtMs: toTimestampMs(sessionMeta.timestamp),
        events: transcript.events,
        id: sessionMeta.id ?? null,
        metadata: {
            ...(sessionMeta.cli_version ? { cliVersion: sessionMeta.cli_version } : {}),
            ...(sessionMeta.modelProvider ? { modelProvider: sessionMeta.modelProvider } : {}),
            ...(sessionMeta.originator ? { originator: sessionMeta.originator } : {}),
            ...(sessionMeta.source ? { source: sessionMeta.source } : {}),
            ...(sessionMeta.threadSource ? { threadSource: sessionMeta.threadSource } : {}),
            modelNames: transcript.stats.modelNames,
        },
        model: assistantModel,
        title: messages.find((event) => event.role === 'user')?.text ?? null,
        workspacePath: sessionMeta.cwd ?? null,
    });
};

const parseCloudTurn = (
    root: Record<string, unknown>,
    rawTurn: Record<string, unknown>,
    userTurn: Record<string, unknown> | null,
): PayloadConversationDraft => {
    const turn = normalizeCodexCloudTurn(rawTurn, userTurn);
    const events = mapCodexCloudTurnEvents(turn);
    if (events.length === 0) {
        throw new Error('Codex Cloud payload contains no transcript events.');
    }
    const task = isRecord(root.task) ? root.task : {};
    const taskId = firstString(task.id, task.task_id, root.taskId, root.id, turn.id);
    const taskTitle = firstString(task.title, task.name, root.title);
    const taskCreated = toTimestampMs(task.created_at ?? task.createdAt);
    const taskUpdated = toTimestampMs(task.updated_at ?? task.updatedAt);
    const workspacePath = firstString(task.cwd, task.workspace_path, task.workspacePath, root.cwd, root.workspacePath);
    return draftFromEvents({
        createdAtMs: taskCreated ?? toTimestampMs(turn.createdAt),
        events,
        id: taskId,
        metadata: {
            cloud: true,
            ...(turn.environmentId ? { environmentId: turn.environmentId } : {}),
            ...(turn.environmentLabel ? { environmentLabel: turn.environmentLabel } : {}),
            ...(turn.status ? { status: turn.status } : {}),
            ...(turn.branch ? { branch: turn.branch } : {}),
        },
        model: turn.model,
        title: taskTitle,
        updatedAtMs: taskUpdated,
        workspacePath: workspacePath ?? null,
    });
};

const getCloudUserTurn = (root: Record<string, unknown>): Record<string, unknown> | null => {
    for (const key of ['current_user_turn', 'currentUserTurn']) {
        if (isRecord(root[key])) {
            return root[key];
        }
    }
    return null;
};

const getCloudRawTurn = (root: Record<string, unknown>): Record<string, unknown> | null => {
    for (const key of [
        'current_assistant_turn',
        'currentAssistantTurn',
        'current_diff_task_turn',
        'currentDiffTaskTurn',
        'turn',
    ]) {
        if (isRecord(root[key])) {
            return root[key];
        }
    }
    return isRecord(root.thread_events) ? root : null;
};

const parseDirectCloudEvents = (root: Record<string, unknown>): PayloadConversationDraft | null => {
    const directEvents = root.events;
    if (!Array.isArray(directEvents) || !directEvents.every(isThreadEvent)) {
        return null;
    }
    const task = isRecord(root.task) ? root.task : {};
    return draftFromEvents({
        createdAtMs: toTimestampMs(task.created_at ?? task.createdAt ?? root.createdAt),
        events: directEvents,
        id: firstString(task.id, root.taskId, root.id),
        metadata: { cloud: true },
        model: firstString(root.model, task.model),
        title: firstString(task.title, root.title),
        updatedAtMs: toTimestampMs(task.updated_at ?? task.updatedAt ?? root.updatedAt),
        workspacePath: firstString(task.cwd, root.cwd, root.workspacePath),
    });
};

const parseCloudObject = (root: Record<string, unknown>): PayloadConversationDraft | null => {
    const userTurn = getCloudUserTurn(root);
    const rawTurn = getCloudRawTurn(root);
    if (rawTurn && isRecord(rawTurn.thread_events)) {
        return parseCloudTurn(root, rawTurn, userTurn);
    }
    return parseDirectCloudEvents(root);
};

const looksLikeCloudObject = (root: Record<string, unknown>): boolean => {
    const markers = [
        'current_assistant_turn',
        'currentAssistantTurn',
        'current_diff_task_turn',
        'currentDiffTaskTurn',
        'thread_events',
        'tasks',
    ];
    return markers.some((key) => key in root) || ('events' in root && ['task', 'turn'].some((key) => key in root));
};

const parseCodexArray = (value: unknown[], explicitHint: boolean): PayloadConversationDraft[] | null => {
    if (value.length > 0 && value.every(isThreadEvent)) {
        return [draftFromEvents({ events: value })];
    }
    const native = parseNativeRecords(value);
    if (native) {
        return native;
    }
    const cloudTurns = value.filter(isRecord).filter((entry) => isRecord(entry.thread_events));
    if (cloudTurns.length === value.length && cloudTurns.length > 0) {
        return cloudTurns.map((turn) => parseCloudTurn(turn, turn, null));
    }
    if (explicitHint) {
        throw new Error('Codex payload is empty or has an unrecognized transcript shape.');
    }
    return null;
};

const parseCodexObject = (value: Record<string, unknown>, explicitHint: boolean): PayloadConversationDraft[] | null => {
    if (isCodexRecord(value)) {
        return parseNativeRecords([value]);
    }
    if (looksLikeCloudObject(value)) {
        if (Array.isArray(value.tasks)) {
            throw new Error('Codex Cloud payload is a task list without transcript events.');
        }
        const cloud = parseCloudObject(value);
        if (cloud) {
            return [cloud];
        }
        throw new Error('Codex Cloud payload has invalid or incomplete transcript data.');
    }
    if (explicitHint) {
        throw new Error('Codex payload is missing transcript records.');
    }
    return null;
};

export const parseCodexPayload = (
    value: unknown,
    sourceHint?: ConversationPayloadSource,
): PayloadConversationDraft[] | null => {
    if (sourceHint && sourceHint !== 'codex') {
        return null;
    }

    if (Array.isArray(value)) {
        return parseCodexArray(value, sourceHint === 'codex');
    }

    if (!isRecord(value)) {
        if (sourceHint === 'codex') {
            throw new Error('Codex payload must be a JSON object or transcript array.');
        }
        return null;
    }
    return parseCodexObject(value, sourceHint === 'codex');
};
