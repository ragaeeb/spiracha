import { describe, expect, it } from 'bun:test';
import { convertConversationPayload } from './conversation-payload';

const session = {
    coverage: {
        complete: false,
        description: 'Only available messages exported',
        earliestMessageId: 'm1',
        latestMessageId: 'm1',
        messageCount: 1,
        scope: 'visible-room-messages',
    },
    exportedAt: '2026-10-14T20:00:00Z',
    model: 'configured-model',
    modelSource: 'user-configured',
    name: 'Example Dot',
    schemaVersion: 'dot/transcript/v1',
    sessionId: 'room-1',
    source: 'dot',
    type: 'session',
};
const message = {
    id: 'm1',
    replyToId: 'outside-export',
    role: 'assistant',
    schemaVersion: 'dot/transcript/v1',
    sessionId: 'room-1',
    text: 'Exact answer\n',
    timestamp: '2026-10-13T20:00:00Z',
    type: 'message',
};
const jsonl = (records: unknown[]) => records.map((record) => JSON.stringify(record)).join('\r\n') + '\r\n';

describe('dot transcript payloads', () => {
    it('should infer dot JSONL and preserve source evidence without backfilling historical models', async () => {
        const [result] = await convertConversationPayload({ payload: jsonl([session, message]) });
        expect(result).toMatchObject({
            id: 'room-1',
            metadata: { configuredModel: 'configured-model', coverage: session.coverage, session },
            source: 'dot',
        });
        expect(result!.model).toBeUndefined();
        expect(result!.messages[0]).toMatchObject({
            id: 'm1',
            metadata: { sourceRecord: message },
            provenance: { parentMessageId: 'outside-export', sourceConversationId: 'room-1', sourceRecordId: 'm1' },
            text: message.text,
        });
        expect(result!.messages[0]!.model).toBeUndefined();
        expect(result!.markdown).toContain('Exact answer');
        expect(result!.markdown).not.toContain('configured-model');
    });

    it('should preserve an empty visible export with empty boundary IDs', async () => {
        const [result] = await convertConversationPayload({
            payload: [
                {
                    ...session,
                    coverage: {
                        complete: false,
                        description: 'No available messages',
                        earliestMessageId: '',
                        latestMessageId: '',
                        messageCount: 0,
                        scope: 'visible-room-messages',
                    },
                },
            ],
            source: 'dot',
        });
        expect(result!.messages).toEqual([]);
        expect(result!.createdAtMs).toBeNull();
        expect(result!.updatedAtMs).toBeNull();
    });

    it('should keep attachment-only messages without inventing model evidence', async () => {
        const attached = {
            ...message,
            attachments: [{ id: 'file-1', name: 'report.pdf' }],
            text: '',
        };
        const [result] = await convertConversationPayload({ payload: [session, attached], source: 'dot' });
        expect(result!.messages).toHaveLength(1);
        expect(result!.messages[0]).toMatchObject({
            metadata: { sourceRecord: attached },
            text: '',
        });
        expect(result!.artifacts).toEqual([]);
    });

    it('should apply canonical selectors without losing coverage', async () => {
        const [result] = await convertConversationPayload({
            messageSelector: 'last_assistant',
            payload: [
                { ...session, coverage: { ...session.coverage, latestMessageId: 'm2', messageCount: 2 } },
                { ...message, role: 'user' },
                { ...message, id: 'm2' },
            ],
            source: 'dot',
        });
        expect(result!.messages.map((entry) => entry.id)).toEqual(['m2']);
        expect(result!.metadata.coverage).toEqual({ ...session.coverage, latestMessageId: 'm2', messageCount: 2 });
    });

    it('should validate chronological coverage boundaries without reordering source messages', async () => {
        const [result] = await convertConversationPayload({
            payload: [
                { ...session, coverage: { ...session.coverage, latestMessageId: 'm2', messageCount: 2 } },
                { ...message, id: 'm2', timestamp: '2026-10-14T20:00:00Z' },
                message,
            ],
            source: 'dot',
        });
        expect(result!.messages.map((entry) => entry.id)).toEqual(['m2', 'm1']);
    });

    it('should reject malformed claimed transcripts instead of silently dropping records or falling back', async () => {
        const invalid = [
            [{ ...session, schemaVersion: 'dot/transcript/v2' }, message],
            [session, { ...message, sessionId: 'other-room' }],
            [session, message, message],
            [session, { ...message, role: 'system' }],
            [session, { ...message, timestamp: 'invalid' }],
            [session, { ...message, attachments: ['not metadata'] }],
            [session, { ...message, model: 'unattributed' }],
            [session, { ...message, model: 'historical-model', modelSource: 'message-record' }],
            [session, null],
            [{ ...session, name: undefined }, message],
            [{ ...session, modelSource: 'inferred' }, message],
            [session, { ...message, timestamp: '2026-10-14' }],
            [session, { ...message, timestamp: '2026-02-30T10:00:00Z' }],
            [session, { ...message, timestamp: '2026-10-14T24:00:00Z' }],
            [session, { ...message, attachments: [{ id: 'file', size: -1 }] }],
            [{ ...session, privateReasoning: 'hidden' }, message],
            [session, { ...message, toolTraces: ['hidden'] }],
            [session, { ...message, attachments: [{ content: 'hidden', id: 'file' }] }],
            [session, { ...message, attachments: [{ blob: 'hidden', id: 'file' }] }],
            [{ ...session, coverage: { privateReasoning: 'hidden' } }, message],
            [{ ...session, coverage: { complete: 'yes' } }, message],
            [{ ...session, coverage: { messageCount: 2 } }, message],
            [{ ...session, coverage: { earliestMessageId: 'missing' } }, message],
            [{ ...session, coverage: { latestMessageId: 'missing' } }, message],
            [session, { ...message, text: null }],
            [message],
            [{ ...session, coverage: undefined }, message],
        ];
        for (const payload of invalid) {
            for (const source of [undefined, 'dot'] as const) {
                await expect(
                    convertConversationPayload({ payload: JSON.parse(JSON.stringify(payload)), source }),
                ).rejects.toMatchObject({ code: 'malformed_payload' });
            }
        }
    });
});
