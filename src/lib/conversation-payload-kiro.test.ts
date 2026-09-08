import { describe, expect, it } from 'bun:test';
import { parseKiroPayload } from './conversation-payload-kiro';

describe('Kiro payload parser', () => {
    it('should parse a workspace session with text and image history', () => {
        const payload = {
            autonomyMode: 'Autopilot',
            defaultModelTitle: 'Agent',
            history: [
                {
                    message: {
                        content: [
                            { text: 'Review the vendor detector.', type: 'text' },
                            { imageUrl: { url: 'data:image/png;base64,AAA' }, type: 'imageUrl' },
                        ],
                        id: 'user-1',
                        role: 'user',
                    },
                },
                {
                    executionId: 'execution-1',
                    message: {
                        content: 'The vendor detection review is ready.',
                        id: 'assistant-1',
                        role: 'assistant',
                    },
                    promptLogs: [{ completion: 'The vendor detection review is ready.' }],
                },
            ],
            selectedModel: 'claude-sonnet-4.5',
            selectedProfileId: 'local',
            sessionId: 'session-1',
            sessionType: 'spec',
            title: 'Vendor detection review',
            workspacePath: '/workspace/project',
        };

        const [draft] = parseKiroPayload(payload)!;

        expect(draft).toMatchObject({
            id: 'session-1',
            model: 'claude-sonnet-4.5',
            source: 'kiro',
            title: 'Vendor detection review',
            workspacePath: '/workspace/project',
        });
        expect(draft.messages.map(({ phase, role, text }) => ({ phase, role, text }))).toEqual([
            { phase: 'unknown', role: 'user', text: 'Review the vendor detector.' },
            { phase: 'unknown', role: 'user', text: 'Image attachment' },
            { phase: 'final_answer', role: 'assistant', text: 'The vendor detection review is ready.' },
        ]);
        expect(draft.metadata).toMatchObject({ autonomyMode: 'Autopilot', sessionType: 'spec' });
    });

    it('should return null for unrelated payloads and reject malformed recognized history', () => {
        expect(parseKiroPayload({ answer: 'unrelated' })).toBeNull();
        expect(() => parseKiroPayload({ history: 'bad', sessionId: 'session-1' })).toThrow(/Kiro payload history/u);
        expect(() => parseKiroPayload({ history: [null], sessionId: 'session-1' })).toThrow(
            /Kiro payload history entries/u,
        );
    });
});
