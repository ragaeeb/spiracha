import {
    deleteAntigravityConversation,
    listAntigravityConversations,
    readAntigravityConversationMessages,
} from '../antigravity-db';
import type { AntigravityConversation } from '../antigravity-exporter-types';
import { resolveAntigravityRoots } from '../antigravity-exporter-types';
import { mapWithConcurrency } from '../concurrency';
import { cleanInlineTitle } from '../shared';
import { runWithTranscriptLoadLimit } from '../transcript-load-limiter';
import { getFileFingerprint, hashCacheKeyPartsIterable, withCachedJson } from '../ui-cache';
import {
    createConversationUiPath,
    createDeepLinks,
    decodeFileUri,
    finalizeMessages,
    isWithinUpdatedWindow,
    normalizeToolStatus,
} from './adapter-helpers';
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
const PATH_REFERENCE_FALLBACK_LIMIT = 100;
const PATH_REFERENCE_CONCURRENCY = 4;

const extractAbsolutePathReferences = (text: string): string[] => {
    return [...new Set((text.match(/\/[^\s"'`)\]]+/gu) ?? []).map(stripTrailingPathPunctuation))];
};

const antigravityToolEvidence = (message: Pick<ConversationMessage, 'metadata' | 'phase' | 'text'>) => {
    if (message.phase !== 'tool_call' && message.phase !== 'tool_output') {
        return null;
    }
    let name = 'unknown';
    let inputText: string | null = null;
    if (message.phase === 'tool_call') {
        try {
            const first = JSON.parse(message.text.split('\n')[0] ?? '') as { args?: unknown; name?: unknown };
            name = typeof first.name === 'string' ? first.name : name;
            inputText = first.args === undefined ? message.text : JSON.stringify(first.args);
        } catch {
            inputText = message.text;
        }
    }
    const status = typeof message.metadata.status === 'string' ? message.metadata.status : null;
    return {
        callId: null,
        command: null,
        durationMs: null,
        exitCode: null,
        inputText,
        name,
        namespace: name.includes('.') ? (name.split('.')[0] ?? null) : null,
        outputText: message.phase === 'tool_output' ? message.text : null,
        status: normalizeToolStatus(status),
        workdir: null,
    } as const;
};

const readMessages = async (conversation: AntigravityConversation) => {
    const load = () =>
        runWithTranscriptLoadLimit(() => readAntigravityConversationMessages(conversation), {
            id: conversation.conversationId,
            integration: 'antigravity',
            operation: 'api',
            path: conversation.transcriptPath ?? conversation.conversationPath ?? undefined,
        });
    const transcriptPath = conversation.transcriptPath;
    const messages = transcriptPath
        ? await getFileFingerprint(transcriptPath)
              .then((fingerprint) =>
                  withCachedJson(`antigravity-api-messages-${hashCacheKeyPartsIterable([fingerprint])}`, load),
              )
              .catch(load)
        : await load();
    return finalizeMessages(
        messages.map(
            (message, entryIndex): ConversationMessage => ({
                ...message,
                id: `${conversation.conversationId}:${message.order}:${message.role}:${message.phase}:${entryIndex}`,
                metadata: {
                    ...message.metadata,
                    evidenceLimitation: 'Antigravity transcript records do not expose stable call/result IDs.',
                    model: conversation.model,
                    transcriptSource: conversation.transcriptSource,
                },
                toolEvidence: antigravityToolEvidence(message),
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
            createConversationUiPath('antigravity-conversations', conversation.conversationId),
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
    const pathReferenceCandidates: AntigravityConversation[] = [];

    for (const conversation of conversations) {
        if (!isWithinUpdatedWindow(conversation.lastUpdatedAtMs ?? conversation.conversationMtimeMs, options)) {
            continue;
        }

        const workspacePath = getWorkspacePath(conversation);
        const match = await getConversationPathMatch(options.cwd, workspacePath);
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
            const referencedPathMatch = await getReferencedPathMatch(options.cwd, messages);
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
