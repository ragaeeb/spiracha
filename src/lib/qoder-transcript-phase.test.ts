import { describe, expect, it } from 'bun:test';
import type { QoderTranscriptEntry } from './qoder-exporter-types';
import { coalesceQoderMessageChunks, getFinalQoderAssistantMessageEntryIds } from './qoder-transcript-phase';

const chunk = (entryId: string, text: string): QoderTranscriptEntry => ({
    entryId,
    entryType: 'message',
    parts: [
        {
            raw: { sessionUpdate: 'agent_message_chunk', source: 'qoderAcpSessionLoad' },
            text,
            type: 'text',
        },
    ],
    raw: { sessionUpdate: 'agent_message_chunk' },
    requestId: 'request-1',
    role: 'assistant',
    timestamp: null,
});

describe('Qoder transcript phases', () => {
    it('should coalesce consecutive streamed final-answer chunks', () => {
        const entries = coalesceQoderMessageChunks([
            chunk('chunk-1', 'The complete answer '),
            chunk('chunk-2', 'continues here.'),
        ]);

        expect(entries).toHaveLength(1);
        expect(entries[0]?.parts[0]?.text).toBe('The complete answer continues here.');
        expect(getFinalQoderAssistantMessageEntryIds(entries)).toEqual(new Set(['chunk-1']));
    });
});
