import type { CursorBubble } from '../cursor-exporter-types';
import { getCursorTextBubblePhase, getFinalCursorAssistantTextBubbleIds } from '../cursor-transcript-phase';
import { createTextMessage, finalizeMessages, normalizeToolStatus } from './adapter-helpers';
import type { ConversationMessage } from './types';

const bubbleToMessages = (
    bubble: CursorBubble,
    finalAssistantTextBubbleIds: Set<string>,
    order: number,
): ConversationMessage[] => {
    const thinking = createTextMessage({
        createdAtMs: bubble.createdAtMs,
        id: `${bubble.bubbleId}:thinking`,
        order,
        phase: 'reasoning',
        role: 'assistant',
        text: bubble.thinking,
    });
    const text = createTextMessage({
        createdAtMs: bubble.createdAtMs,
        id: bubble.bubbleId,
        order,
        phase: getCursorTextBubblePhase(bubble, finalAssistantTextBubbleIds) ?? 'unknown',
        role: bubble.kind === 'assistant' ? 'assistant' : bubble.kind === 'user' ? 'user' : 'unknown',
        text: bubble.text,
    });
    const toolCall = bubble.toolCall
        ? createTextMessage({
              createdAtMs: bubble.createdAtMs,
              id: `${bubble.bubbleId}:tool_call`,
              metadata: { callId: bubble.toolCall.callId, status: bubble.toolCall.status },
              order,
              phase: 'tool_call',
              role: 'tool',
              text: [bubble.toolCall.name, bubble.toolCall.argumentsText].filter(Boolean).join('\n'),
              toolEvidence: {
                  callId: bubble.toolCall.callId,
                  command: null,
                  durationMs: null,
                  exitCode: null,
                  inputText: bubble.toolCall.argumentsText,
                  name: bubble.toolCall.name,
                  namespace: bubble.toolCall.name.includes('.') ? (bubble.toolCall.name.split('.')[0] ?? null) : null,
                  outputText: null,
                  status: normalizeToolStatus(bubble.toolCall.status),
                  workdir: null,
              },
          })
        : [];
    const toolOutput = bubble.toolCall
        ? createTextMessage({
              createdAtMs: bubble.createdAtMs,
              id: `${bubble.bubbleId}:tool_output`,
              metadata: { callId: bubble.toolCall.callId, status: bubble.toolCall.status },
              order,
              phase: 'tool_output',
              role: 'tool',
              text: bubble.toolCall.resultText,
              toolEvidence: {
                  callId: bubble.toolCall.callId,
                  command: null,
                  durationMs: null,
                  exitCode: null,
                  inputText: null,
                  name: bubble.toolCall.name,
                  namespace: bubble.toolCall.name.includes('.') ? (bubble.toolCall.name.split('.')[0] ?? null) : null,
                  outputText: bubble.toolCall.resultText,
                  status: normalizeToolStatus(bubble.toolCall.status),
                  workdir: null,
              },
          })
        : [];

    return [...thinking, ...text, ...toolCall, ...toolOutput];
};

export const cursorBubblesToMessages = (bubbles: CursorBubble[]): ConversationMessage[] => {
    const finalAssistantTextBubbleIds = getFinalCursorAssistantTextBubbleIds(bubbles);
    return finalizeMessages(
        bubbles.flatMap((bubble, order) => bubbleToMessages(bubble, finalAssistantTextBubbleIds, order)),
    );
};
