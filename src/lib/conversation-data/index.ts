import { antigravityConversationAdapter } from './antigravity-adapter';
import { claudeCodeConversationAdapter } from './claude-code-adapter';
import { codexConversationAdapter } from './codex-adapter';
import { cursorConversationAdapter } from './cursor-adapter';
import { kiroConversationAdapter } from './kiro-adapter';
import { selectConversationMessages } from './message-selector';
import { opencodeConversationAdapter } from './opencode-adapter';
import { qoderConversationAdapter } from './qoder-adapter';
import {
    CONVERSATION_SOURCES,
    type ConversationAdapter,
    type ConversationDataLocations,
    type ConversationMessage,
    type ConversationMessageSelector,
    type ConversationPage,
    type ConversationSource,
    type ConversationSourceInfo,
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
    type ConversationMessage,
    type ConversationMessagePhase,
    type ConversationMessageRole,
    type ConversationMessageSelector,
    type ConversationPage,
    type ConversationPathMatch,
    type ConversationSource,
    type ConversationSourceInfo,
    type GetConversationOptions,
    type ListConversationsForPathOptions,
    type ResolvedConversationRef,
} from './types';

const SOURCE_LABELS: Record<ConversationSource, string> = {
    antigravity: 'Antigravity',
    'claude-code': 'Claude Code',
    codex: 'Codex',
    cursor: 'Cursor',
    kiro: 'Kiro',
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
    kiro: kiroConversationAdapter,
    opencode: opencodeConversationAdapter,
    qoder: qoderConversationAdapter,
};

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;

const getEnabledSources = (sources: ListConversationsForPathOptions['sources']): ConversationSource[] => {
    if (!sources || sources === 'all') {
        return SOURCE_INFOS.map((sourceInfo) => sourceInfo.source);
    }

    return sources;
};

const isAllSourcesRequest = (sources: ListConversationsForPathOptions['sources']) => !sources || sources === 'all';

const getAdapter = (source: ConversationSource): ConversationAdapter | null => {
    return ADAPTERS[source] ?? null;
};

const decodeCursor = (cursor: string | null | undefined) => {
    if (!cursor) {
        return 0;
    }

    const parsed = Number.parseInt(Buffer.from(cursor, 'base64url').toString('utf8'), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const encodeCursor = (offset: number) => Buffer.from(String(offset), 'utf8').toString('base64url');

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

const sortConversations = (conversations: Awaited<ReturnType<ConversationAdapter['listConversationsForPath']>>) => {
    return [...conversations].sort(
        (left, right) =>
            (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0) ||
            left.source.localeCompare(right.source) ||
            left.id.localeCompare(right.id),
    );
};

export const listConversationSources = async (): Promise<ConversationSourceInfo[]> => SOURCE_INFOS;

const listSourceConversationsForPath = async (
    source: ConversationSource,
    options: ListConversationsForPathOptions,
    ignoreSourceFailures: boolean,
) => {
    const adapter = getAdapter(source);
    if (!adapter) {
        return [];
    }

    try {
        return await adapter.listConversationsForPath(options);
    } catch (error) {
        if (!ignoreSourceFailures) {
            throw error;
        }
        return [];
    }
};

export const listConversationsForPath = async (options: ListConversationsForPathOptions): Promise<ConversationPage> => {
    const ignoreSourceFailures = isAllSourcesRequest(options.sources);
    const conversations = (
        await Promise.all(
            getEnabledSources(options.sources).map((source) =>
                listSourceConversationsForPath(source, options, ignoreSourceFailures),
            ),
        )
    ).flat();

    const sorted = sortConversations(filterByUpdatedAt(conversations, options));
    const offset = decodeCursor(options.cursor);
    const limit = getLimit(options.limit);
    const data = sorted.slice(offset, offset + limit);
    const nextOffset = offset + data.length;

    return {
        data,
        meta: {
            hasNext: nextOffset < sorted.length,
            nextCursor: nextOffset < sorted.length ? encodeCursor(nextOffset) : null,
        },
    };
};

export const getConversation = async (options: GetConversationOptions) => {
    return getAdapter(options.source)?.getConversation(options) ?? null;
};

const sourceFromSessionRoute = (segment: string): ConversationSource | null => {
    if (segment === 'claude-code-sessions') {
        return 'claude-code';
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
    return null;
};

const parseUrlRef = (ref: string): ResolvedConversationRef | null => {
    let url: URL;
    try {
        url = new URL(ref);
    } catch {
        return null;
    }

    if (url.protocol === 'codex:' && url.hostname === 'threads') {
        const id = url.pathname.replace(/^\/+/u, '');
        return id ? { id, source: 'codex' } : null;
    }

    if (url.protocol === 'spiracha:' && url.hostname === 'conversation') {
        const [source, id] = url.pathname.split('/').filter(Boolean);
        return isConversationSource(source) && id ? { id, source } : null;
    }

    const [segment, id] = url.pathname.split('/').filter(Boolean);
    if (segment === 'threads' && id) {
        return { id, source: 'codex' };
    }

    const source = segment ? sourceFromSessionRoute(segment) : null;
    return source && id ? { id, source } : null;
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
    options: { messageSelector?: ConversationMessageSelector } = {},
) => {
    const selectedMessages = options.messageSelector
        ? selectConversationMessages(conversation.messages, options.messageSelector)
        : conversation.messages;
    const title = conversation.title?.trim() || 'Conversation';
    const sections = selectedMessages.map((message) => `## ${message.role}\n\n${message.text.trim()}`);
    return [`# ${title}`, ...sections].join('\n\n').trimEnd() + '\n';
};

export const createConversationDataLocations = (
    locations: ConversationDataLocations | undefined,
): ConversationDataLocations | undefined => locations;
