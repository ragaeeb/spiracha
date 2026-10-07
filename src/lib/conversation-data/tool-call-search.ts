import { mapWithConcurrency } from '../concurrency';
import { getConversation, listConversations } from './index';
import type {
    ConversationDataLocations,
    ConversationDetail,
    ConversationSource,
    ConversationToolEvidence,
} from './types';

export type ToolCallSearchField = 'command' | 'input' | 'name' | 'output' | 'workdir';

export type ToolCallSearchMatch = {
    createdAtMs: number | null;
    field: ToolCallSearchField;
    messageId: string;
    modifiesFile: boolean;
    snippet: string;
    toolName: string;
};

export type ToolCallSearchHit = {
    conversationId: string;
    likelyAuthor: boolean;
    matchCount: number;
    matches: ToolCallSearchMatch[];
    title: string | null;
    updatedAtMs: number | null;
};

export type ToolCallSearchResult = {
    failedCount: number;
    hits: ToolCallSearchHit[];
    scannedCount: number;
};

export type ToolCallSearchOptions = {
    cwds: string[];
    locations?: ConversationDataLocations;
    maxMatchesPerConversation?: number;
    query: string;
    source: ConversationSource;
};

const MIN_QUERY_LENGTH = 2;
const DEFAULT_MAX_MATCHES_PER_CONVERSATION = 5;
const LIST_PAGE_SIZE = 200;
const SCAN_CONCURRENCY = 4;
const SNIPPET_RADIUS = 80;
const WRITE_TOOL_PATTERN = /write|edit|patch|str_?replace|create_?file|replace/iu;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const toSnippet = (text: string, index: number, queryLength: number): string => {
    const start = Math.max(0, index - SNIPPET_RADIUS);
    const end = Math.min(text.length, index + queryLength + SNIPPET_RADIUS);
    const body = text.slice(start, end).replace(/\s+/gu, ' ').trim();
    return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`;
};

const getSearchableFields = (
    evidence: ConversationToolEvidence,
): Array<{ field: ToolCallSearchField; text: string | null | undefined }> => [
    { field: 'command', text: evidence.command },
    { field: 'command', text: evidence.shellCommands?.join('\n') },
    { field: 'input', text: evidence.inputText },
    { field: 'output', text: evidence.outputText },
    { field: 'workdir', text: evidence.workdir },
    { field: 'name', text: evidence.name },
];

const collectConversationIds = async (options: ToolCallSearchOptions): Promise<string[]> => {
    const ids = new Set<string>();
    for (const cwd of new Set(options.cwds)) {
        let cursor: string | null = null;
        do {
            const page = await listConversations({
                cursor,
                cwd,
                includeMessages: false,
                limit: LIST_PAGE_SIZE,
                locations: options.locations,
                sources: [options.source],
            });
            for (const conversation of page.data) {
                ids.add(conversation.id);
            }
            cursor = page.meta.hasNext ? page.meta.nextCursor : null;
        } while (cursor);
    }

    return [...ids];
};

// A write tool, or an apply_patch file header (Add/Update/Delete File) naming the query, changes the file;
// reads, greps, and git status output only observe it.
const isFileModification = (toolName: string, field: ToolCallSearchField, text: string, needle: string): boolean => {
    if (field !== 'input' && field !== 'command') {
        return false;
    }

    const patchHeader = new RegExp(
        `\\*\\*\\* (?:add file|update file|delete file|move to): [^\\n\\\\]*${escapeRegExp(needle)}`,
        'u',
    );
    return WRITE_TOOL_PATTERN.test(toolName) || patchHeader.test(text.toLowerCase());
};

const findMatches = (
    conversation: ConversationDetail,
    needle: string,
    maxMatches: number,
): { matchCount: number; matches: ToolCallSearchMatch[] } => {
    // Tool results rarely repeat the tool name, so attribute them through the call that produced them.
    const toolNameByCallId = new Map<string, string>();
    for (const message of conversation.messages) {
        const evidence = message.toolEvidence;
        if (evidence?.callId && evidence.name !== 'unknown') {
            toolNameByCallId.set(evidence.callId, evidence.name);
        }
    }

    // Writes are kept ahead of observations so the cap never hides the call that changed the file.
    const modifying: ToolCallSearchMatch[] = [];
    const observing: ToolCallSearchMatch[] = [];
    let matchCount = 0;
    for (const message of conversation.messages) {
        const evidence = message.toolEvidence;
        if (!evidence) {
            continue;
        }

        for (const { field, text } of getSearchableFields(evidence)) {
            const index = text ? text.toLowerCase().indexOf(needle) : -1;
            if (!text || index < 0) {
                continue;
            }

            matchCount += 1;
            const toolName =
                evidence.name !== 'unknown'
                    ? evidence.name
                    : ((evidence.callId && toolNameByCallId.get(evidence.callId)) ?? evidence.name);
            const modifiesFile = isFileModification(toolName, field, text, needle);
            const bucket = modifiesFile ? modifying : observing;
            if (bucket.length < maxMatches) {
                bucket.push({
                    createdAtMs: message.createdAtMs,
                    field,
                    messageId: message.id,
                    modifiesFile,
                    snippet: toSnippet(text, index, needle.length),
                    toolName,
                });
            }
            break;
        }
    }

    return { matchCount, matches: [...modifying, ...observing].slice(0, maxMatches) };
};

/**
 * Finds the conversations in a workspace whose tool calls (name, command, input, output, or
 * working directory) mention `query`, e.g. to trace which thread touched a file left dirty in a
 * worktree. Each conversation is loaded and discarded in turn to keep memory bounded.
 */
export const searchConversationToolCalls = async (options: ToolCallSearchOptions): Promise<ToolCallSearchResult> => {
    const needle = options.query.trim().toLowerCase();
    if (needle.length < MIN_QUERY_LENGTH) {
        throw new Error(`Search query must be at least ${MIN_QUERY_LENGTH} characters.`);
    }

    const maxMatches = options.maxMatchesPerConversation ?? DEFAULT_MAX_MATCHES_PER_CONVERSATION;
    const ids = await collectConversationIds(options);
    let failedCount = 0;
    const hits = await mapWithConcurrency(ids, SCAN_CONCURRENCY, async (id): Promise<ToolCallSearchHit | null> => {
        try {
            const conversation = await getConversation({
                id,
                locations: options.locations,
                messageSelector: 'all',
                source: options.source,
            });
            if (!conversation) {
                return null;
            }

            const { matchCount, matches } = findMatches(conversation, needle, maxMatches);
            return matchCount > 0
                ? {
                      conversationId: conversation.id,
                      likelyAuthor: matches.some((match) => match.modifiesFile),
                      matchCount,
                      matches,
                      title: conversation.title,
                      updatedAtMs: conversation.updatedAtMs,
                  }
                : null;
        } catch {
            failedCount += 1;
            return null;
        }
    });

    return {
        failedCount,
        hits: hits
            .filter((hit): hit is ToolCallSearchHit => hit !== null)
            .sort(
                (left, right) =>
                    Number(right.likelyAuthor) - Number(left.likelyAuthor) ||
                    (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0) ||
                    left.conversationId.localeCompare(right.conversationId),
            ),
        scannedCount: ids.length,
    };
};
