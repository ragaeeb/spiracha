import type { ConversationMessage, ConversationMessageSelector } from './types';

const latestByOrder = (messages: ConversationMessage[]) => {
    return [...messages].sort((left, right) => right.order - left.order)[0] ?? null;
};

const selectLastAssistantMessage = (messages: ConversationMessage[]) => {
    return latestByOrder(messages.filter((message) => message.role === 'assistant'));
};

const selectLastFinalAnswer = (messages: ConversationMessage[]) => {
    return (
        latestByOrder(messages.filter((message) => message.role === 'assistant' && message.phase === 'final_answer')) ??
        selectLastAssistantMessage(messages)
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
