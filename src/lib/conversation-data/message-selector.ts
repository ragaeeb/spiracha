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

const selectLastAnswerCandidate = (messages: ConversationMessage[]) =>
    latestByOrder(
        messages.filter(
            (message) =>
                message.role === 'assistant' &&
                message.phase !== 'reasoning' &&
                message.phase !== 'tool_call' &&
                message.phase !== 'tool_output',
        ),
    );

// Not every integration can identify final answers. In that case, API list/export defaults still
// return the latest assistant message instead of silently omitting the conversation.
const selectLastFinalAnswer = (messages: ConversationMessage[]) => {
    return (
        latestByOrder(messages.filter((message) => message.role === 'assistant' && message.phase === 'final_answer')) ??
        selectLastAnswerCandidate(messages)
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
