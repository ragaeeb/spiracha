import { describe, expect, it } from 'bun:test';
import { parseGrokBotPayload } from './conversation-payload-grok-bot';

describe('parseGrokBotPayload', () => {
    it('should parse a self-contained Grok Bot transcript replica blob', () => {
        const [draft] = parseGrokBotPayload({
            id: 'chat-1',
            roster: {
                createdAtMs: 10,
                description: 'Software Engineering',
                id: 'chat-1',
                isGroup: true,
                lastActivityAtMs: 21,
                memberIds: ['kiwi'],
                name: 'Bamba Dev Team',
                title: 'Team',
                updatedAtMs: 20,
            },
            rosterRows: [{ id: 'kiwi', name: 'Kiwi' }],
            schemaVersion: 1,
            value: {
                entries: [
                    { content: 'Fix the footer', id: 'u1', kind: 'message', role: 'user', timestampMs: 20 },
                    {
                        author: { id: 'kiwi', name: 'Kiwi' },
                        id: 'a1',
                        kind: 'send-message',
                        message: { content: 'Footer fixed', type: 'text' },
                        timestampMs: 21,
                    },
                    { event: 'automation-changed', id: 'e1', kind: 'event', timestampMs: 22 },
                ],
                persistedAtMs: 22,
            },
        })!;

        expect(draft).toMatchObject({
            createdAtMs: 10,
            id: 'chat-1',
            source: 'grok-bot',
            title: 'Bamba Dev Team',
            updatedAtMs: 22,
        });
        expect(draft?.messages.map(({ phase, role, text }) => ({ phase, role, text }))).toEqual([
            { phase: 'unknown', role: 'user', text: 'Fix the footer' },
            { phase: 'final_answer', role: 'assistant', text: 'Footer fixed' },
        ]);
        expect(draft?.messages[1]?.metadata).toMatchObject({ authorId: 'kiwi', authorName: 'Kiwi', chatKind: 'group' });
        expect(draft?.metadata).toMatchObject({
            chatKind: 'group',
            description: 'Software Engineering',
            lastActivityAtMs: 21,
            memberIds: ['kiwi'],
            members: [{ id: 'kiwi', name: 'Kiwi' }],
            replicaPersistedAtMs: 22,
            rosterUpdatedAtMs: 20,
            sourceEntryKinds: ['message', 'send-message', 'event'],
        });
    });

    it('should parse exact roster envelopes with inline transcript rows', () => {
        const drafts = parseGrokBotPayload({
            schemaVersion: 4,
            value: {
                rows: [
                    {
                        id: 'chat-2',
                        isGroup: false,
                        name: 'Kiwi',
                        transcript: { entries: [{ content: 'Hi', kind: 'message', role: 'user' }] },
                    },
                ],
            },
        });
        expect(drafts?.[0]?.id).toBe('chat-2');
        expect(drafts?.[0]?.messages[0]?.text).toBe('Hi');
    });

    it('should accept self-contained replicas without roster ids and reject malformed blobs or duplicates', () => {
        const [withoutId] = parseGrokBotPayload({
            schemaVersion: 1,
            value: { entries: [{ content: 'No roster needed', kind: 'message', role: 'user' }] },
        })!;
        expect(withoutId).toMatchObject({ id: null, source: 'grok-bot', title: null });
        expect(withoutId?.messages[0]?.metadata).toMatchObject({ chatKind: 'unknown' });
        expect(() =>
            parseGrokBotPayload({
                id: 'bad',
                schemaVersion: 1,
                value: { entries: [{ kind: 'message', role: 'user' }] },
            }),
        ).toThrow('Grok Bot');
        expect(() =>
            parseGrokBotPayload([
                { entries: [{ content: 'one', kind: 'message', role: 'user' }], id: 'same' },
                { entries: [{ content: 'two', kind: 'message', role: 'user' }], id: 'same' },
            ]),
        ).toThrow('duplicate');
        expect(parseGrokBotPayload({ hello: 'world' })).toBeNull();
    });

    it('should reject incomplete roster exports, unsupported schemas and partially malformed batches', () => {
        expect(() =>
            parseGrokBotPayload({ schemaVersion: 4, value: { rows: [{ id: 'chat', name: 'Chat' }] } }),
        ).toThrow('inline transcript');
        expect(() => parseGrokBotPayload({ schemaVersion: 2, value: { entries: [] } })).toThrow('Grok Bot');
        expect(() => parseGrokBotPayload({ schemaVersion: 1, value: { entries: [null] } })).toThrow('entry');
        expect(() => parseGrokBotPayload([{ entries: [{ content: 'Valid', kind: 'message' }] }, null])).toThrow(
            'batch',
        );
    });
});
