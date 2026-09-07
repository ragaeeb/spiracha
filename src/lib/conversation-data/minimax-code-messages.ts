import type {
    MiniMaxCodeSessionTranscript,
    MiniMaxCodeToolCall,
    MiniMaxCodeTranscriptMessage,
} from '../minimax-code-exporter-types';
import { getMiniMaxCodeMessagePhase } from '../minimax-code-transcript-phase';
import { createTextMessage, finalizeMessages, normalizeRole } from './adapter-helpers';
import type { ConversationMessage } from './types';

const toolCallToMessages = (
    toolCall: MiniMaxCodeToolCall,
    message: MiniMaxCodeTranscriptMessage,
    toolIndex: number,
    order: number,
    worktree: string,
): ConversationMessage[] => {
    const id = `${message.messageId}:tool:${toolIndex}`;
    const metadata = { callId: toolCall.callId, status: toolCall.status, toolName: toolCall.toolName };
    const evidence = {
        callId: toolCall.callId,
        command: toolCall.command,
        durationMs: null,
        exitCode: null,
        name: toolCall.toolName,
        namespace: null,
        status: toolCall.status,
        workdir: worktree,
    } as const;
    return [
        ...createTextMessage({
            createdAtMs: message.createdAtMs,
            id: `${id}:call`,
            metadata,
            order,
            phase: 'tool_call',
            role: 'tool',
            text: [toolCall.toolName, toolCall.argumentsText].filter(Boolean).join('\n'),
            toolEvidence: {
                ...evidence,
                inputText: toolCall.argumentsText,
                outputText: null,
            },
        }),
        ...createTextMessage({
            createdAtMs: message.createdAtMs,
            id: `${id}:output`,
            metadata,
            order,
            phase: 'tool_output',
            role: 'tool',
            text: toolCall.outputText,
            toolEvidence: {
                ...evidence,
                inputText: null,
                outputText: toolCall.outputText,
            },
        }),
    ];
};

const transcriptMessageToMessages = (
    message: MiniMaxCodeTranscriptMessage,
    order: number,
    worktree: string,
): ConversationMessage[] => {
    const metadata = {
        finishReason: message.finishReason,
        messageType: message.messageType,
        thinkingDurationMs: message.thinkingDurationMs,
    };
    const messages: ConversationMessage[] = [
        ...createTextMessage({
            createdAtMs: message.createdAtMs,
            id: `${message.messageId}:reasoning`,
            metadata,
            order,
            phase: 'reasoning',
            role: 'assistant',
            text: message.reasoning,
        }),
        ...createTextMessage({
            createdAtMs: message.createdAtMs,
            id: message.messageId,
            metadata,
            order,
            phase: getMiniMaxCodeMessagePhase(message) ?? 'unknown',
            role: normalizeRole(message.role),
            text: message.content,
        }),
    ];
    messages.push(
        ...message.toolCalls.flatMap((toolCall, toolIndex) =>
            toolCallToMessages(toolCall, message, toolIndex, order, worktree),
        ),
    );
    return messages;
};

export const normalizeMiniMaxCodeTranscript = (transcript: MiniMaxCodeSessionTranscript): ConversationMessage[] => {
    return finalizeMessages(
        transcript.messages.flatMap((message, order) =>
            transcriptMessageToMessages(message, order, transcript.session.worktree),
        ),
    );
};
