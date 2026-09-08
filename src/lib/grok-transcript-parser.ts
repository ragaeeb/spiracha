import {
    createTextMessage,
    finalizeMessages,
    getToolNamespace,
    normalizeAssistantPhase,
    normalizeRole,
    normalizeToolStatus,
} from './conversation-data/adapter-helpers';
import type { ConversationMessage } from './conversation-data/types';
import type { GrokTranscriptEntry, GrokTranscriptPart } from './grok-exporter-types';
import { getFinalGrokAssistantTextPartIds, getGrokTextPartPhase } from './grok-transcript-phase';
import { asObject, asString, type JsonValue } from './shared-text';

const formatJsonLike = (value: JsonValue | undefined): string | null => {
    if (value === undefined || value === null) {
        return null;
    }

    if (typeof value === 'string') {
        return value;
    }

    return JSON.stringify(value, null, 2);
};

const textFromContentValue = (value: JsonValue | undefined): string => {
    if (typeof value === 'string') {
        return value;
    }

    if (Array.isArray(value)) {
        return value
            .map((item) => {
                if (typeof item === 'string') {
                    return item;
                }

                const object = asObject(item);
                if (!object) {
                    return '';
                }

                return (
                    asString(object.text ?? null) ??
                    asString(object.content ?? null) ??
                    textFromContentValue(object.content) ??
                    ''
                );
            })
            .filter(Boolean)
            .join('\n\n');
    }

    const object = asObject(value ?? null);
    return object ? (asString(object.text ?? null) ?? asString(object.content ?? null) ?? '') : '';
};

const unwrapGrokTextEnvelope = (text: string): string => {
    const trimmed = text.trim();
    const userQuery = trimmed.match(/^<user_query>\s*([\s\S]*?)\s*<\/user_query>$/u);
    return userQuery?.[1]?.trim() ?? trimmed;
};

const isGrokSystemContextEnvelope = (text: string): boolean => {
    const trimmed = text.trimStart();
    return (
        trimmed.startsWith('<user_info>') ||
        trimmed.startsWith('<summary_request>') ||
        trimmed.startsWith('<system-reminder>')
    );
};

const getReasoningText = (raw: Record<string, JsonValue>): string => {
    const summary = Array.isArray(raw.summary) ? raw.summary : [];
    const summaryText = summary
        .map((item) => {
            const object = asObject(item);
            return asString(object?.summary_text ?? null) ?? asString(object?.text ?? null) ?? '';
        })
        .filter(Boolean)
        .join('\n\n');

    return summaryText || asString(raw.content ?? null) || '';
};

const parseToolCallPart = (
    raw: Record<string, JsonValue>,
    entryId: string,
    index: number,
    includeRawPayloads: boolean,
): GrokTranscriptPart | null => {
    const toolName = asString(raw.name ?? null) ?? 'unknown';
    const argumentsText = formatJsonLike(raw.arguments);
    return {
        argumentsText,
        partId: `${entryId}:tool-call:${index}`,
        raw: includeRawPayloads ? raw : {},
        toolCallId: asString(raw.id ?? null),
        toolName,
        type: 'tool_call',
    };
};

const parseAssistantParts = (
    raw: Record<string, JsonValue>,
    entryId: string,
    includeRawPayloads: boolean,
): GrokTranscriptPart[] => {
    const parts: GrokTranscriptPart[] = [];
    const text = textFromContentValue(raw.content);
    if (text.trim()) {
        parts.push({
            partId: `${entryId}:text`,
            raw: includeRawPayloads ? { content: text } : {},
            text,
            type: 'text',
        });
    }

    const toolCalls = Array.isArray(raw.tool_calls) ? raw.tool_calls : [];
    toolCalls.forEach((item, index) => {
        const object = asObject(item);
        const part = object ? parseToolCallPart(object, entryId, index, includeRawPayloads) : null;
        if (part) {
            parts.push(part);
        }
    });

    return parts;
};

const parseTextEntryPart = (
    raw: Record<string, JsonValue>,
    entryId: string,
    includeRawPayloads: boolean,
): GrokTranscriptPart[] => {
    const text = unwrapGrokTextEnvelope(textFromContentValue(raw.content));
    return text
        ? [
              {
                  partId: `${entryId}:text`,
                  raw: includeRawPayloads ? raw : {},
                  text,
                  type: 'text',
              },
          ]
        : [];
};

const parseReasoningParts = (
    raw: Record<string, JsonValue>,
    entryId: string,
    includeRawPayloads: boolean,
): GrokTranscriptPart[] => {
    const text = getReasoningText(raw).trim();
    return text
        ? [
              {
                  partId: `${entryId}:reasoning`,
                  raw: includeRawPayloads ? raw : {},
                  text,
                  type: 'reasoning',
              },
          ]
        : [];
};

