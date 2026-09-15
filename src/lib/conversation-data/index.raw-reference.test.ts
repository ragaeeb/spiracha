import { describe, expect, it } from 'bun:test';
import { resolveConversationRef } from './index';
import { CONVERSATION_SOURCES } from './types';

describe('raw export conversation references', () => {
    it('should resolve raw-export URLs consistently with detail, Markdown and evidence URLs', async () => {
        for (const source of CONVERSATION_SOURCES) {
            for (const suffix of ['', '/export', '/evidence', '/raw']) {
                const ref = await resolveConversationRef(
                    `http://localhost:3000/api/v1/conversations/${source}/thread-1${suffix}`,
                );
                expect(ref).toEqual({ id: 'thread-1', source });
            }
        }
    });

    it('should continue rejecting unrelated operations and additional path segments', async () => {
        for (const suffix of ['unknown', 'raw/extra']) {
            expect(
                await resolveConversationRef(`http://localhost:3000/api/v1/conversations/codex/id/${suffix}`),
            ).toBeNull();
        }
    });
});
