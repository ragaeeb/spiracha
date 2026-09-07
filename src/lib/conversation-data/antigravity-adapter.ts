import {
    deleteAntigravityConversation,
    getAntigravityConversationById,
    listAntigravityConversations as listStoredAntigravityConversations,
    readAntigravityConversationMessages,
} from '../antigravity-db';
import type { AntigravityConversation } from '../antigravity-exporter-types';
import { resolveAntigravityRoots } from '../antigravity-exporter-types';
import { mapWithConcurrency } from '../concurrency';
import { cleanInlineTitle } from '../shared-text';
import { runWithTranscriptLoadLimit } from '../transcript-load-limiter';
import { getFileFingerprint, hashCacheKeyPartsIterable, withCachedJson } from '../ui-cache';
import { createConversationUiPath, createDeepLinks, decodeFileUri, isWithinUpdatedWindow } from './adapter-helpers';
import { normalizeAntigravityConversationMessages } from './antigravity-message-normalizer';
import { selectConversationMessages } from './message-selector';
import { getConversationPathMatch, getFirstConversationPathMatch } from './path-match';
import { createRawConversationDownload } from './raw-download';
import type {
    ConversationAdapter,
    ConversationDetail,
    ConversationMessage,
    ConversationPathMatch,
    DeleteConversationOptions,
    GetConversationOptions,
    ListConversationsOptions,
} from './types';

const getRoots = (options: { locations?: { antigravityRoots?: string[] } }) =>
    options.locations?.antigravityRoots ?? resolveAntigravityRoots();

const getWorkspacePath = (conversation: AntigravityConversation) =>
    conversation.workspaceFolder ?? decodeFileUri(conversation.workspaceUri);

const stripTrailingPathPunctuation = (value: string) => value.replace(/[),.;:\]`]+$/u, '');
const PATH_REFERENCE_FALLBACK_LIMIT = 100;
const PATH_REFERENCE_CONCURRENCY = 4;

const extractAbsolutePathReferences = (text: string): string[] => {
    return [...new Set((text.match(/\/[^\s"'`)\]]+/gu) ?? []).map(stripTrailingPathPunctuation))];
};

const getConversationCacheFingerprints = async (conversation: AntigravityConversation): Promise<string[]> => {
    const paths =
        conversation.transcriptSource === 'trajectory' && conversation.conversationPath
            ? [
                  conversation.conversationPath,
                  `${conversation.conversationPath}-wal`,
                  `${conversation.conversationPath}-shm`,
                  conversation.transcriptPath,
              ]
            : [conversation.transcriptPath];
    const fingerprints = await Promise.all(
        paths.flatMap((filePath) => (filePath ? [getFileFingerprint(filePath).catch(() => null)] : [])),
    );
    return fingerprints.filter((fingerprint): fingerprint is string => fingerprint !== null);
};

const readMessages = async (conversation: AntigravityConversation) => {
    const load = () =>
        runWithTranscriptLoadLimit(() => readAntigravityConversationMessages(conversation), {
            id: conversation.conversationId,
            integration: 'antigravity',
            operation: 'api',
            path: conversation.transcriptPath ?? conversation.conversationPath ?? undefined,
        });
    const fingerprints = await getConversationCacheFingerprints(conversation);
    const messages =
        fingerprints.length > 0
            ? await withCachedJson(
                  `antigravity-api-messages-${hashCacheKeyPartsIterable(['v3', ...fingerprints])}`,
                  load,
              )
            : await load();
    return normalizeAntigravityConversationMessages(
        conversation.conversationId,
        conversation.transcriptSource,
        messages,
    );
};

