import { bindMessageProvenance, conversationReadFields } from './adapter-helpers';
import { antigravityConversationAdapter } from './antigravity-adapter';
import { claudeCodeConversationAdapter } from './claude-code-adapter';
import { clineConversationAdapter } from './cline-adapter';
import { codexConversationAdapter } from './codex-adapter';
import { commandCodeConversationAdapter } from './command-code-adapter';
import { cursorConversationAdapter } from './cursor-adapter';
import { fxConversationAdapter } from './fx-adapter';
import { grokConversationAdapter } from './grok-adapter';
import { grokBotConversationAdapter } from './grok-bot-adapter';
import { kiroConversationAdapter } from './kiro-adapter';
import { minimaxCodeConversationAdapter } from './minimax-code-adapter';
import { settleDeleteBatch } from './mutation-executor';
import { opencodeConversationAdapter } from './opencode-adapter';
import { UnsupportedSourceOperationError } from './operation-types';
import { decodeConversationCursor, paginateConversations } from './pagination';
import { qoderConversationAdapter } from './qoder-adapter';
import { SOURCE_CATALOG, serializeConversationSourceInfo, sourceFromDetailRouteSegment } from './source-catalog';
import {
    CONVERSATION_SOURCES,
    type ConversationAdapter,
    type ConversationAdapterRegistry,
    type ConversationDetail,
    type ConversationPage,
    type ConversationRawDownload,
    type ConversationSource,
    type ConversationSourceInfo,
    type ConversationSourceScope,
    type DeleteConversationOptions,
    type DeleteConversationResult,
    type DeleteConversationsOptions,
    type DeleteConversationsResult,
    type GetConversationOptions,
    type GetConversationRawOptions,
    type ListConversationsOptions,
    type ResolvedConversationRef,
} from './types';

export { selectConversationMessages } from './message-selector';
export {
    IncompleteTranscriptError,
    OriginalRepresentationUnavailableError,
    type PublicMutationError,
    SourceChangedError,
    SourceMutationConflictError,
    UnsupportedSourceOperationError,
} from './operation-types';
export { getConversationPathMatch, normalizeConversationPath } from './path-match';

export { isSupportedOriginalRawSource, serializeConversationSourceInfo } from './source-catalog';

export {
    CONVERSATION_SOURCES,
    type ContentState,
    type ConversationAdapter,
    type ConversationAdapterRegistry,
    type ConversationArtifact,
    type ConversationBodyAvailability,
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
    type ConversationMessageVisibility,
    type ConversationPage,
    type ConversationPathMatch,
    type ConversationRawDownload,
    type ConversationSource,
    type ConversationSourceInfo,
    type ConversationSourceScope,
    type ConversationToolEvidence,
    type ConversationZipDownload,
    type DeleteBatchRequestMetadata,
    type DeleteBatchSummary,
    type DeleteConversationItemResult,
    type DeleteConversationOptions,
    type DeleteConversationResult,
    type DeleteConversationsOptions,
    type DeleteConversationsResult,
    type DeleteOutcome,
    type EvidenceAnchor,
    type EvidenceLens,
    type EvidenceOmissionStats,
    type ExportConversationEvidenceOptions,
    type ExportConversationsZipOptions,
    type GetConversationOptions,
    type GetConversationRawOptions,
    type ListConversationsOptions,
    type MessageProvenance,
    type ResolvedConversationRef,
} from './types';

const SOURCE_INFOS: ConversationSourceInfo[] = CONVERSATION_SOURCES.map(serializeConversationSourceInfo);

export const isConversationSource = (value: unknown): value is ConversationSource => {
    return typeof value === 'string' && (CONVERSATION_SOURCES as readonly string[]).includes(value);
};

const ADAPTERS = {
    antigravity: antigravityConversationAdapter,
    'claude-code': claudeCodeConversationAdapter,
    cline: clineConversationAdapter,
    codex: codexConversationAdapter,
    'command-code': commandCodeConversationAdapter,
    cursor: cursorConversationAdapter,
    fx: fxConversationAdapter,
    grok: grokConversationAdapter,
    'grok-bot': grokBotConversationAdapter,
    kiro: kiroConversationAdapter,
    'minimax-code': minimaxCodeConversationAdapter,
    opencode: opencodeConversationAdapter,
    qoder: qoderConversationAdapter,
} satisfies ConversationAdapterRegistry;

const MAX_LIMIT = 200;

const DEFAULT_LIMIT = 100;

const DELETE_CONCURRENCY_BY_SOURCE: Record<ConversationSource, number> = {
    antigravity: 1,
    'claude-code': 4,
    cline: 1,
    codex: 1,
    'command-code': 1,
    cursor: 1,
    fx: 1,
    grok: 1,
    'grok-bot': 1,
    kiro: 1,
    'minimax-code': 1,
    opencode: 2,
    qoder: 1,
};

const getRequestedScope = (cwd: string | undefined): ConversationSourceScope =>
    cwd === undefined ? 'global' : 'workspace';

export const getConversationListScopeError = (
    options: Pick<ListConversationsOptions, 'cwd' | 'sources'>,
): string | null => {
    if (!options.sources || options.sources === 'all') {
        return null;
    }

    const requestedScope = getRequestedScope(options.cwd);
    const invalidSource = [...new Set(options.sources)].find(
        (source) => SOURCE_CATALOG[source].scope !== requestedScope,
    );
    if (!invalidSource) {
        return null;
    }

    return `${invalidSource} is a ${SOURCE_CATALOG[invalidSource].scope} source and cannot be listed with a ${requestedScope} scope.`;
};

