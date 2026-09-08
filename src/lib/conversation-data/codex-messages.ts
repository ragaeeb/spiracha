import type { MessageEvent, ThreadEvent } from '../codex-browser-types';
import {
    createTextMessage,
    durationTextToMs,
    finalizeMessages,
    normalizeAssistantPhase,
    normalizeRole,
    normalizeToolStatus,
    toDateMs,
} from './adapter-helpers';
import type { ConversationMessage } from './types';

const toMessageEventMessage = (event: MessageEvent): ConversationMessage | null => {
    const text = event.text.trim();
    if (!text) {
        return null;
    }

    return {
        createdAtMs: toDateMs(event.timestamp),
        id: `codex:${event.sequence}`,
        ...(event.model ? { model: event.model } : {}),
        metadata: {
            variant: event.variant,
        },
        order: event.sequence,
        phase:
            event.role === 'assistant'
                ? normalizeAssistantPhase(event.isHiddenByDefault ? 'commentary' : event.phase, 'unknown')
                : 'unknown',
        role: normalizeRole(event.role),
        text,
        toolEvidence: null,
    };
};

const toToolMessage = (event: ThreadEvent): ConversationMessage | null => {
    if (event.kind === 'tool_call') {
        return (
            createTextMessage({
                createdAtMs: toDateMs(event.timestamp),
                id: `codex:${event.sequence}`,
                metadata: {
                    callId: event.callId,
                    command: event.command,
                    name: event.name,
                    workdir: event.workdir,
                },
                order: event.sequence,
                phase: 'tool_call',
                role: 'tool',
                text: event.command || event.name,
                toolEvidence: {
                    callId: event.callId,
                    command: event.command,
                    durationMs: null,
                    exitCode: null,
                    inputText: event.argumentsText,
                    name: event.name,
                    namespace: event.name?.includes('.') ? (event.name.split('.')[0] ?? null) : null,
                    outputText: null,
                    status: 'unknown',
                    workdir: event.workdir,
                },
            })[0] ?? null
        );
    }

    if (event.kind === 'tool_output') {
        const text = event.summary || event.outputText;
        return (
            createTextMessage({
                createdAtMs: toDateMs(event.timestamp),
                id: `codex:${event.sequence}`,
                metadata: {
                    callId: event.callId,
                    exitCode: event.exitCode,
                    wallTime: event.wallTime,
                },
                order: event.sequence,
                phase: 'tool_output',
                role: 'tool',
                text,
                toolEvidence: {
                    callId: event.callId,
                    command: null,
                    durationMs: durationTextToMs(event.wallTime),
                    exitCode: event.exitCode,
                    inputText: null,
                    name: 'unknown',
                    namespace: null,
                    outputText: event.outputText,
                    status: normalizeToolStatus(null, event.exitCode),
                    workdir: null,
                },
            })[0] ?? null
        );
    }

    return null;
};

const toConversationMessage = (event: ThreadEvent): ConversationMessage | null => {
    if (event.kind === 'message') {
        if (event.isHiddenByDefault) {
            return null;
        }

        return toMessageEventMessage(event);
    }

    if (event.kind === 'reasoning') {
        const text = event.summary.join('\n').trim();
        return text
            ? {
                  createdAtMs: toDateMs(event.timestamp),
                  id: `codex:${event.sequence}`,
                  metadata: {
                      hasEncryptedContent: event.hasEncryptedContent,
                  },
                  order: event.sequence,
                  phase: 'reasoning',
                  role: 'assistant',
                  text,
                  toolEvidence: null,
              }
            : null;
    }

    return toToolMessage(event);
};

export const normalizeCodexEvents = (events: ThreadEvent[]): ConversationMessage[] =>
    finalizeMessages(
        events.flatMap((event) => {
            const message = toConversationMessage(event);
            return message ? [message] : [];
        }),
    );
