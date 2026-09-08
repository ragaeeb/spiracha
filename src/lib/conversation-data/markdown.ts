import { formatModelLabel } from '../model-label';
import { selectConversationMessages } from './message-selector';
import type { ConversationMessage, ConversationMessageSelector } from './types';

export const renderConversationMarkdown = (
    conversation: {
        messages: ConversationMessage[];
        model?: string;
        title: string | null;
    },
    options: {
        messageSelector?: ConversationMessageSelector;
    } = {},
) => {
    const selectedMessages = options.messageSelector
        ? selectConversationMessages(conversation.messages, options.messageSelector)
        : conversation.messages;
    const title = conversation.title?.trim() || 'Conversation';
    const roleLabels: Record<Exclude<ConversationMessage['role'], 'assistant'>, string> = {
        system: 'System',
        tool: 'Tool',
        unknown: 'Unknown',
        user: 'User',
    };
    const sections = selectedMessages.map((message) => {
        const text = message.text.trim() || '_No message content._';
        const roleLabel =
            message.role === 'assistant'
                ? formatModelLabel(message.model ?? conversation.model)
                : roleLabels[message.role];
        return `## ${roleLabel}\n\n${text}`;
    });
    if (sections.length === 0) {
        sections.push('_No messages selected._');
    }
    return [`# ${title}`, ...sections].join('\n\n').trimEnd() + '\n';
};
