import type { OpenCodeTranscriptPart } from '../opencode-exporter-types';
import { splitOpenCodeThinkTaggedText } from '../opencode-think-tags';
import { getFinalOpenCodeAssistantTextPartIds, getOpenCodeTextPartPhase } from '../opencode-transcript-phase';
import {
    createTextMessage,
    finalizeMessages,
    normalizeAssistantPhase,
    normalizeRole,
    normalizeToolStatus,
} from './adapter-helpers';
import type { ConversationMessage } from './types';

const textPartToMessages = (
    part: OpenCodeTranscriptPart,
    finalTextPartIds: Set<string>,
    order: number,
): ConversationMessage[] => {
    const split =
        part.role === 'assistant'
            ? splitOpenCodeThinkTaggedText(part.text ?? '')
            : { reasoningBlocks: [], visibleText: part.text ?? '' };
    return [
        ...createTextMessage({
            createdAtMs: part.createdAtMs,
            id: `${part.partId}:reasoning`,
            order,
            phase: 'reasoning',
            role: 'assistant',
            text: split.reasoningBlocks.join('\n\n'),
        }),
        ...createTextMessage({
            createdAtMs: part.createdAtMs,
            id: part.partId,
            order,
            phase: normalizeAssistantPhase(getOpenCodeTextPartPhase(part, finalTextPartIds), 'unknown'),
            role: normalizeRole(part.role),
            text: split.visibleText,
        }),
    ];
};

const partToMessages = (
    part: OpenCodeTranscriptPart,
    finalTextPartIds: Set<string>,
    order: number,
): ConversationMessage[] => {
    if (part.type === 'text') {
        return textPartToMessages(part, finalTextPartIds, order);
    }

    if (part.type === 'reasoning') {
        return createTextMessage({
            createdAtMs: part.createdAtMs,
            id: part.partId,
            order,
            phase: 'reasoning',
            role: 'assistant',
            text: part.text,
        });
    }

    if (part.type === 'tool') {
        const metadata = { callId: part.callId, status: part.status, toolName: part.toolName };
        const toolName = part.toolName ?? 'unknown';
        const namespace = toolName.includes('.') ? (toolName.split('.')[0] ?? null) : null;
        const durationMs =
            part.startTimeMs !== null &&
            part.startTimeMs !== undefined &&
            part.endTimeMs !== null &&
            part.endTimeMs !== undefined
                ? Math.max(0, part.endTimeMs - part.startTimeMs)
                : null;
        return [
            ...createTextMessage({
                createdAtMs: part.createdAtMs,
                id: `${part.partId}:tool_call`,
                metadata,
                order,
                phase: 'tool_call',
                role: 'tool',
                text: [part.toolName, part.argumentsText ?? part.title].filter(Boolean).join('\n'),
                toolEvidence: {
                    callId: part.callId ?? null,
                    command: null,
                    durationMs,
                    exitCode: null,
                    inputText: part.argumentsText ?? part.title ?? null,
                    name: toolName,
                    namespace,
                    outputText: null,
                    status: normalizeToolStatus(part.status),
                    workdir: null,
                },
            }),
            ...createTextMessage({
                createdAtMs: part.createdAtMs,
                id: `${part.partId}:tool_output`,
                metadata,
                order,
                phase: 'tool_output',
                role: 'tool',
                text: part.outputText,
                toolEvidence: {
                    callId: part.callId ?? null,
                    command: null,
                    durationMs,
                    exitCode: null,
                    inputText: null,
                    name: toolName,
                    namespace,
                    outputText: part.outputText ?? null,
                    status: normalizeToolStatus(part.status),
                    workdir: null,
                },
            }),
        ];
    }

    return [];
};

export const openCodePartsToMessages = (parts: OpenCodeTranscriptPart[]) => {
    const finalTextPartIds = getFinalOpenCodeAssistantTextPartIds(parts);
    return finalizeMessages(parts.flatMap((part, order) => partToMessages(part, finalTextPartIds, order)));
};
