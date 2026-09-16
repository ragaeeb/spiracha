import { renderConversationMarkdownOptions, renderNormalizedExport } from './conversation-export';
import type { CompactExportFlags } from './export-options';
import type { ConversationMessage, ConversationMessageSelector } from './types';

export const renderConversationMarkdown = (
    conversation: {
        artifacts?: Array<{ content: string; id: string; title: string }>;
        messages: ConversationMessage[];
        metadata?: Record<string, unknown>;
        model?: string;
        supplementalEvents?: Array<{
            createdAtMs: number | null;
            id: string;
            kind: 'lifecycle' | 'search' | 'token_usage' | 'unknown';
            metadata: Record<string, string | number | boolean | null>;
            order: number;
            provenance: ConversationMessage['provenance'];
            text: string;
        }>;
        title: string | null;
    },
    options: {
        messageSelector?: ConversationMessageSelector;
    } & CompactExportFlags = {},
) => {
    const defaults = renderConversationMarkdownOptions(options.messageSelector);
    return renderNormalizedExport(conversation, {
        ...defaults,
        ...options,
        format: options.outputFormat ?? defaults.format,
    });
};
