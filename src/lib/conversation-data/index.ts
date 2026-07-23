import { mapWithConcurrency } from '../concurrency';
import { antigravityConversationAdapter } from './antigravity-adapter';
import { claudeCodeConversationAdapter } from './claude-code-adapter';
import { codexConversationAdapter } from './codex-adapter';
import { cursorConversationAdapter } from './cursor-adapter';
import { grokConversationAdapter } from './grok-adapter';
import { kiroConversationAdapter } from './kiro-adapter';
import { selectConversationMessages } from './message-selector';
import { minimaxCodeConversationAdapter } from './minimax-code-adapter';
import { opencodeConversationAdapter } from './opencode-adapter';
import { decodeConversationCursor, paginateConversations } from './pagination';
import { qoderConversationAdapter } from './qoder-adapter';
import {
    CONVERSATION_SOURCES,
    type ConversationAdapter,
    type ConversationMessage,
    type ConversationMessageSelector,
    type ConversationPage,
    type ConversationSource,
    type ConversationSourceInfo,
    type DeleteConversationItemResult,
    type DeleteConversationOptions,
    type DeleteConversationResult,
    type DeleteConversationsOptions,
    type DeleteConversationsResult,
    type GetConversationOptions,
    type ListConversationsForPathOptions,
    type ResolvedConversationRef,
} from './types';

export { selectConversationMessages } from './message-selector';
export { getConversationPathMatch, normalizeConversationPath } from './path-match';
export {
    CONVERSATION_SOURCES,
    type ConversationAdapter,
    type ConversationDataLocations,
    type ConversationDeepLinks,
    type ConversationDetail,
    type ConversationEvidenceEvent,
    type ConversationEvidenceExport,
    type ConversationEvidencePairingConfidence,
    type ConversationIdSetOptions,
    type ConversationMessage,
    type ConversationMessagePhase,
    type ConversationMessageRole,
    type ConversationMessageSelector,
    type ConversationPage,
    type ConversationPathMatch,
    type ConversationSource,
    type ConversationSourceInfo,
    type ConversationToolEvidence,
    type ConversationZipDownload,
    type DeleteConversationItemResult,
    type DeleteConversationOptions,
    type DeleteConversationResult,
    type DeleteConversationsOptions,
    type DeleteConversationsResult,
    type EvidenceAnchor,
    type EvidenceLens,
    type EvidenceOmissionStats,
    type ExportConversationEvidenceOptions,
    type ExportConversationsZipOptions,
    type GetConversationOptions,
    type ListConversationsForPathOptions,
    type ResolvedConversationRef,
} from './types';

const SOURCE_LABELS: Record<ConversationSource, string> = {
    antigravity: 'Antigravity',
    'claude-code': 'Claude Code',
    codex: 'Codex',
    cursor: 'Cursor',
    grok: 'Grok',
    kiro: 'Kiro',
    'minimax-code': 'MiniMax Code',
    opencode: 'OpenCode',
    qoder: 'Qoder',
};

const SOURCE_INFOS: ConversationSourceInfo[] = CONVERSATION_SOURCES.map((source) => ({
    label: SOURCE_LABELS[source],
    source,
}));

export const isConversationSource = (value: unknown): value is ConversationSource => {
    return typeof value === 'string' && (CONVERSATION_SOURCES as readonly string[]).includes(value);
};

const ADAPTERS: Partial<Record<ConversationSource, ConversationAdapter>> = {
    antigravity: antigravityConversationAdapter,
    'claude-code': claudeCodeConversationAdapter,
    codex: codexConversationAdapter,
    cursor: cursorConversationAdapter,
    grok: grokConversationAdapter,
    kiro: kiroConversationAdapter,
    'minimax-code': minimaxCodeConversationAdapter,
    opencode: opencodeConversationAdapter,
    qoder: qoderConversationAdapter,
};

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;
const DELETE_CONCURRENCY_BY_SOURCE: Record<ConversationSource, number> = {
    antigravity: 1,
    'claude-code': 4,
    codex: 1,
    cursor: 1,
    grok: 1,
    kiro: 1,
    'minimax-code': 1,
    opencode: 2,
    qoder: 1,
};

const getEnabledSources = (sources: ListConversationsForPathOptions['sources']): ConversationSource[] => {
    if (!sources || sources === 'all') {
        return SOURCE_INFOS.map((sourceInfo) => sourceInfo.source);
    }

    return [...new Set(sources)];
};

