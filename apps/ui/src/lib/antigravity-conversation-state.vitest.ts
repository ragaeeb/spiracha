import type { AntigravityTranscriptSource } from '@spiracha/lib/antigravity-exporter-types';
import { describe, expect, it } from 'vitest';
import {
    hasEncryptedAntigravityConversation,
    hasReadableAntigravityConversation,
} from './antigravity-conversation-state';

const conversationWithSource = (transcriptSource: AntigravityTranscriptSource | null) => ({ transcriptSource });

describe('Antigravity conversation state', () => {
    it.each(['overview', 'trajectory', 'transcript'] as const)(
        'should treat %s transcripts as readable without Keychain access',
        (transcriptSource) => {
            const conversation = conversationWithSource(transcriptSource);

            expect(hasReadableAntigravityConversation(conversation)).toBe(true);
            expect(hasEncryptedAntigravityConversation(conversation)).toBe(false);
        },
    );

    it('should reserve Keychain access for safe-storage transcripts', () => {
        const conversation = conversationWithSource('safe-storage');

        expect(hasReadableAntigravityConversation(conversation)).toBe(false);
        expect(hasEncryptedAntigravityConversation(conversation)).toBe(true);
    });
});