const buildConversation = async (
    conversation: AntigravityConversation,
    matches: ConversationPathMatch[],
    options: Pick<ListConversationsOptions, 'includeMessages' | 'messageSelector'>,
    preloadedMessages: ConversationMessage[] | null = null,
): Promise<ConversationDetail> => {
    const allMessages = options.includeMessages ? (preloadedMessages ?? (await readMessages(conversation))) : [];
    const messages = options.includeMessages
        ? selectConversationMessages(allMessages, options.messageSelector ?? 'last_final_answer')
        : [];
    const workspacePath = getWorkspacePath(conversation);

    return {
        createdAtMs: conversation.createdAtMs,
        deepLinks: createDeepLinks(
            'antigravity',
            conversation.conversationId,
            createConversationUiPath('antigravity-conversations', conversation.conversationId),
        ),
        id: conversation.conversationId,
        matches,
        ...(conversation.model ? { model: conversation.model } : {}),
        messageCount: options.includeMessages ? allMessages.length : conversation.transcriptEntryCount,
        messages,
        metadata: {
            artifactCount: conversation.artifactCount,
            lockedTranscript: conversation.transcriptSource === 'safe-storage',
            transcriptSource: conversation.transcriptSource,
        },
        source: 'antigravity',
        title: cleanInlineTitle(conversation.title),
        updatedAtMs: conversation.lastUpdatedAtMs ?? conversation.conversationMtimeMs,
        workspaceKey: conversation.workspaceKey,
        workspacePath,
    };
};

const getReferencedPathMatch = async (
    requestedPath: string,
    messages: ConversationMessage[],
): Promise<ConversationPathMatch | null> => {
    const referencedPaths = messages.flatMap((message) => extractAbsolutePathReferences(message.text));
    return getFirstConversationPathMatch(requestedPath, referencedPaths);
};

const listAntigravityConversations = async (options: ListConversationsOptions) => {
    if (!options.cwd) {
        return [];
    }

    const cwd = options.cwd;
    const roots = getRoots(options);
    const conversations = await listStoredAntigravityConversations(roots);
    const result: ConversationDetail[] = [];
    const pathReferenceCandidates: AntigravityConversation[] = [];

    for (const conversation of conversations) {
        if (!isWithinUpdatedWindow(conversation.lastUpdatedAtMs ?? conversation.conversationMtimeMs, options)) {
            continue;
        }

        const workspacePath = getWorkspacePath(conversation);
        const match = await getConversationPathMatch(cwd, workspacePath);
        if (match) {
            result.push(await buildConversation(conversation, [match], options));
            continue;
        }

        pathReferenceCandidates.push(conversation);
    }

    const referencedConversations = await mapWithConcurrency(
        pathReferenceCandidates.slice(0, PATH_REFERENCE_FALLBACK_LIMIT),
        PATH_REFERENCE_CONCURRENCY,
        async (conversation) => {
            let messages: ConversationMessage[];
            try {
                messages = await readMessages(conversation);
            } catch (error) {
                console.warn('[spiracha:antigravity] skipped unreadable path-reference transcript', {
                    conversationId: conversation.conversationId,
                    error: error instanceof Error ? error.message : String(error),
                });
                return null;
            }
            const referencedPathMatch = await getReferencedPathMatch(cwd, messages);
            if (referencedPathMatch) {
                return buildConversation(conversation, [referencedPathMatch], options, messages);
            }
            return null;
        },
    );
    result.push(...referencedConversations.flatMap((conversation) => (conversation ? [conversation] : [])));

    return result;
};

const getAntigravityConversation = async (options: GetConversationOptions): Promise<ConversationDetail | null> => {
    const conversation = (await listStoredAntigravityConversations(getRoots(options))).find(
        (entry) => entry.conversationId === options.id,
    );
    return conversation
        ? buildConversation(conversation, [], {
              includeMessages: true,
              messageSelector: options.messageSelector ?? 'all',
          })
        : null;
};

const getAntigravityConversationRaw = async (options: GetConversationOptions) => {
    const conversation = await getAntigravityConversationById(options.id, getRoots(options));
    return conversation?.transcriptPath ? createRawConversationDownload(conversation.transcriptPath) : null;
};

const deleteAntigravityConversationById = async (options: DeleteConversationOptions) => {
    const result = await deleteAntigravityConversation(getRoots(options), options.id);
    return {
        deletedFiles: result.deletedPaths,
        deletedIds: result.deletedConversationIds,
    };
};

export const antigravityConversationAdapter: ConversationAdapter = {
    deleteConversation: deleteAntigravityConversationById,
    getConversation: getAntigravityConversation,
    getConversationRaw: getAntigravityConversationRaw,
    listConversations: listAntigravityConversations,
    source: 'antigravity',
};
