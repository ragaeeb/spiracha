import type {
    ConversationDeepLinks,
    ConversationMessage,
    ConversationMessagePhase,
    ConversationMessageRole,
    ConversationSource,
    ConversationToolEvidence,
    ListConversationsForPathOptions,
} from './types';

export const isWithinUpdatedWindow = (
    updatedAtMs: number | null | undefined,
    options: Pick<ListConversationsForPathOptions, 'updatedAfterMs' | 'updatedBeforeMs'>,
) => {
    const comparableUpdatedAtMs = updatedAtMs ?? 0;
    if (options.updatedAfterMs !== undefined && comparableUpdatedAtMs < options.updatedAfterMs) {
        return false;
    }
    if (options.updatedBeforeMs !== undefined && comparableUpdatedAtMs > options.updatedBeforeMs) {
        return false;
    }
    return true;
};

export const toDateMs = (value: string | number | null | undefined): number | null => {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    if (!value) {
        return null;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
};

export const decodeFileUri = (value: string | null | undefined): string | null => {
    if (!value) {
        return null;
    }

    if (!value.startsWith('file://')) {
        return value;
    }

    try {
        const url = new URL(value);
        const pathname = decodeURIComponent(url.pathname);
        if (url.hostname) {
            return `//${url.hostname}${pathname}`;
        }
        return pathname.replace(/^\/([A-Za-z]:)/u, '$1');
    } catch {
        const rawPathValue = value.slice('file://'.length);
        try {
            return decodeURIComponent(rawPathValue).replace(/^\/([A-Za-z]:)/u, '$1');
        } catch {
            return rawPathValue.replace(/^\/([A-Za-z]:)/u, '$1');
        }
    }
};

export const createDeepLinks = (
    source: ConversationSource,
    id: string,
    uiPath: string,
    native: string | null = null,
): ConversationDeepLinks => ({
    native,
    spiracha: `spiracha://conversation/${source}/${encodeURIComponent(id)}`,
    ui: uiPath,
});

export const createConversationUiPath = (routeSegment: string, id: string) =>
    `/${routeSegment}/${encodeURIComponent(id)}`;

export const normalizeRole = (role: string | null | undefined): ConversationMessageRole => {
    if (role === 'assistant' || role === 'system' || role === 'tool' || role === 'user') {
        return role;
    }

    return 'unknown';
};

export const normalizeAssistantPhase = (
    phase: string | null | undefined,
    fallback: ConversationMessagePhase = 'final_answer',
): ConversationMessagePhase => {
    if (phase === 'final_answer' || phase === 'final') {
        return 'final_answer';
    }

    if (phase === 'commentary') {
        return 'commentary';
    }

    return fallback;
};

export const createTextMessage = (input: {
    createdAtMs: number | null;
    id: string;
    metadata?: Record<string, unknown>;
    order: number;
    phase: ConversationMessagePhase;
    role: ConversationMessageRole;
    text: string | null | undefined;
    toolEvidence?: ConversationToolEvidence | null;
}): ConversationMessage[] => {
    const text = input.text?.trim();
    if (!text) {
        return [];
    }

    return [
        {
            createdAtMs: input.createdAtMs,
            id: input.id,
            metadata: input.metadata ?? {},
            order: input.order,
            phase: input.phase,
            role: input.role,
            text,
            toolEvidence: input.toolEvidence ?? null,
        },
    ];
};

export const normalizeToolStatus = (
    status: string | null | undefined,
    exitCode: number | null = null,
    isError = false,
): ConversationToolEvidence['status'] => {
    if (isError || (exitCode !== null && exitCode !== 0)) {
        return 'failed';
    }
    if (exitCode === 0) {
        return 'succeeded';
    }
    const normalized = status?.toLowerCase();
    if (normalized && /(?:fail|error|reject|cancel)/u.test(normalized)) {
        return 'failed';
    }
    if (normalized && /(?:success|complete|done|finish)/u.test(normalized)) {
        return 'succeeded';
    }
    return 'unknown';
};

export const durationTextToMs = (value: string | null | undefined): number | null => {
    if (!value) {
        return null;
    }
    const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s)$/iu);
    if (!match) {
        return null;
    }
    const amount = Number(match[1]);
    return Number.isFinite(amount) ? Math.round(amount * (match[2]?.toLowerCase() === 's' ? 1000 : 1)) : null;
};

export const getToolNamespace = (name: string): string | null => {
    return name.includes('.') ? (name.split('.')[0] ?? null) : null;
};

export const finalizeMessages = (messages: ConversationMessage[]) => {
    return messages.map((message, index) => ({
        ...message,
        order: index,
    }));
};
