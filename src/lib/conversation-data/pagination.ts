import { CONVERSATION_SOURCES, type ConversationDetail, type ConversationPage, type ConversationSource } from './types';

const CURSOR_VERSION = 1;
const CURSOR_MAX_ENCODED_CHARACTERS = 2_048;
const CURSOR_MAX_ID_CHARACTERS = 1_024;

export type ConversationCursorKey = {
    id: string;
    source: ConversationSource;
    updatedAtMs: number;
};

const invalidCursor = (): never => {
    throw new Error('Invalid conversation pagination cursor.');
};

const compareStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const toCursorKey = (conversation: ConversationDetail): ConversationCursorKey => ({
    id: conversation.id,
    source: conversation.source,
    updatedAtMs:
        conversation.updatedAtMs !== null && Number.isFinite(conversation.updatedAtMs)
            ? Math.max(0, Math.floor(conversation.updatedAtMs))
            : 0,
});

const compareCursorKeys = (left: ConversationCursorKey, right: ConversationCursorKey) =>
    right.updatedAtMs - left.updatedAtMs ||
    compareStrings(left.source, right.source) ||
    compareStrings(left.id, right.id);

const encodeConversationCursor = (conversation: ConversationDetail) => {
    const key = toCursorKey(conversation);
    return Buffer.from(JSON.stringify([CURSOR_VERSION, key.updatedAtMs, key.source, key.id]), 'utf8').toString(
        'base64url',
    );
};

export const decodeConversationCursor = (cursor: string | null | undefined): ConversationCursorKey | null => {
    if (!cursor) {
        return null;
    }
    if (cursor.length > CURSOR_MAX_ENCODED_CHARACTERS) {
        return invalidCursor();
    }
    try {
        const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (
            !Array.isArray(parsed) ||
            parsed.length !== 4 ||
            parsed[0] !== CURSOR_VERSION ||
            !Number.isSafeInteger(parsed[1]) ||
            (parsed[1] as number) < 0 ||
            typeof parsed[2] !== 'string' ||
            !(CONVERSATION_SOURCES as readonly string[]).includes(parsed[2]) ||
            typeof parsed[3] !== 'string' ||
            !parsed[3] ||
            parsed[3].length > CURSOR_MAX_ID_CHARACTERS ||
            parsed[3].includes('\0')
        ) {
            return invalidCursor();
        }
        return { id: parsed[3], source: parsed[2] as ConversationSource, updatedAtMs: parsed[1] as number };
    } catch {
        return invalidCursor();
    }
};

export const paginateConversations = (
    conversations: ConversationDetail[],
    cursor: string | null | undefined,
    limit: number,
): ConversationPage => {
    if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new Error('Conversation pagination limit must be a positive integer.');
    }
    const cursorKey = decodeConversationCursor(cursor);
    const sorted = [...conversations].sort((left, right) => compareCursorKeys(toCursorKey(left), toCursorKey(right)));
    const eligible = cursorKey
        ? sorted.filter((conversation) => compareCursorKeys(toCursorKey(conversation), cursorKey) > 0)
        : sorted;
    const candidates = eligible.slice(0, limit + 1);
    const hasNext = candidates.length > limit;
    const data = hasNext ? candidates.slice(0, limit) : candidates;
    return {
        data,
        meta: {
            hasNext,
            nextCursor: hasNext ? encodeConversationCursor(data.at(-1)!) : null,
        },
    };
};