const isAllSourcesRequest = (sources: ListConversationsForPathOptions['sources']) => !sources || sources === 'all';

const getAdapter = (source: ConversationSource): ConversationAdapter | null => {
    return ADAPTERS[source] ?? null;
};

const getLimit = (limit: number | undefined) => {
    if (!limit || limit <= 0) {
        return DEFAULT_LIMIT;
    }

    return Math.min(limit, MAX_LIMIT);
};

const filterByUpdatedAt = (
    conversations: Awaited<ReturnType<ConversationAdapter['listConversationsForPath']>>,
    options: Pick<ListConversationsForPathOptions, 'updatedAfterMs' | 'updatedBeforeMs'>,
) => {
    return conversations.filter((conversation) => {
        const updatedAtMs = conversation.updatedAtMs ?? 0;
        if (options.updatedAfterMs !== undefined && updatedAtMs < options.updatedAfterMs) {
            return false;
        }
        if (options.updatedBeforeMs !== undefined && updatedAtMs > options.updatedBeforeMs) {
            return false;
        }
        return true;
    });
};

export const listConversationSources = async (): Promise<ConversationSourceInfo[]> => [...SOURCE_INFOS];

const listSourceConversationsForPath = async (
    source: ConversationSource,
    options: ListConversationsForPathOptions,
    ignoreSourceFailures: boolean,
    paginationCursor: string | null | undefined,
) => {
    const adapter = getAdapter(source);
    if (!adapter) {
        return [];
    }

    try {
        const conversations = filterByUpdatedAt(await adapter.listConversationsForPath(options), options);
        return options.limit === undefined
            ? conversations
            : paginateConversations(conversations, paginationCursor, options.limit).data;
    } catch (error) {
        if (!ignoreSourceFailures) {
            throw error;
        }
        console.warn(`[spiracha:conversation-data] skipped ${source} during all-source collection`, {
            error: error instanceof Error ? error.message : String(error),
            source,
        });
        return [];
    }
};

export const listConversationsForPath = async (options: ListConversationsForPathOptions): Promise<ConversationPage> => {
    const cursorKey = decodeConversationCursor(options.cursor);
    const limit = getLimit(options.limit);
    const cursorUpdatedBeforeMs = cursorKey?.updatedAtMs;
    const collectionOptions: ListConversationsForPathOptions = {
        ...options,
        cursor: null,
        limit: limit + 1,
        updatedBeforeMs:
            cursorUpdatedBeforeMs === undefined
                ? options.updatedBeforeMs
                : Math.min(options.updatedBeforeMs ?? cursorUpdatedBeforeMs, cursorUpdatedBeforeMs),
    };
    const ignoreSourceFailures = isAllSourcesRequest(options.sources);
    const conversations = (
        await Promise.all(
            getEnabledSources(options.sources).map((source) =>
                listSourceConversationsForPath(source, collectionOptions, ignoreSourceFailures, options.cursor),
            ),
        )
    ).flat();

    return paginateConversations(conversations, options.cursor, limit);
};

export const getConversation = async (options: GetConversationOptions) => {
    return getAdapter(options.source)?.getConversation(options) ?? null;
};

export const deleteConversation = async (
    options: DeleteConversationOptions,
): Promise<DeleteConversationResult | null> => {
    return (await getAdapter(options.source)?.deleteConversation?.(options)) ?? null;
};

export const deleteConversations = async (
    options: DeleteConversationsOptions,
): Promise<DeleteConversationsResult | null> => {
    const adapter = getAdapter(options.source);
    if (!adapter?.deleteConversation) {
        return null;
    }
    const deleteAdapterConversation = adapter.deleteConversation;

    const rawResults = await mapWithConcurrency(
        options.ids,
        DELETE_CONCURRENCY_BY_SOURCE[options.source],
        async (id) => ({
            id,
            result: await deleteAdapterConversation({
                id,
                locations: options.locations,
                merged: options.merged,
                source: options.source,
            }),
        }),
    );
    const deletedIdSet = new Set(rawResults.flatMap(({ result }) => result.deletedIds));
    const results: DeleteConversationItemResult[] = rawResults.map(({ id, result }) => ({
        deleted: result.deletedIds.length > 0 || deletedIdSet.has(id),
        deletedFiles: result.deletedFiles,
        deletedIds: result.deletedIds,
        id,
    }));

    return {
        deletedFiles: [...new Set(results.flatMap((result) => result.deletedFiles))],
        deletedIds: [...deletedIdSet],
        missingIds: results.filter((result) => !result.deleted).map((result) => result.id),
        results,
    };
};