const parseToolResultParts = (
    raw: Record<string, JsonValue>,
    entryId: string,
    includeRawPayloads: boolean,
): GrokTranscriptPart[] => {
    const outputText = textFromContentValue(raw.content).trim();
    return outputText
        ? [
              {
                  outputText,
                  partId: `${entryId}:tool-result`,
                  raw: includeRawPayloads ? raw : {},
                  toolCallId: asString(raw.tool_call_id ?? null),
                  type: 'tool_result',
              },
          ]
        : [];
};

const getEntryRole = (type: string): string => {
    if (type === 'system' || type === 'user' || type === 'assistant') {
        return type;
    }

    if (type === 'reasoning') {
        return 'assistant';
    }

    if (type === 'tool_result') {
        return 'tool';
    }

    return 'unknown';
};

const getTranscriptEntryRole = (type: string, parts: GrokTranscriptPart[]): string => {
    if (type === 'user' && parts.some((part) => part.type === 'text' && isGrokSystemContextEnvelope(part.text ?? ''))) {
        return 'system';
    }

    return getEntryRole(type);
};

export const parseGrokTranscriptEntry = (
    raw: Record<string, JsonValue>,
    sessionId: string,
    index: number,
    includeRawPayloads: boolean,
): GrokTranscriptEntry | null => {
    const type = asString(raw.type ?? null) ?? 'unknown';
    const entryId = asString(raw.id ?? null) ?? `${sessionId}:${index}`;
    const parts =
        type === 'assistant'
            ? parseAssistantParts(raw, entryId, includeRawPayloads)
            : type === 'reasoning'
              ? parseReasoningParts(raw, entryId, includeRawPayloads)
              : type === 'tool_result'
                ? parseToolResultParts(raw, entryId, includeRawPayloads)
                : parseTextEntryPart(raw, entryId, includeRawPayloads);

    if (parts.length === 0) {
        return null;
    }

    return {
        createdAtMs: null,
        entryId,
        modelFingerprint: asString(raw.model_fingerprint ?? null),
        modelId: asString(raw.model_id ?? null),
        parts,
        raw: includeRawPayloads ? raw : {},
        role: getTranscriptEntryRole(type, parts),
        timestamp: null,
        type,
    };
};

const partToMessages = (
    entry: GrokTranscriptEntry,
    part: GrokTranscriptPart,
    finalTextPartIds: Set<string>,
    order: number,
): ConversationMessage[] => {
    if (part.type === 'text') {
        return createTextMessage({
            createdAtMs: entry.createdAtMs,
            id: part.partId,
            model: entry.modelId ?? undefined,
            order,
            phase: normalizeAssistantPhase(getGrokTextPartPhase(entry, part, finalTextPartIds), 'unknown'),
            role: normalizeRole(entry.role),
            text: part.text,
        });
    }

    if (part.type === 'reasoning') {
        return createTextMessage({
            createdAtMs: entry.createdAtMs,
            id: part.partId,
            order,
            phase: 'reasoning',
            role: 'assistant',
            text: part.text,
        });
    }

    if (part.type === 'tool_call') {
        return createTextMessage({
            createdAtMs: entry.createdAtMs,
            id: part.partId,
            metadata: { toolCallId: part.toolCallId, toolName: part.toolName },
            order,
            phase: 'tool_call',
            role: 'tool',
            text: [part.toolName, part.argumentsText].filter(Boolean).join('\n'),
            toolEvidence: {
                callId: part.toolCallId ?? null,
                command: null,
                durationMs: null,
                exitCode: null,
                inputText: part.argumentsText ?? null,
                name: part.toolName ?? 'unknown',
                namespace: getToolNamespace(part.toolName ?? 'unknown'),
                outputText: null,
                status: 'unknown',
                workdir: null,
            },
        });
    }

    if (part.type === 'tool_result') {
        return createTextMessage({
            createdAtMs: entry.createdAtMs,
            id: part.partId,
            metadata: { toolCallId: part.toolCallId },
            order,
            phase: 'tool_output',
            role: 'tool',
            text: part.outputText,
            toolEvidence: {
                callId: part.toolCallId ?? null,
                command: null,
                durationMs: null,
                exitCode: null,
                inputText: null,
                name: part.toolName ?? 'unknown',
                namespace: getToolNamespace(part.toolName ?? 'unknown'),
                outputText: part.outputText ?? null,
                status: normalizeToolStatus(null),
                workdir: null,
            },
        });
    }

    return [];
};

export const normalizeGrokTranscriptEntries = (entries: GrokTranscriptEntry[]): ConversationMessage[] => {
    const finalTextPartIds = getFinalGrokAssistantTextPartIds(entries);
    return finalizeMessages(
        entries.flatMap((entry, entryIndex) =>
            entry.parts.flatMap((part, partIndex) =>
                partToMessages(entry, part, finalTextPartIds, entryIndex + partIndex),
            ),
        ),
    );
};
