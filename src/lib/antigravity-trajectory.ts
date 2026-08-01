import { constants, Database } from 'bun:sqlite';
import { pathToFileURL } from 'node:url';

type ProtoField = {
    bytes?: Uint8Array;
    fieldNumber: number;
    value?: number;
    wireType: number;
};

type TrajectoryStepRow = {
    idx: number;
    metadata: Uint8Array | null;
    status: number;
    step_payload: Uint8Array;
    step_type: number;
};

export type AntigravityTrajectoryToolCall = {
    args: unknown;
    id: string | null;
    name: string;
};

export type AntigravityTrajectoryEntry = {
    command?: string;
    content?: string;
    created_at?: string;
    exit_code?: number;
    source: 'MODEL' | 'USER_EXPLICIT';
    status: 'DONE' | 'UNKNOWN';
    step_index: number;
    thinking?: string;
    tool_call_id?: string;
    tool_calls?: AntigravityTrajectoryToolCall[];
    tool_name?: string;
    type: 'PLANNER_RESPONSE' | 'RUN_COMMAND' | 'USER_INPUT';
    workdir?: string;
};

const decoder = new TextDecoder();
const ANTIGRAVITY_READONLY_DB_FLAGS = constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI;
const ANTIGRAVITY_SQLITE_BUSY_TIMEOUT_MS = 50;

const advanceFixedWidth = (buffer: Uint8Array, index: number, width: number): number => {
    const next = index + width;
    if (next > buffer.length) {
        throw new Error('Truncated Antigravity trajectory protobuf field');
    }
    return next;
};

const readVarint = (buffer: Uint8Array, start: number, end: number): { next: number; value: number } => {
    let value = 0;
    let multiplier = 1;
    for (let index = start; index < end; index += 1) {
        const byte = buffer[index]!;
        value += (byte & 0x7f) * multiplier;
        if ((byte & 0x80) === 0) {
            return { next: index + 1, value };
        }
        multiplier *= 0x80;
    }
    throw new Error('Unterminated Antigravity trajectory protobuf varint');
};

const parseProtoFields = (buffer: Uint8Array): ProtoField[] => {
    const fields: ProtoField[] = [];
    let index = 0;
    while (index < buffer.length) {
        const key = readVarint(buffer, index, buffer.length);
        index = key.next;
        const fieldNumber = key.value >> 3;
        const wireType = key.value & 7;
        if (fieldNumber <= 0) {
            throw new Error(`Invalid Antigravity trajectory protobuf field: ${fieldNumber}`);
        }
        if (wireType === 0) {
            const fieldValue = readVarint(buffer, index, buffer.length);
            fields.push({ fieldNumber, value: fieldValue.value, wireType });
            index = fieldValue.next;
            continue;
        }
        if (wireType === 1) {
            fields.push({ fieldNumber, wireType });
            index = advanceFixedWidth(buffer, index, 8);
            continue;
        }
        if (wireType === 2) {
            const length = readVarint(buffer, index, buffer.length);
            index = length.next;
            const next = index + length.value;
            if (next > buffer.length) {
                throw new Error('Invalid Antigravity trajectory protobuf length');
            }
            fields.push({ bytes: buffer.slice(index, next), fieldNumber, wireType });
            index = next;
            continue;
        }
        if (wireType === 5) {
            fields.push({ fieldNumber, wireType });
            index = advanceFixedWidth(buffer, index, 4);
            continue;
        }
        throw new Error(`Unsupported Antigravity trajectory protobuf wire type: ${wireType}`);
    }
    return fields;
};

const getFields = (fields: ProtoField[], fieldNumber: number) =>
    fields.filter((field) => field.fieldNumber === fieldNumber);

const getField = (fields: ProtoField[], fieldNumber: number): ProtoField | null =>
    fields.find((field) => field.fieldNumber === fieldNumber) ?? null;

const getNestedFields = (field: ProtoField | null): ProtoField[] => (field?.bytes ? parseProtoFields(field.bytes) : []);

const getString = (fields: ProtoField[], fieldNumber: number): string | null => {
    const bytes = getField(fields, fieldNumber)?.bytes;
    return bytes ? decoder.decode(bytes) : null;
};

const getNumber = (fields: ProtoField[], fieldNumber: number): number | null =>
    getField(fields, fieldNumber)?.value ?? null;

const getTimestamp = (metadataFields: ProtoField[]): string | undefined => {
    const timestampFields = getNestedFields(getField(metadataFields, 1));
    const seconds = getNumber(timestampFields, 1);
    if (seconds === null) {
        return undefined;
    }
    const nanos = getNumber(timestampFields, 2) ?? 0;
    return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000)).toISOString();
};

const parseJson = (value: string | null): unknown => {
    if (!value) {
        return null;
    }
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return value;
    }
};

const parseToolCallFields = (fields: ProtoField[]): AntigravityTrajectoryToolCall | null => {
    const name = getString(fields, 2) ?? getString(fields, 9);
    if (!name) {
        return null;
    }
    return {
        args: parseJson(getString(fields, 3)),
        id: getString(fields, 1),
        name,
    };
};

const parseToolCalls = (plannerFields: ProtoField[]): AntigravityTrajectoryToolCall[] =>
    getFields(plannerFields, 7)
        .map((field) => parseToolCallFields(getNestedFields(field)))
        .filter((call): call is AntigravityTrajectoryToolCall => call !== null);

