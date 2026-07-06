import {
    deleteAntigravityConversation,
    listAntigravityConversations,
    readAntigravityConversationMessages,
} from '../antigravity-db';
import type { AntigravityConversation } from '../antigravity-exporter-types';
import { resolveAntigravityRoots } from '../antigravity-exporter-types';
import { cleanInlineTitle } from '../shared';
import { createDeepLinks, decodeFileUri, finalizeMessages } from './adapter-helpers';
import { selectConversationMessages } from './message-selector';
import { getConversationPathMatch, getFirstConversationPathMatch } from './path-match';
import type {
    ConversationAdapter,
    ConversationDetail,
    ConversationMessage,
    ConversationPathMatch,
    DeleteConversationOptions,
    GetConversationOptions,
    ListConversationsForPathOptions,
} from './types';

const getRoots = (options: { locations?: { antigravityRoots?: string[] } }) =>
    options.locations?.antigravityRoots ?? resolveAntigravityRoots();

const getWorkspacePath = (conversation: AntigravityConversation) =>
    conversation.workspaceFolder ?? decodeFileUri(conversation.workspaceUri);

const stripTrailingPathPunctuation = (value: string) => value.replace(/[),.;:\]`]+$/u, '');

const extractAbsolutePathReferences = (text: string): string[] => {
    return [...new Set((text.match(/\/[^\s"'`)\]]+/gu) ?? []).map(stripTrailingPathPunctuation))];
};

const readMessages = async (conversation: AntigravityConversation) => {
    const messages = await readAntigravityConversationMessages(conversation);
    return finalizeMessages(
        messages.map(
            (message): ConversationMessage => ({
                ...message,
                id: `${conversation.conversationId}:${message.order}:${message.role}:${message.phase}`,
                metadata: {
                    ...message.metadata,
                    model: conversation.model,
                    transcriptSource: conversation.transcriptSource,
                },
            }),
        ),
    );
};

const buildConversation = async (
    conversation: AntigravityConversation,
    matches: ConversationPathMatch[],
    options: Pick<ListConversationsForPathOptions, 'includeMessages' | 'messageSelector'>,
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
            `/antigravity-conversations/${conversation.conversationId}`,
        ),
        id: conversation.conversationId,
        matches,
        messageCount: options.includeMessages ? allMessages.length : conversation.transcriptEntryCount,
        messages,
        metadata: {
            artifactCount: conversation.artifactCount,
            lockedTranscript: conversation.transcriptSource === 'safe-storage',
            model: conversation.model,
            transcriptSource: conversation.transcriptSource,
        },
        source: 'antigravity',
        title: cleanInlineTitle(conversation.title),
        updatedAtMs: conversation.lastUpdatedAtMs ?? conversation.conversationMtimeMs,
        workspaceKey: conversation.workspaceKey,
        workspacePath,
    };
};

const isWithinUpdatedWindow = (
    conversation: AntigravityConversation,
    options: Pick<ListConversationsForPathOptions, 'updatedAfterMs' | 'updatedBeforeMs'>,
) => {
    const updatedAtMs = conversation.lastUpdatedAtMs ?? conversation.conversationMtimeMs ?? 0;
    if (options.updatedAfterMs !== undefined && updatedAtMs < options.updatedAfterMs) {
        return false;
    }
    if (options.updatedBeforeMs !== undefined && updatedAtMs > options.updatedBeforeMs) {
        return false;
    }
    return true;
};

const getReferencedPathMatch = async (
    requestedPath: string,
    messages: ConversationMessage[],
): Promise<ConversationPathMatch | null> => {
    const referencedPaths = messages.flatMap((message) => extractAbsolutePathReferences(message.text));
    return getFirstConversationPathMatch(requestedPath, referencedPaths);
};

const listAntigravityConversationsForPath = async (options: ListConversationsForPathOptions) => {
    const roots = getRoots(options);
    const conversations = await listAntigravityConversations(roots);
    const result: ConversationDetail[] = [];

    for (const conversation of conversations) {
        if (!isWithinUpdatedWindow(conversation, options)) {
            continue;
        }

        const workspacePath = getWorkspacePath(conversation);
        const match = await getConversationPathMatch(options.cwd, workspacePath);
        if (match) {
            result.push(await buildConversation(conversation, [match], options));
            continue;
        }

        const messages = await readMessages(conversation);
        const referencedPathMatch = await getReferencedPathMatch(options.cwd, messages);
        if (referencedPathMatch) {
            result.push(await buildConversation(conversation, [referencedPathMatch], options, messages));
        }
    }

    return result;
};

const getAntigravityConversation = async (options: GetConversationOptions): Promise<ConversationDetail | null> => {
    const conversation = (await listAntigravityConversations(getRoots(options))).find(
        (entry) => entry.conversationId === options.id,
    );
    return conversation
        ? buildConversation(conversation, [], {
              includeMessages: true,
              messageSelector: options.messageSelector ?? 'all',
          })
        : null;
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
    listConversationsForPath: listAntigravityConversationsForPath,
    source: 'antigravity',
};