const getEnabledSources = (options: Pick<ListConversationsOptions, 'cwd' | 'sources'>): ConversationSource[] => {
    const requestedScope = getRequestedScope(options.cwd);
    if (!options.sources || options.sources === 'all') {
        return SOURCE_INFOS.filter((sourceInfo) => sourceInfo.scope === requestedScope).map(
            (sourceInfo) => sourceInfo.source,
        );
    }

    const scopeError = getConversationListScopeError(options);
    if (scopeError) {
        throw new Error(scopeError);
    }

    return [...new Set(options.sources)];
};

const isAllSourcesRequest = (sources: ListConversationsOptions['sources']) => !sources || sources === 'all';

const getAdapter = (source: ConversationSource): ConversationAdapter => ADAPTERS[source];

const getLimit = (limit: number | undefined) => {
    if (!limit || limit <= 0) {
        return DEFAULT_LIMIT;
    }

    return Math.min(limit, MAX_LIMIT);
};

const filterByUpdatedAt = (
    conversations: Awaited<ReturnType<ConversationAdapter['listConversations']>>,
    options: Pick<ListConversationsOptions, 'updatedAfterMs' | 'updatedBeforeMs'>,
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

/**
 * Collects one source and applies timestamp/keyset bounds before the final merge.
 * When ignoreSourceFailures is true, every adapter error becomes a warning and an
 * empty contribution, not just missing-installation errors. Explicit-source calls
 * rethrow; callers must not interpret an all-source page as a completeness report.
 */
const listSourceConversations = async (
    source: ConversationSource,
    options: ListConversationsOptions,
    ignoreSourceFailures: boolean,
    paginationCursor: string | null | undefined,
) => {
    const adapter = getAdapter(source);
    try {
        const conversations = filterByUpdatedAt(await adapter.listConversations(options), options);
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

export const listConversations = async (options: ListConversationsOptions): Promise<ConversationPage> => {
    const cursorKey = decodeConversationCursor(options.cursor);
    const limit = getLimit(options.limit);
    // Cursor keys floor timestamps; retain the whole bucket before applying source/id tie-breakers.
    const cursorUpdatedBeforeMs = cursorKey ? cursorKey.updatedAtMs + 1 : undefined;
    const collectionOptions: ListConversationsOptions = {
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
            getEnabledSources(options).map((source) =>
                listSourceConversations(source, collectionOptions, ignoreSourceFailures, options.cursor),
            ),
        )
    ).flat();

    const page = paginateConversations(conversations, options.cursor, limit);
    return {
        ...page,
        data: page.data.map((conversation) =>
            withReadFields(conversation, {
                includeMessages: options.includeMessages === true,
                messageSelector: options.messageSelector ?? 'last_final_answer',
            }),
        ),
    };
};

const withReadFields = (
    conversation: ConversationDetail,
    readOptions: { includeMessages: boolean; messageSelector?: ListConversationsOptions['messageSelector'] },
): ConversationDetail => {
    const withProvenance = {
        ...conversation,
        messages: bindMessageProvenance(conversation.messages, conversation.id),
    };
    return withProvenance.bodyAvailability
        ? withProvenance
        : { ...withProvenance, ...conversationReadFields(readOptions) };
};

export const getConversation = async (options: GetConversationOptions) => {
    const conversation = await getAdapter(options.source).getConversation(options);
    return conversation
        ? withReadFields(conversation, {
              includeMessages: true,
              messageSelector: options.messageSelector ?? 'all',
          })
        : conversation;
};

export const getConversationRaw = async (
    options: GetConversationRawOptions,
): Promise<ConversationRawDownload | null> => {
    const capability = SOURCE_CATALOG[options.source].capabilities.original_raw;
    if (capability.state !== 'supported') {
        throw new UnsupportedSourceOperationError(
            options.source,
            'original_raw',
            capability.reason,
            capability.reasonCode,
        );
    }
    const handler = getAdapter(options.source).getConversationRaw;
    if (!handler) {
        throw new Error(`${options.source} declared original_raw support without a handler.`);
    }
    return handler(options);
};

export const deleteConversation = async (
    options: DeleteConversationOptions,
): Promise<DeleteConversationResult | null> => getAdapter(options.source).deleteConversation(options);

export const deleteConversations = async (
    options: DeleteConversationsOptions,
): Promise<DeleteConversationsResult | null> => {
    const deleteAdapterConversation = getAdapter(options.source).deleteConversation;

    return settleDeleteBatch({
        concurrency: DELETE_CONCURRENCY_BY_SOURCE[options.source],
        deleteOne: (id) =>
            deleteAdapterConversation({
                deleteSessionFiles: options.deleteSessionFiles,
                id,
                locations: options.locations,
                source: options.source,
            }),
        ids: options.ids,
        signal: options.signal,
    });
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

    if (segment === 'conversations' && isConversationSource(next)) {
        const id = decodeRefId(nextNext);
        return id ? { id, source: next } : null;
    }

    const source = segment ? sourceFromDetailRouteSegment(segment) : null;
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
        (segments.length === 5 || (segments.length === 6 && ['export', 'evidence', 'raw'].includes(segments[5]!)))
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

/**
 * Parses supported absolute UI/API/deep-link shapes into a source and ID without
 * fetching the URL or proving that a conversation exists. Host identity is not an
 * authorization check here. Bare IDs, relative URLs, and unsupported path shapes
 * return null; callers must separately retrieve/validate the resolved conversation.
 */
export const resolveConversationRef = async (ref: string): Promise<ResolvedConversationRef | null> => {
    const trimmed = ref.trim();
    if (!trimmed) {
        return null;
    }

    return parseUrlRef(trimmed);
};
