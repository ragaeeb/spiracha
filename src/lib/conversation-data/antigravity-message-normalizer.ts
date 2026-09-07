import type { AntigravityConversationMessage } from '../antigravity-transcript-normalizer';
import { finalizeMessages, normalizeToolStatus } from './adapter-helpers';
import type { ConversationMessage } from './types';

type ParsedToolCallEvidence = {
    callId: string | null;
    command: string | null;
    inputText: string;
    name: string;
    workdir: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const metadataString = (message: Pick<ConversationMessage, 'metadata'>, key: string): string | null => {
    const value = message.metadata?.[key];
    return typeof value === 'string' ? value : null;
};

const parseToolCallEvidence = (message: Pick<ConversationMessage, 'metadata' | 'text'>): ParsedToolCallEvidence => {
    const fallback: ParsedToolCallEvidence = {
        callId: metadataString(message, 'toolCallId'),
        command: metadataString(message, 'command'),
        inputText: message.text,
        name: 'unknown',
        workdir: metadataString(message, 'workdir'),
    };
    try {
        const parsed: unknown = JSON.parse(message.text.split('\n')[0] ?? '');
        const record = isRecord(parsed) ? parsed : null;
        if (!record) {
            return fallback;
        }
        const args = isRecord(record.args) ? record.args : null;
        return {
            callId: typeof record.id === 'string' ? record.id : fallback.callId,
            command: typeof args?.CommandLine === 'string' ? args.CommandLine : fallback.command,
            inputText: record.args === undefined ? message.text : JSON.stringify(record.args),
            name: typeof record.name === 'string' ? record.name : fallback.name,
            workdir: typeof args?.Cwd === 'string' ? args.Cwd : fallback.workdir,
        };
    } catch {
        return fallback;
    }
};

const antigravityToolEvidence = (message: Pick<ConversationMessage, 'metadata' | 'phase' | 'text'>) => {
    if (message.phase !== 'tool_call' && message.phase !== 'tool_output') {
        return null;
    }
    const call =
        message.phase === 'tool_call'
            ? parseToolCallEvidence(message)
            : {
                  callId: metadataString(message, 'toolCallId'),
                  command: metadataString(message, 'command'),
                  inputText: null,
                  name: metadataString(message, 'toolName') ?? 'unknown',
                  workdir: metadataString(message, 'workdir'),
              };
    const status = metadataString(message, 'status');
    const exitCode = typeof message.metadata.exitCode === 'number' ? message.metadata.exitCode : null;
    return {
        callId: call.callId,
        command: call.command,
        durationMs: null,
        exitCode,
        inputText: call.inputText,
        name: call.name,
        namespace: call.name.includes('.') ? (call.name.split('.')[0] ?? null) : null,
        outputText: message.phase === 'tool_output' ? message.text : null,
        status: normalizeToolStatus(status, exitCode),
        workdir: call.workdir,
    } as const;
};

const getEvidenceLimitationMetadata = (message: Pick<ConversationMessage, 'metadata' | 'phase'>) => {
    if (message.phase !== 'tool_call' && message.phase !== 'tool_output') {
        return {};
    }
    return message.metadata.toolCallId
        ? {}
        : { evidenceLimitation: 'This Antigravity transcript record does not expose a stable call ID.' };
};

export const normalizeAntigravityConversationMessages = (
    conversationId: string,
    transcriptSource: string | null,
    messages: AntigravityConversationMessage[],
): ConversationMessage[] =>
    finalizeMessages(
        messages.map((message, entryIndex): ConversationMessage => {
            const { model: sourceModel, ...sourceMetadata } = message.metadata;
            const model = typeof sourceModel === 'string' ? sourceModel : undefined;
            return {
                ...message,
                ...(model ? { model } : {}),
                id: `${conversationId}:${message.order}:${message.role}:${message.phase}:${entryIndex}`,
                metadata: {
                    ...sourceMetadata,
                    ...getEvidenceLimitationMetadata(message),
                    transcriptSource,
                },
                toolEvidence: antigravityToolEvidence(message),
            };
        }),
    );
