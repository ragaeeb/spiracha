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

type ParsedToolCallEvidence = {
    callId: string | null;
    command: string | null;
    inputText: string;
    name: string;
    workdir: string | null;
};

const metadataString = (message: Pick<ConversationMessage, 'metadata'>, key: string): string | null => {
    const value = message.metadata[key];
    return typeof value === 'string' ? value : null;
};

const parseToolCallEvidence = (message: Pick<ConversationMessage, 'metadata' | 'text'>): ParsedToolCallEvidence => {
    const fallback: ParsedToolCallEvidence = {
        callId: metadataString(message, 'toolCallId'),
        command: metadataString(message, 'command'),
        inputText: message.text,
        name: 'unknown',
        workdir: metadataString(message, 'workdir'),
    };
    try {
        const parsed = JSON.parse(message.text.split('\n')[0] ?? '') as {
            args?: unknown;
            id?: unknown;
            name?: unknown;
        };
        const args = parsed.args && typeof parsed.args === 'object' ? (parsed.args as Record<string, unknown>) : null;
        return {
            callId: typeof parsed.id === 'string' ? parsed.id : fallback.callId,
            command: typeof args?.CommandLine === 'string' ? args.CommandLine : fallback.command,
            inputText: parsed.args === undefined ? message.text : JSON.stringify(parsed.args),
            name: typeof parsed.name === 'string' ? parsed.name : fallback.name,
            workdir: typeof args?.Cwd === 'string' ? args.Cwd : fallback.workdir,
        };
    } catch {
        return fallback;
    }
};

const antigravityToolEvidence = (message: Pick<ConversationMessage, 'metadata' | 'phase' | 'text'>) => {
    if (message.phase !== 'tool_call' && message.phase !== 'tool_output') {
        return null;
    }
    const call =
        message.phase === 'tool_call'
            ? parseToolCallEvidence(message)
            : {
                  callId: metadataString(message, 'toolCallId'),
                  command: metadataString(message, 'command'),
                  inputText: null,
                  name: metadataString(message, 'toolName') ?? 'unknown',
                  workdir: metadataString(message, 'workdir'),
              };
    const status = metadataString(message, 'status');
    const exitCode = typeof message.metadata.exitCode === 'number' ? message.metadata.exitCode : null;
    return {
        callId: call.callId,
        command: call.command,
        durationMs: null,
        exitCode,
        inputText: call.inputText,
        name: call.name,
        namespace: call.name.includes('.') ? (call.name.split('.')[0] ?? null) : null,
        outputText: message.phase === 'tool_output' ? message.text : null,
        status: normalizeToolStatus(status, exitCode),
        workdir: call.workdir,
    } as const;
};

const getEvidenceLimitationMetadata = (message: Pick<ConversationMessage, 'metadata' | 'phase'>) => {
    if (message.phase !== 'tool_call' && message.phase !== 'tool_output') {
        return {};
    }
    return message.metadata.toolCallId
        ? {}
        : { evidenceLimitation: 'This Antigravity transcript record does not expose a stable call ID.' };
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
    return finalizeMessages(
        messages.map(
            (message, entryIndex): ConversationMessage => ({
                ...message,
                id: `${conversation.conversationId}:${message.order}:${message.role}:${message.phase}:${entryIndex}`,
                metadata: {
                    ...message.metadata,
                    ...getEvidenceLimitationMetadata(message),
                    model: typeof message.metadata.model === 'string' ? message.metadata.model : null,
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
