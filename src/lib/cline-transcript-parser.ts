import type { ClineTaskTranscript, ClineToolEvidence, ClineTranscriptMessage } from './cline-exporter-types';
import type { ConversationMessage } from './conversation-data/types';
import { asNumber, asObject, asString, type JsonValue } from './shared-text';

const timestampFromJson = (value: JsonValue | null): number | null => {
    const numeric = asNumber(value);
    if (numeric !== null) {
        return numeric;
    }
    const text = asString(value);
    if (!text) {
        return null;
    }
    const timestamp = Date.parse(text);
    return Number.isNaN(timestamp) ? null : timestamp;
};

const textFromClineValue = (value: JsonValue | null): string => {
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        return value
            .map((item) => textFromClineValue(item))
            .filter(Boolean)
            .join('\n');
    }
    const raw = asObject(value);
    if (!raw) {
        return value === null ? '' : JSON.stringify(value);
    }
    for (const key of ['text', 'thinking', 'result', 'error']) {
        const text = asString(raw[key] ?? null);
        if (text !== null) {
            return text;
        }
    }
    if (raw.content !== undefined) {
        return textFromClineValue(raw.content);
    }
    return Object.entries(raw)
        .map(([key, item]) => `${key}: ${textFromClineValue(item)}`)
        .join('\n');
};

const valueAsText = (value: JsonValue | null): string | null => {
    if (value === null) {
        return null;
    }
    if (typeof value === 'string') {
        return value;
    }
    return JSON.stringify(value);
};

type ClineStoredMessage = {
    content: JsonValue[];
    id: string | null;
    role: string | null;
    ts: number | null;
};

const parseStoredMessage = (value: JsonValue): ClineStoredMessage | null => {
    const raw = asObject(value);
    if (!raw || !Array.isArray(raw.content)) {
        return null;
    }
    return {
        content: raw.content,
        id: asString(raw.id ?? null),
        role: asString(raw.role ?? null),
        ts: timestampFromJson(raw.ts ?? null),
    };
};

const rawPart = (part: Record<string, JsonValue>, message: ClineStoredMessage): Record<string, JsonValue> => ({
    ...part,
    messageId: message.id,
    messageRole: message.role,
});

type ClineMessageFields = Omit<ClineTranscriptMessage, 'createdAtMs' | 'messageId' | 'raw'>;

const roleForStoredMessage = (role: string | null): ClineTranscriptMessage['role'] => {
    if (role === 'assistant') {
        return 'assistant';
    }
    if (role === 'user') {
        return 'user';
    }
    return 'unknown';
};

const parseThinkingPart = (part: Record<string, JsonValue>): ClineMessageFields => ({
    phase: 'reasoning',
    role: 'assistant',
    text: textFromClineValue(part.thinking ?? part.text ?? null),
    tool: null,
});

const parseTextPart = (part: Record<string, JsonValue>, message: ClineStoredMessage): ClineMessageFields => {
    const role = roleForStoredMessage(message.role);
    return {
        phase: role === 'assistant' ? 'commentary' : 'unknown',
        role,
        text: textFromClineValue(part.text ?? null),
        tool: null,
    };
};

const parseToolUsePart = (
    part: Record<string, JsonValue>,
    message: ClineStoredMessage,
    worktree: string,
): ClineMessageFields => {
    const callId = asString(part.id ?? null) || `cline-tool-${message.id ?? 'unknown'}`;
    const inputText = valueAsText(part.input ?? null);
    const name = asString(part.name ?? null)?.trim() || 'unknown';
    return {
        phase: 'tool_call',
        role: 'assistant',
        text: [name, inputText].filter(Boolean).join(': '),
        tool: {
            callId,
            command: null,
            inputText,
            name,
            outputText: null,
            raw: rawPart(part, message),
            status: 'unknown',
            workdir: worktree,
        },
    };
};

const parseToolResultPart = (
    part: Record<string, JsonValue>,
    message: ClineStoredMessage,
    worktree: string,
): ClineMessageFields => {
    const callId = asString(part.tool_use_id ?? null) || `cline-tool-result-${message.id ?? 'unknown'}`;
    const outputText = textFromClineValue(part.content ?? part.result ?? null);
    const tool: ClineToolEvidence = {
        callId,
        command: null,
        inputText: null,
        name: asString(part.name ?? null)?.trim() || 'unknown',
        outputText: outputText || null,
        raw: rawPart(part, message),
        status: part.is_error === true ? 'failed' : 'succeeded',
        workdir: worktree,
    };
    return {
        phase: 'tool_output',
        role: 'tool',
        text: outputText,
        tool,
    };
};

const parseStoredPart = (
    part: Record<string, JsonValue>,
    message: ClineStoredMessage,
    worktree: string,
): ClineMessageFields | null => {
    switch (asString(part.type ?? null)) {
        case 'thinking':
            return parseThinkingPart(part);
        case 'text':
            return parseTextPart(part, message);
        case 'tool_use':
            return parseToolUsePart(part, message, worktree);
        case 'tool_result':
            return parseToolResultPart(part, message, worktree);
        default:
            return null;
    }
};

export const parseClineSessionMessages = (
    value: JsonValue,
    worktree: string,
    sessionId: string,
    includeRawPayloads: boolean,
): ClineTranscriptMessage[] => {
    const envelope = asObject(value);
    if (!Array.isArray(envelope?.messages)) {
        return [];
    }
    const messages: ClineTranscriptMessage[] = [];
    envelope.messages.forEach((value, messageIndex) => {
        const message = parseStoredMessage(value);
        if (!message) {
            return;
        }
        message.content.forEach((partValue, partIndex) => {
            const part = asObject(partValue);
            if (!part) {
                return;
            }
            const fields = parseStoredPart(part, message, worktree);
            if (!fields?.text) {
                return;
            }
            messages.push({
                createdAtMs: message.ts,
                messageId: `cline-${sessionId}-${message.id ?? messageIndex}-${partIndex}`,
                raw: includeRawPayloads ? rawPart(part, message) : {},
                ...fields,
            });
        });
    });
    const finalAnswerIndex = [...messages]
        .map((message, index) => ({ index, message }))
        .reverse()
        .find(({ message }) => message.role === 'assistant' && message.phase === 'commentary')?.index;
    if (finalAnswerIndex !== undefined) {
        messages[finalAnswerIndex] = { ...messages[finalAnswerIndex]!, phase: 'final_answer' };
    }
    return messages;
};

export const normalizeClineTranscriptMessages = (messages: ClineTaskTranscript['messages']): ConversationMessage[] =>
    messages.map((message, order) => ({
        createdAtMs: message.createdAtMs,
        id: message.messageId,
        metadata: {},
        order,
        phase: message.phase,
        role: message.role,
        text: message.text,
        toolEvidence: message.tool
            ? {
                  callId: message.tool.callId,
                  command: message.tool.command,
                  durationMs: null,
                  exitCode: null,
                  inputText: message.tool.inputText,
                  name: message.tool.name,
                  namespace: null,
                  outputText: message.tool.outputText,
                  status: message.tool.status,
                  workdir: message.tool.workdir,
              }
            : null,
    }));

export { timestampFromJson };
