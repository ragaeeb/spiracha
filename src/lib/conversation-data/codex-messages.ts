import {
    createTextMessage,
    durationTextToMs,
    finalizeMessages,
    normalizeAssistantPhase,
    normalizeRole,
    normalizeToolStatus,
    toCanonicalMessage,
    toDateMs,
} from './adapter-helpers';
import { codexShellCommands } from './codex-shell-commands';
import type { MessageEvent, ThreadEvent, ToolCallEvent, ToolOutputEvent } from './conversation-events';
import type { ConversationMessage, ConversationMessagePhase } from './types';

const assistantPhase = (event: MessageEvent): ConversationMessagePhase => {
    if (!event.phase) {
        return 'final_answer';
    }
    return normalizeAssistantPhase(event.phase, 'unknown');
};

const toMessageEventMessage = (event: MessageEvent): ConversationMessage | null => {
    const text = event.text.trim();
    if (!text) {
        return null;
    }

    return toCanonicalMessage({
        createdAtMs: toDateMs(event.timestamp),
        id: `codex:${event.sequence}`,
        ...(event.model ? { model: event.model } : {}),
        metadata: {
            variant: event.variant,
        },
        order: event.sequence,
        phase: event.role === 'assistant' ? assistantPhase(event) : 'unknown',
        role: normalizeRole(event.role),
        text,
        toolEvidence: null,
    });
};

const toolNamespace = (name: string) => (name.includes('.') ? (name.split('.')[0] ?? null) : null);

const toToolCallMessage = (event: ToolCallEvent, toolNames: Map<string, string>): ConversationMessage | null => {
    if (event.callId) {
        toolNames.set(event.callId, event.name);
    }
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
                ...(event.name === 'exec' || event.name === 'functions.exec'
                    ? { shellCommands: codexShellCommands(event.argumentsText ?? event.command ?? '') }
                    : {}),
                durationMs: null,
                exitCode: null,
                inputText: event.argumentsText,
                name: event.name,
                namespace: toolNamespace(event.name),
                outputText: null,
                status: 'unknown',
                workdir: event.workdir,
            },
        })[0] ?? null
    );
};

const toToolOutputMessage = (event: ToolOutputEvent, toolNames: Map<string, string>): ConversationMessage | null => {
    const name = (event.callId ? toolNames.get(event.callId) : null) ?? 'unknown';
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
            text: event.summary || event.outputText,
            toolEvidence: {
                callId: event.callId,
                command: null,
                durationMs: durationTextToMs(event.wallTime),
                exitCode: event.exitCode,
                inputText: null,
                name,
                namespace: toolNamespace(name),
                outputText: event.outputText,
                status: normalizeToolStatus(null, event.exitCode),
                workdir: null,
            },
        })[0] ?? null
    );
};

const toConversationMessage = (event: ThreadEvent, toolNames: Map<string, string>): ConversationMessage | null => {
    if (event.kind === 'message') {
        if (event.isHiddenByDefault) {
            return null;
        }

        return toMessageEventMessage(event);
    }

    if (event.kind === 'reasoning') {
        const text = event.summary.join('\n').trim();
        return text
            ? toCanonicalMessage({
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
              })
            : null;
    }

    if (event.kind === 'tool_call') {
        return toToolCallMessage(event, toolNames);
    }
    if (event.kind === 'tool_output') {
        return toToolOutputMessage(event, toolNames);
    }
    return null;
};

export const normalizeCodexEvents = (events: ThreadEvent[]): ConversationMessage[] => {
    const toolNames = new Map<string, string>();
    return finalizeMessages(
        events.flatMap((event) => {
            const message = toConversationMessage(event, toolNames);
            return message ? [message] : [];
        }),
    );
};
