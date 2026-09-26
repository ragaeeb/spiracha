import { createHash } from 'node:crypto';
import type { ConversationDetail } from './types';

export type EvidenceRetrievalRequest = {
    revision: string;
    messageId?: string;
    startOrder?: number;
    endOrder?: number;
    offset?: number;
    maxCharacters?: number;
};

const orderedMessages = (conversation: ConversationDetail) =>
    [...conversation.messages].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

export const evidenceRevision = (conversation: ConversationDetail): string =>
    createHash('sha256')
        .update(JSON.stringify([conversation.source, conversation.id, orderedMessages(conversation)]))
        .digest('hex');

const validateRequest = (request: EvidenceRetrievalRequest) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw new Error('Expected a retrieval request.');
    }
    const allowed = new Set(['revision', 'messageId', 'startOrder', 'endOrder', 'offset', 'maxCharacters']);
    for (const key of Object.keys(request)) {
        if (!allowed.has(key)) {
            throw new Error(`Unknown retrieval option: ${key}`);
        }
    }
    for (const key of ['startOrder', 'endOrder', 'offset', 'maxCharacters'] as const) {
        const value = request[key];
        if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
            throw new Error(`Invalid ${key}.`);
        }
    }
};

export const retrieveEvidencePage = (conversation: ConversationDetail, request: EvidenceRetrievalRequest) => {
    validateRequest(request);
    if (typeof request.revision !== 'string' || request.revision !== evidenceRevision(conversation)) {
        throw new Error('Evidence source changed or revision is invalid; regenerate focused evidence.');
    }
    const {
        messageId,
        startOrder = 0,
        endOrder = Number.MAX_SAFE_INTEGER,
        offset = 0,
        maxCharacters = 12000,
    } = request;
    if (maxCharacters < 2 || maxCharacters > 64000 || startOrder > endOrder) {
        throw new Error('Invalid retrieval bounds.');
    }
    if (
        messageId !== undefined &&
        (typeof messageId !== 'string' ||
            !messageId ||
            request.startOrder !== undefined ||
            request.endOrder !== undefined)
    ) {
        throw new Error('Use either a messageId or an event-order range.');
    }
    const messages = orderedMessages(conversation).filter((message) =>
        messageId === undefined ? message.order >= startOrder && message.order <= endOrder : message.id === messageId,
    );
    if (!messages.length) {
        throw new Error('No messages match the retrieval selection.');
    }
    const serialized = JSON.stringify(messages);
    if (offset >= serialized.length || (offset > 0 && /[\uDC00-\uDFFF]/u.test(serialized[offset]))) {
        throw new Error('Invalid retrieval offset.');
    }
    let end = Math.min(serialized.length, offset + maxCharacters);
    if (end < serialized.length && /[\uDC00-\uDFFF]/u.test(serialized[end])) {
        end -= 1;
    }
    return {
        content: serialized.slice(offset, end),
        format: 'normalized-messages-json' as const,
        nextOffset: end < serialized.length ? end : null,
        revision: request.revision,
        totalCharacters: serialized.length,
    };
};
