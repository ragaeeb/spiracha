import { SOURCE_CATALOG } from './source-catalog';
import type {
    ContentState,
    ConversationDeepLinks,
    ConversationDetail,
    ConversationMessage,
    ConversationMessagePhase,
    ConversationMessageRole,
    ConversationMessageSelector,
    ConversationMessageVisibility,
    ConversationSource,
    ConversationToolEvidence,
    ListConversationsOptions,
    MessageProvenance,
} from './types';

export const isWithinUpdatedWindow = (
    updatedAtMs: number | null | undefined,
    options: Pick<ListConversationsOptions, 'updatedAfterMs' | 'updatedBeforeMs'>,
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

export const createConversationUiPath = (source: ConversationSource, id: string) =>
    `/${SOURCE_CATALOG[source].detailRouteSegment}/${encodeURIComponent(id)}`;

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

export const AVAILABLE_FULL_CONTENT = {
    representation: 'full',
    state: 'available',
} as const satisfies ContentState;

export type CanonicalInclusionBucket =
    | 'assistant_commentary'
    | 'assistant_final'
    | 'reasoning'
    | 'system'
    | 'tool_call'
    | 'tool_output'
    | 'unknown'
    | 'user';

export const classifyCanonicalInclusionBucket = (message: {
    phase: ConversationMessagePhase;
    role: ConversationMessageRole;
}): CanonicalInclusionBucket => {
    if (message.phase === 'tool_call') {
        return 'tool_call';
    }
    if (message.phase === 'tool_output') {
        return 'tool_output';
    }
    if (message.phase === 'reasoning') {
        return 'reasoning';
    }
    if (message.role === 'assistant' && message.phase === 'final_answer') {
        return 'assistant_final';
    }
    if (message.role === 'assistant' && message.phase === 'commentary') {
        return 'assistant_commentary';
    }
    if (message.role === 'user') {
        return 'user';
    }
    if (message.role === 'system') {
        return 'system';
    }
    return 'unknown';
};

export type CanonicalRolePhaseIssue =
    | 'assistant_prose_phase_requires_assistant_role'
    | 'reasoning_phase_requires_assistant_role'
    | 'tool_phase_requires_tool_role';

export const canonicalRolePhaseIssues = (message: {
    phase: ConversationMessagePhase;
    role: ConversationMessageRole;
}): CanonicalRolePhaseIssue[] => {
    if (message.phase === 'tool_call' || message.phase === 'tool_output') {
        return message.role === 'tool' ? [] : ['tool_phase_requires_tool_role'];
    }
    if (message.phase === 'reasoning') {
        return message.role === 'assistant' ? [] : ['reasoning_phase_requires_assistant_role'];
    }
    if (message.phase === 'final_answer' || message.phase === 'commentary') {
        return message.role === 'assistant' ? [] : ['assistant_prose_phase_requires_assistant_role'];
    }
    return [];
};

const nativeProvenance = (id: string, sourceConversationId: string): MessageProvenance => ({
    blockIndex: null,
    branchId: null,
    origin: 'native',
    parentMessageId: null,
    sourceConversationId,
    sourceRecordId: id,
});

export const observedToolFieldState = (value: string | null | undefined): ContentState | null =>
    value == null ? null : AVAILABLE_FULL_CONTENT;

export type ConversationToolEvidenceDraft = Omit<
    ConversationToolEvidence,
    'inputContentState' | 'outputContentState'
> & {
    inputContentState?: ContentState | null;
    outputContentState?: ContentState | null;
};

export const toCanonicalToolEvidence = (
    tool: ConversationToolEvidenceDraft | null | undefined,
): ConversationToolEvidence | null => {
    if (!tool) {
        return null;
    }
    return {
        ...tool,
        inputContentState: tool.inputContentState ?? observedToolFieldState(tool.inputText),
        outputContentState: tool.outputContentState ?? observedToolFieldState(tool.outputText),
    };
};

export const conversationReadFields = (options: {
    includeMessages: boolean;
    messageSelector?: ConversationMessageSelector | null;
}): Pick<ConversationDetail, 'bodyAvailability'> => {
    if (!options.includeMessages) {
        return {};
    }
    return {
        bodyAvailability: (options.messageSelector ?? 'last_final_answer') === 'all' ? 'full' : 'selected',
    };
};

export const createTextMessage = (input: {
    contentState?: ContentState;
    createdAtMs: number | null;
    id: string;
    model?: string;
    metadata?: Record<string, unknown>;
    order: number;
    phase: ConversationMessagePhase;
    provenance?: MessageProvenance;
    role: ConversationMessageRole;
    sourceConversationId?: string;
    text: string | null | undefined;
    toolEvidence?: ConversationToolEvidenceDraft | null;
    visibility?: ConversationMessageVisibility;
}): ConversationMessage[] => {
    const text = input.text ?? '';
    if (!text && !input.toolEvidence) {
        return [];
    }

    return [
        {
            contentState: input.contentState ?? AVAILABLE_FULL_CONTENT,
            createdAtMs: input.createdAtMs,
            id: input.id,
            ...(input.model ? { model: input.model } : {}),
            metadata: input.metadata ?? {},
            order: input.order,
            phase: input.phase,
            provenance: input.provenance ?? nativeProvenance(input.id, input.sourceConversationId ?? ''),
            role: input.role,
            text: input.text ?? '',
            toolEvidence: toCanonicalToolEvidence(input.toolEvidence),
            visibility: input.visibility ?? 'normal',
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
    const delimiterIndex = name.indexOf('.');
    return delimiterIndex >= 0 ? name.substring(0, delimiterIndex) : null;
};

export type CanonicalMessageDraft = Omit<
    ConversationMessage,
    'contentState' | 'provenance' | 'toolEvidence' | 'visibility'
> & {
    contentState?: ContentState;
    provenance?: MessageProvenance;
    toolEvidence?: ConversationToolEvidenceDraft | null;
    visibility?: ConversationMessageVisibility;
};

export const toCanonicalMessage = (message: CanonicalMessageDraft): ConversationMessage => ({
    ...message,
    contentState: message.contentState ?? AVAILABLE_FULL_CONTENT,
    provenance: message.provenance ?? nativeProvenance(message.id, ''),
    toolEvidence: toCanonicalToolEvidence(message.toolEvidence),
    visibility: message.visibility ?? 'normal',
});

export const finalizeMessages = (messages: CanonicalMessageDraft[]) => {
    return messages.map((message, index) => ({
        ...toCanonicalMessage(message),
        order: index,
    }));
};
