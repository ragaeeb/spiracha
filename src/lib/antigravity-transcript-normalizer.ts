import { getAntigravityAssistantPhase, getFinalAntigravityAssistantSequences } from './antigravity-transcript-phase';

export type AntigravityConversationMessage = {
    createdAtMs: number | null;
    metadata: Record<string, unknown>;
    order: number;
    phase: 'commentary' | 'final_answer' | 'reasoning' | 'tool_call' | 'tool_output' | 'unknown';
    role: 'assistant' | 'system' | 'tool' | 'unknown' | 'user';
    text: string;
};

export type AntigravityLogEntry = {
    command?: unknown;
    content?: unknown;
    created_at?: unknown;
    exit_code?: unknown;
    model?: unknown;
    source?: unknown;
    status?: unknown;
    step_index?: unknown;
    thinking?: unknown;
    tool_call_id?: unknown;
    tool_calls?: unknown;
    tool_name?: unknown;
    type?: unknown;
    workdir?: unknown;
};

export const getString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const stripTaggedBlock = (content: string, tag: string): string => {
    return content.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'gu'), '').trim();
};

const extractTaggedBlock = (content: string, tag: string): string | null => {
    const match = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, 'u').exec(content);
    return match?.[1]?.trim() || null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export const cleanLogContent = (entry: AntigravityLogEntry): string => {
    const content = getString(entry.content);
    if (!content) {
        return '';
    }

    const userRequest = extractTaggedBlock(content, 'USER_REQUEST');
    if (userRequest) {
        return userRequest;
    }

    return ['ADDITIONAL_METADATA', 'USER_SETTINGS_CHANGE']
        .reduce((current, tag) => stripTaggedBlock(current, tag), content)
        .replace(/<\/?USER_REQUEST>/gu, '')
        .trim();
};

export const logEntryCreatedAtMs = (entry: AntigravityLogEntry): number | null => {
    const timestamp = getString(entry.created_at);
    if (!timestamp) {
        return null;
    }

    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : null;
};

export const logEntryOrder = (entry: AntigravityLogEntry, fallback: number): number => {
    return typeof entry.step_index === 'number' && Number.isFinite(entry.step_index) ? entry.step_index : fallback;
};

const isAssistantLogEntry = (entry: AntigravityLogEntry): boolean => {
    return getString(entry.source) === 'MODEL' && getString(entry.type) === 'PLANNER_RESPONSE';
};

export const logEntryRole = (entry: AntigravityLogEntry): AntigravityConversationMessage['role'] => {
    const source = getString(entry.source);
    if (source?.startsWith('USER')) {
        return 'user';
    }
    if (isAssistantLogEntry(entry)) {
        return 'assistant';
    }
    if (source === 'SYSTEM') {
        return 'system';
    }
    if (source === 'MODEL') {
        return 'tool';
    }
    return 'unknown';
};

const logEntryPhase = (
    entry: AntigravityLogEntry,
    sequence: number,
    finalAssistantSequences: Set<number>,
): AntigravityConversationMessage['phase'] => {
    const role = logEntryRole(entry);
    if (role === 'assistant') {
        return getAntigravityAssistantPhase(sequence, finalAssistantSequences);
    }
    if (role === 'tool') {
        return 'tool_output';
    }
    return 'unknown';
};

const logEntryMetadata = (entry: AntigravityLogEntry): Record<string, unknown> => ({
    command: getString(entry.command),
    exitCode: typeof entry.exit_code === 'number' ? entry.exit_code : null,
    model: getString(entry.model),
    source: getString(entry.source),
    status: getString(entry.status),
    toolCallId: getString(entry.tool_call_id),
    toolName: getString(entry.tool_name),
    type: getString(entry.type),
    workdir: getString(entry.workdir),
});

const toolCallsText = (toolCalls: unknown): string => {
    if (!Array.isArray(toolCalls)) {
        return '';
    }

    return toolCalls
        .flatMap((call) => {
            if (!isRecord(call)) {
                return [];
            }
            return [
                JSON.stringify({
                    args: call.args,
                    id: typeof call.id === 'string' ? call.id : null,
                    name: typeof call.name === 'string' ? call.name : 'unknown',
                }),
            ];
        })
        .join('\n');
};

export const getAntigravityPhaseItems = (entries: AntigravityLogEntry[]) => {
    return entries.map((entry, sequence) => {
        const role = logEntryRole(entry);
        return {
            hasContent: Boolean(cleanLogContent(entry)),
            hasToolCalls: Array.isArray(entry.tool_calls) && entry.tool_calls.length > 0,
            role: role === 'assistant' || role === 'user' ? role : ('other' as const),
            sequence,
        };
    });
};

const logEntryToMessages = (
    entry: AntigravityLogEntry,
    index: number,
    finalAssistantSequences: Set<number>,
): AntigravityConversationMessage[] => {
    const order = logEntryOrder(entry, index);
    const createdAtMs = logEntryCreatedAtMs(entry);
    const role = logEntryRole(entry);
    const phase = logEntryPhase(entry, index, finalAssistantSequences);
    const metadata = logEntryMetadata(entry);
    const messages: AntigravityConversationMessage[] = [];
    const thinking = getString(entry.thinking)?.trim();
    if (thinking && role === 'assistant') {
        messages.push({
            createdAtMs,
            metadata,
            order,
            phase: 'reasoning',
            role: 'assistant',
            text: thinking,
        });
    }

    const content = cleanLogContent(entry);
    if (content) {
        messages.push({
            createdAtMs,
            metadata,
            order,
            phase,
            role,
            text: content,
        });
    }

    const calls = toolCallsText(entry.tool_calls);
    if (calls) {
        messages.push({
            createdAtMs,
            metadata,
            order,
            phase: 'tool_call',
            role: 'tool',
            text: calls,
        });
    }

    return messages;
};

export const normalizeAntigravityLogEntries = (entries: AntigravityLogEntry[]): AntigravityConversationMessage[] => {
    const finalAssistantSequences = getFinalAntigravityAssistantSequences(getAntigravityPhaseItems(entries));
    return entries.flatMap((entry, index) => logEntryToMessages(entry, index, finalAssistantSequences));
};
