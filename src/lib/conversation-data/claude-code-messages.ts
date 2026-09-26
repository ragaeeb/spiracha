import type {
    ClaudeCodeSessionTranscript,
    ClaudeCodeTranscriptEntry,
    ClaudeCodeTranscriptPart,
} from '../claude-code-exporter-types';
import { getClaudeCodeAssistantMessagePhase } from '../claude-code-exporter-types';
import {
    createTextMessage,
    finalizeMessages,
    getToolNamespace,
    normalizeAssistantPhase,
    normalizeRole,
    normalizeToolStatus,
    toDateMs,
} from './adapter-helpers';
import type { ConversationMessage } from './types';

const shellArguments = (name: string, text: string | null | undefined) => {
    if (name !== 'Bash') {
        return { command: null, workdir: null };
    }
    try {
        const value: unknown = JSON.parse(text ?? '{}');
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const record = value as Record<string, unknown>;
            return {
                command: typeof record.command === 'string' ? record.command : null,
                workdir: typeof record.cwd === 'string' ? record.cwd : null,
            };
        }
    } catch {
        /* Malformed native arguments retain their original text. */
    }
    return { command: null, workdir: null };
};

const partToMessages = (
    entry: ClaudeCodeTranscriptEntry,
    part: ClaudeCodeTranscriptPart,
    partIndex: number,
): ConversationMessage[] => {
    const createdAtMs = toDateMs(entry.timestamp);
    const baseId = `${entry.entryId}:${partIndex}`;
    const model = entry.model ?? undefined;
    if (part.type === 'text') {
        return createTextMessage({
            createdAtMs,
            id: baseId,
            model,
            order: partIndex,
            phase: normalizeAssistantPhase(getClaudeCodeAssistantMessagePhase(entry), 'unknown'),
            role: normalizeRole(entry.role),
            text: part.text,
        });
    }

    if (part.type === 'thinking') {
        return createTextMessage({
            createdAtMs,
            id: baseId,
            model,
            order: partIndex,
            phase: 'reasoning',
            role: 'assistant',
            text: part.text,
        });
    }

    if (part.type === 'tool_use') {
        const toolName = part.toolName ?? 'unknown';
        const shell = shellArguments(toolName, part.argumentsText);
        return createTextMessage({
            createdAtMs,
            id: baseId,
            metadata: { toolName: part.toolName, toolUseId: part.toolUseId },
            model,
            order: partIndex,
            phase: 'tool_call',
            role: 'tool',
            text: [part.toolName, part.argumentsText].filter(Boolean).join('\n'),
            toolEvidence: {
                callId: part.toolUseId ?? null,
                command: shell.command,
                durationMs: null,
                exitCode: null,
                inputText: part.argumentsText ?? null,
                name: toolName,
                namespace: getToolNamespace(toolName),
                outputText: null,
                status: 'unknown',
                workdir: shell.workdir ?? entry.cwd,
            },
        });
    }

    if (part.type === 'tool_result') {
        return createTextMessage({
            createdAtMs,
            id: baseId,
            metadata: { isError: part.isError, toolUseId: part.toolUseId },
            model,
            order: partIndex,
            phase: 'tool_output',
            role: 'tool',
            text: part.outputText,
            toolEvidence: {
                callId: part.toolUseId ?? null,
                command: null,
                durationMs: null,
                exitCode: null,
                inputText: null,
                name: 'unknown',
                namespace: null,
                outputText: part.outputText ?? null,
                status: normalizeToolStatus(null, null, part.isError === true),
                workdir: null,
            },
        });
    }

    if (part.type === 'attachment') {
        const attachmentLabel = part.attachmentType?.trim() || 'file';
        return createTextMessage({
            createdAtMs,
            id: baseId,
            metadata: { attachmentType: part.attachmentType ?? null },
            model,
            order: partIndex,
            phase: 'unknown',
            role: normalizeRole(entry.role),
            text: part.text?.trim() || `[Attachment: ${attachmentLabel}]`,
        });
    }

    return [];
};

export const claudeCodeTranscriptToMessages = (transcript: ClaudeCodeSessionTranscript): ConversationMessage[] =>
    finalizeMessages(
        transcript.entries.flatMap((entry) =>
            entry.parts.flatMap((part, partIndex) => partToMessages(entry, part, partIndex)),
        ),
    );
