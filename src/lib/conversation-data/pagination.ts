import { CONVERSATION_SOURCES, type ConversationDetail, type ConversationPage, type ConversationSource } from './types';

const CURSOR_VERSION = 1;
const CURSOR_MAX_ENCODED_CHARACTERS = 18_000;
const CURSOR_MAX_ID_CHARACTERS = 2_048;

export type ConversationCursorKey = {
    id: string;
    source: ConversationSource;
    updatedAtMs: number;
};

const invalidCursor = (): never => {
    throw new Error('Invalid conversation pagination cursor.');
};

const compareStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

// A 2048-character ID can expand sixfold in JSON before base64 encoding.
const normalizeTimestamp = (value: number | null): number => {
    const integer = value === null ? 0 : Math.floor(value);
    return Number.isSafeInteger(integer) ? Math.max(0, integer) : 0;
};

const toCursorKey = (conversation: ConversationDetail): ConversationCursorKey => ({
    id: conversation.id,
    source: conversation.source,
    updatedAtMs: normalizeTimestamp(conversation.updatedAtMs),
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
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
        return invalidCursor();
    }
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
};

type PageCandidate = {
    conversation: ConversationDetail;
    index: number;
    key: ConversationCursorKey;
};

const compareCandidates = (left: PageCandidate, right: PageCandidate) =>
    compareCursorKeys(left.key, right.key) || left.index - right.index;

const pushCandidate = (heap: PageCandidate[], candidate: PageCandidate): void => {
    let index = heap.length;
    heap.push(candidate);
    while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (compareCandidates(heap[parent]!, candidate) >= 0) {
            break;
        }
        heap[index] = heap[parent]!;
        index = parent;
    }
    heap[index] = candidate;
};

const replaceWorstCandidate = (heap: PageCandidate[], candidate: PageCandidate): void => {
    let index = 0;
    while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && compareCandidates(heap[child + 1]!, heap[child]!) > 0) {
            child += 1;
        }
        if (compareCandidates(candidate, heap[child]!) >= 0) {
            break;
        }
        heap[index] = heap[child]!;
        index = child;
    }
    heap[index] = candidate;
};

/**
 * Pages by normalized updatedAtMs descending, then source and ID ascending.
 * Unknown/non-finite times become zero; finite times are floored and clamped
 * non-negative. Retains at most limit+1 keyed candidates (one lookahead) and
 * uses an opaque versioned cursor. The cursor contains a sort boundary, not a
 * frozen snapshot or filter identity; callers must preserve query filters and
 * tolerate concurrent source mutations.
 * @throws Invalid cursor or non-positive/non-safe-integer limit.
 */
export const paginateConversations = (
    conversations: ConversationDetail[],
    cursor: string | null | undefined,
    limit: number,
): ConversationPage => {
    if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new Error('Conversation pagination limit must be a positive integer.');
    }
    const cursorKey = decodeConversationCursor(cursor);
    // Keep only one page plus the lookahead, with the worst retained key at the root.
    const heap: PageCandidate[] = [];
    const capacity = Math.min(limit + 1, conversations.length);
    for (const [index, conversation] of conversations.entries()) {
        const key = toCursorKey(conversation);
        if (cursorKey && compareCursorKeys(key, cursorKey) <= 0) {
            continue;
        }
        const candidate = { conversation, index, key };
        if (heap.length < capacity) {
            pushCandidate(heap, candidate);
        } else if (compareCandidates(candidate, heap[0]!) < 0) {
            replaceWorstCandidate(heap, candidate);
        }
    }
    const candidates = heap.sort(compareCandidates).map(({ conversation }) => conversation);
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
