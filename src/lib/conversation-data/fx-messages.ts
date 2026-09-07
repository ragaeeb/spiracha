import type { FxSessionTranscript, FxToolCall, FxTranscriptMessage } from '../fx-exporter-types';
import { getFxMessagePhase } from '../fx-transcript-phase';
import { createTextMessage, finalizeMessages, normalizeRole } from './adapter-helpers';
import type { ConversationMessage } from './types';

const toolCallToMessages = (
    toolCall: FxToolCall,
    message: FxTranscriptMessage,
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
        exitCode: toolCall.status === 'succeeded' ? 0 : toolCall.status === 'failed' ? 1 : null,
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
            toolEvidence: { ...evidence, inputText: toolCall.argumentsText, outputText: null },
        }),
        ...createTextMessage({
            createdAtMs: message.createdAtMs,
            id: `${id}:output`,
            metadata,
            order,
            phase: 'tool_output',
            role: 'tool',
            text: toolCall.outputText,
            toolEvidence: { ...evidence, inputText: null, outputText: toolCall.outputText },
        }),
    ];
};

const transcriptMessageToMessages = (
    message: FxTranscriptMessage,
    order: number,
    worktree: string,
): ConversationMessage[] => {
    const metadata = { finishReason: message.finishReason, messageType: message.messageType };
    return [
        ...createTextMessage({
            createdAtMs: message.createdAtMs,
            id: message.messageId,
            metadata,
            order,
            phase: getFxMessagePhase(message) ?? 'unknown',
            role: normalizeRole(message.role),
            text: message.content,
        }),
        ...message.toolCalls.flatMap((toolCall, toolIndex) =>
            toolCallToMessages(toolCall, message, toolIndex, order, worktree),
        ),
    ];
};

export const normalizeFxTranscript = (transcript: FxSessionTranscript): ConversationMessage[] =>
    finalizeMessages(
        transcript.messages.flatMap((message, order) =>
            transcriptMessageToMessages(message, order, transcript.session.worktree),
        ),
    );
