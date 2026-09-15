import type { ConversationMessage, ConversationMessageSelector } from './types';

const latestByOrder = (messages: ConversationMessage[]) => {
    let latest: ConversationMessage | null = null;
    for (const message of messages) {
        if (!latest || message.order > latest.order) {
            latest = message;
        }
    }
    return latest;
};

const selectLastAssistantMessage = (messages: ConversationMessage[]) => {
    return latestByOrder(messages.filter((message) => message.role === 'assistant'));
};

const selectLastFinalAnswer = (messages: ConversationMessage[]) => {
    return latestByOrder(
        messages.filter((message) => message.role === 'assistant' && message.phase === 'final_answer'),
    );
};

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

    const selected =
        selector === 'last_assistant' ? selectLastAssistantMessage(messages) : selectLastFinalAnswer(messages);
    return selected ? [selected] : [];
};