const getEntryBase = (row: TrajectoryStepRow) => {
    const metadataFields = row.metadata ? parseProtoFields(row.metadata) : [];
    return {
        created_at: getTimestamp(metadataFields),
        status: row.status === 3 ? ('DONE' as const) : ('UNKNOWN' as const),
        step_index: row.idx,
    };
};

const parseUserEntry = (row: TrajectoryStepRow, payloadFields: ProtoField[]): AntigravityTrajectoryEntry | null => {
    const userFields = getNestedFields(getField(payloadFields, 19));
    const content = getString(userFields, 2)?.trim();
    return content
        ? {
              ...getEntryBase(row),
              content,
              source: 'USER_EXPLICIT',
              type: 'USER_INPUT',
          }
        : null;
};

const parsePlannerEntry = (row: TrajectoryStepRow, payloadFields: ProtoField[]): AntigravityTrajectoryEntry | null => {
    const plannerFields = getNestedFields(getField(payloadFields, 20));
    const content = (getString(plannerFields, 1) ?? getString(plannerFields, 8))?.trim();
    const thinking = getString(plannerFields, 3)?.trim();
    const toolCalls = parseToolCalls(plannerFields);
    if (!content && !thinking && toolCalls.length === 0) {
        return null;
    }
    return {
        ...getEntryBase(row),
        ...(content ? { content } : {}),
        source: 'MODEL',
        ...(thinking ? { thinking } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        type: 'PLANNER_RESPONSE',
    };
};

const getObjectString = (value: unknown, key: string): string | undefined => {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const candidate = (value as Record<string, unknown>)[key];
    return typeof candidate === 'string' && candidate.trim() ? candidate : undefined;
};

const parseCommandResultEntry = (
    row: TrajectoryStepRow,
    payloadFields: ProtoField[],
): AntigravityTrajectoryEntry | null => {
    const metadataFields = row.metadata ? parseProtoFields(row.metadata) : [];
    const toolCall = parseToolCallFields(getNestedFields(getField(metadataFields, 4)));
    const resultFields = getNestedFields(getField(payloadFields, 28));
    const outputFields = getNestedFields(getField(resultFields, 21));
    const content = getString(outputFields, 1) ?? '';
    const command =
        getString(resultFields, 23) ?? getString(resultFields, 25) ?? getObjectString(toolCall?.args, 'CommandLine');
    const exitCode = getNumber(resultFields, 6);
    const workdir = getString(resultFields, 2);
    if (!toolCall && !command && !content) {
        return null;
    }
    return {
        ...getEntryBase(row),
        ...(command ? { command } : {}),
        content,
        ...(exitCode === null ? {} : { exit_code: exitCode }),
        source: 'MODEL',
        ...(toolCall?.id ? { tool_call_id: toolCall.id } : {}),
        ...(toolCall?.name ? { tool_name: toolCall.name } : {}),
        type: 'RUN_COMMAND',
        ...(workdir ? { workdir } : {}),
    };
};

const parseTrajectoryStep = (row: TrajectoryStepRow): AntigravityTrajectoryEntry | null => {
    const payloadFields = parseProtoFields(row.step_payload);
    if (row.step_type === 14) {
        return parseUserEntry(row, payloadFields);
    }
    if (row.step_type === 15) {
        return parsePlannerEntry(row, payloadFields);
    }
    if (row.step_type === 21) {
        return parseCommandResultEntry(row, payloadFields);
    }
    return null;
};

const getReadonlyDbUri = (dbPath: string, immutable: boolean): string => {
    const url = pathToFileURL(dbPath);
    url.searchParams.set('mode', 'ro');
    if (immutable) {
        url.searchParams.set('immutable', '1');
    }
    return url.href;
};

const withTrajectoryDb = async <T>(dbPath: string, action: (db: Database) => T): Promise<T> => {
    const hasWriteAheadLog = await Bun.file(`${dbPath}-wal`).exists();
    const db = new Database(getReadonlyDbUri(dbPath, !hasWriteAheadLog), ANTIGRAVITY_READONLY_DB_FLAGS);
    try {
        db.exec(`PRAGMA busy_timeout = ${ANTIGRAVITY_SQLITE_BUSY_TIMEOUT_MS}`);
        db.exec('PRAGMA query_only = ON');
        return action(db);
    } finally {
        db.close();
    }
};

export const readAntigravityTrajectoryStepIndexes = (dbPath: string): Promise<Set<number>> =>
    withTrajectoryDb(
        dbPath,
        (db) =>
            new Set(
                (db.query('SELECT idx FROM steps ORDER BY idx').all() as Array<{ idx: number }>).map((row) => row.idx),
            ),
    );

export const readAntigravityTrajectoryEntries = (dbPath: string): Promise<AntigravityTrajectoryEntry[]> =>
    withTrajectoryDb(dbPath, (db) => {
        const rows = db
            .query('SELECT idx, step_type, status, metadata, step_payload FROM steps ORDER BY idx')
            .all() as TrajectoryStepRow[];
        return rows
            .map((row) => parseTrajectoryStep(row))
            .filter((entry): entry is AntigravityTrajectoryEntry => entry !== null);
    });
