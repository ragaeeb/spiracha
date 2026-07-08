import type { AntigravityConversation, AntigravityTranscriptSource } from '@spiracha/lib/antigravity-exporter-types';

const READABLE_TRANSCRIPT_SOURCES: ReadonlySet<AntigravityTranscriptSource> = new Set(['overview', 'transcript']);

export const hasReadableAntigravityConversation = (conversation: AntigravityConversation): boolean => {
    return conversation.transcriptSource !== null && READABLE_TRANSCRIPT_SOURCES.has(conversation.transcriptSource);
};

export const hasEncryptedAntigravityConversation = (conversation: AntigravityConversation): boolean => {
    return conversation.transcriptSource === 'safe-storage';
};

export const hasSummaryAntigravityConversation = (conversation: AntigravityConversation): boolean => {
    return (
        conversation.artifactCount === 0 &&
        conversation.transcriptSource === null &&
        (conversation.summaryPath !== null || conversation.indexedItemCount !== null)
    );
};

export const isAntigravityConversationLocked = (
    conversation: AntigravityConversation,
    hasKeychainSecret: boolean,
): boolean => {
    return hasEncryptedAntigravityConversation(conversation) && !hasKeychainSecret;
};

export const canExportAntigravityConversation = (
    conversation: AntigravityConversation,
    hasKeychainSecret: boolean,
): boolean => {
    if (hasReadableAntigravityConversation(conversation)) {
        return true;
    }

    if (hasEncryptedAntigravityConversation(conversation)) {
        return hasKeychainSecret;
    }

    return hasSummaryAntigravityConversation(conversation);
};
