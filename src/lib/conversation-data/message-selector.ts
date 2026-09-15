import type { ConversationMessage, ConversationMessageSelector } from './types';

/**
 * Selects by normalized message order, not timestamp. Equal-order ties retain the
 * first matching input message. last_final_answer requires an assistant message
 * explicitly marked final_answer and does not fall back to another assistant turn.
 * An unmatched selector returns []; all returns the original array without cloning.
 */
export const selectConversationMessages = (
    messages: ConversationMessage[],
    selector: ConversationMessageSelector,
): ConversationMessage[] => {
    if (selector === 'all') {
        return messages;
    }

    let selected: ConversationMessage | null = null;
    for (const message of messages) {
        if (message.role !== 'assistant' || (selector !== 'last_assistant' && message.phase !== 'final_answer')) {
            continue;
        }
        if (!selected || message.order > selected.order) {
            selected = message;
        }
    }
    return selected ? [selected] : [];
};