const sourceFromSessionRoute = (segment: string): ConversationSource | null => {
    if (segment === 'claude-code-sessions') {
        return 'claude-code';
    }
    if (segment === 'grok-sessions') {
        return 'grok';
    }
    if (segment === 'kiro-sessions') {
        return 'kiro';
    }
    if (segment === 'qoder-sessions') {
        return 'qoder';
    }
    if (segment === 'cursor-threads') {
        return 'cursor';
    }
    if (segment === 'antigravity-conversations') {
        return 'antigravity';
    }
    if (segment === 'opencode-sessions') {
        return 'opencode';
    }
    if (segment === 'minimax-code-sessions') {
        return 'minimax-code';
    }
    return null;
};

const decodeRefId = (value: string | undefined): string | null => {
    if (!value) {
        return null;
    }

    try {
        const decoded = decodeURIComponent(value);
        return decoded.trim() ? decoded : null;
    } catch {
        return null;
    }
};

const refFromPathSegmentAt = (segments: string[], index: number): ResolvedConversationRef | null => {
    const segment = segments[index];
    const next = segments[index + 1];
    const nextNext = segments[index + 2];

    if (segment === 'threads') {
        const id = decodeRefId(next);
        return id ? { id, source: 'codex' } : null;
    }

    if (segment === 'conversations' && isConversationSource(next)) {
        const id = decodeRefId(nextNext);
        return id ? { id, source: next } : null;
    }

    const source = segment ? sourceFromSessionRoute(segment) : null;
    if (!source) {
        return null;
    }

    const id = decodeRefId(next);
    return id ? { id, source } : null;
};

const refFromPathSegments = (segments: string[]): ResolvedConversationRef | null => {
    if (
        segments[0] === 'api' &&
        segments[1] === 'v1' &&
        segments[2] === 'conversations' &&
        (segments.length === 5 || (segments.length === 6 && (segments[5] === 'export' || segments[5] === 'evidence')))
    ) {
        return refFromPathSegmentAt(segments, 2);
    }

    if (segments[0] === 'app') {
        return refFromPathSegments(segments.slice(1));
    }

    const expectedLength = segments[0] === 'conversations' ? 3 : 2;
    return segments.length === expectedLength ? refFromPathSegmentAt(segments, 0) : null;
};

const parseUrlRef = (ref: string): ResolvedConversationRef | null => {
    let url: URL;
    try {
        url = new URL(ref);
    } catch {
        return null;
    }

    if (url.protocol === 'codex:' && url.hostname === 'threads') {
        const id = decodeRefId(url.pathname.replace(/^\/+/u, ''));
        return id ? { id, source: 'codex' } : null;
    }

    if (url.protocol === 'spiracha:' && url.hostname === 'conversation') {
        const [source, id, extra] = url.pathname.split('/').filter(Boolean);
        const decodedId = decodeRefId(id);
        return isConversationSource(source) && decodedId && !extra ? { id: decodedId, source } : null;
    }

    return refFromPathSegments(url.pathname.split('/').filter(Boolean));
};

export const resolveConversationRef = async (ref: string): Promise<ResolvedConversationRef | null> => {
    const trimmed = ref.trim();
    if (!trimmed) {
        return null;
    }

    return parseUrlRef(trimmed);
};

export const renderConversationMarkdown = (
    conversation: {
        messages: ConversationMessage[];
        title: string | null;
    },
    options: {
        messageSelector?: ConversationMessageSelector;
    } = {},
) => {
    const selectedMessages = options.messageSelector
        ? selectConversationMessages(conversation.messages, options.messageSelector)
        : conversation.messages;
    const title = conversation.title?.trim() || 'Conversation';
    const roleLabels: Record<ConversationMessage['role'], string> = {
        assistant: 'Assistant',
        system: 'System',
        tool: 'Tool',
        unknown: 'Unknown',
        user: 'User',
    };
    const sections = selectedMessages.map((message) => {
        const text = message.text.trim() || '_No message content._';
        return `## ${roleLabels[message.role]}\n\n${text}`;
    });
    if (sections.length === 0) {
        sections.push('_No messages selected._');
    }
    return [`# ${title}`, ...sections].join('\n\n').trimEnd() + '\n';
};
