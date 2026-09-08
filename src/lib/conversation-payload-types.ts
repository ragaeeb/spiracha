import type { ConversationMessage, ConversationMessageSelector, ConversationSource } from './conversation-data/types';

export type ConversationPayloadSource = Exclude<ConversationSource, 'claude-code'> | 'web';

export type ConversationPayloadArtifact = { id: string; title: string; content: string };

export type ConvertConversationPayloadOptions = {
    payload: unknown;
    source?: ConversationPayloadSource;
    fileName?: string;
    messageSelector?: ConversationMessageSelector;
};

export type ConvertedConversation = {
    source: ConversationPayloadSource;
    id: string;
    title: string | null;
    model?: string;
    createdAtMs: number | null;
    updatedAtMs: number | null;
    workspacePath: string | null;
    metadata: Record<string, unknown>;
    messages: ConversationMessage[];
    artifacts: ConversationPayloadArtifact[];
    markdown: string;
};

export type PayloadConversationDraft = {
    source: ConversationPayloadSource;
    id?: string | null;
    title?: string | null;
    model?: string | null;
    createdAtMs?: number | null;
    updatedAtMs?: number | null;
    workspacePath?: string | null;
    metadata?: Record<string, unknown>;
    messages: ConversationMessage[];
    artifacts?: ConversationPayloadArtifact[];
};
