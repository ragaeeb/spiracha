import type {
    ConversationDeepLinks,
    ConversationMessage,
    ConversationMessagePhase,
    ConversationMessageRole,
    ConversationSource,
} from './types';

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
        const pathValue = decodeURIComponent(value.slice('file://'.length));
        return pathValue.replace(/^\/([A-Za-z]:)/u, '$1');
    }
};

export const createDeepLinks = (
    source: ConversationSource,
    id: string,
    uiPath: string,
    native: string | null = null,
): ConversationDeepLinks => ({
    native,
    spiracha: `spiracha://conversation/${source}/${id}`,
    ui: uiPath,
});

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
        },
    ];
};

export const finalizeMessages = (messages: ConversationMessage[]) => {
    return messages.map((message, index) => ({
        ...message,
        order: index,
    }));
};
