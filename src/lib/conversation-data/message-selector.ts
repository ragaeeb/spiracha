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
