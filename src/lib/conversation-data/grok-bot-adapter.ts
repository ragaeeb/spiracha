import path from 'node:path';
import {
    deleteGrokBotConversation,
    findGrokBotConversationReplicaPath,
    listGrokBotConversations as listGrokBotConversationSummaries,
    readGrokBotConversation,
    resolveGrokBotPersistenceDir,
} from '../grok-bot-db';
import type { GrokBotConversation, GrokBotConversationSummary } from '../grok-bot-payload';
import { grokBotTranscriptMetadata, normalizeGrokBotTranscript } from '../grok-bot-payload';
import { createConversationUiPath, createDeepLinks } from './adapter-helpers';
import { selectConversationMessages } from './message-selector';
import type {
    ConversationAdapter,
    ConversationDetail,
    DeleteConversationOptions,
    GetConversationOptions,
    ListConversationsOptions,
} from './types';

const getPersistenceDir = (options: { locations?: { grokBotPersistenceDir?: string } }) =>
    options.locations?.grokBotPersistenceDir ?? resolveGrokBotPersistenceDir();

const latestTimestamp = (values: Array<number | null>) => {
    const timestamps = values.filter((value): value is number => value !== null);
    return timestamps.length > 0 ? Math.max(...timestamps) : null;
};

const buildConversation = (
    conversation: GrokBotConversationSummary,
    options: Pick<ListConversationsOptions, 'includeMessages' | 'messageSelector'>,
    transcript?: GrokBotConversation['transcript'],
): ConversationDetail => {
    const chatKind = conversation.roster.isGroup ? 'group' : 'direct';
    const allMessages = transcript ? normalizeGrokBotTranscript(transcript.entries, chatKind) : [];
    const updatedAtMs = latestTimestamp([
        conversation.roster.lastActivityAtMs,
        conversation.roster.updatedAtMs,
        ...(transcript ? [transcript.persistedAtMs, ...transcript.entries.map((entry) => entry.timestampMs)] : []),
    ]);

    return {
        createdAtMs: conversation.roster.createdAtMs,
        deepLinks: createDeepLinks(
            'grok-bot',
            conversation.id,
            createConversationUiPath('grok-bot-chats', conversation.id),
        ),
        id: conversation.id,
        matches: [],
        messageCount: transcript ? allMessages.length : null,
        messages:
            options.includeMessages === false
                ? []
                : selectConversationMessages(allMessages, options.messageSelector ?? 'all'),
        metadata: grokBotTranscriptMetadata(conversation, transcript),
        source: 'grok-bot',
        title: conversation.roster.name.trim() || conversation.id,
        updatedAtMs,
        workspaceKey: null,
        workspacePath: null,
    };
};

const listGrokBotConversations = async (options: ListConversationsOptions) => {
    const summaries = await listGrokBotConversationSummaries(getPersistenceDir(options));
    return summaries.map((summary) => buildConversation(summary, options));
};

const getGrokBotConversation = async (options: GetConversationOptions): Promise<ConversationDetail | null> => {
    const conversation = await readGrokBotConversation(getPersistenceDir(options), options.id);
    return conversation
        ? buildConversation(
              conversation,
              {
                  includeMessages: true,
                  messageSelector: options.messageSelector ?? 'all',
              },
              conversation.transcript,
          )
        : null;
};

const getGrokBotConversationRaw = async (options: GetConversationOptions) => {
    const persistencePath = await findGrokBotConversationReplicaPath(getPersistenceDir(options), options.id);
    return persistencePath
        ? {
              blob: Bun.file(persistencePath),
              fileName: path.basename(persistencePath),
              mimeType: 'application/json' as const,
          }
        : null;
};

const deleteGrokBotConversationById = async (options: DeleteConversationOptions) =>
    deleteGrokBotConversation(getPersistenceDir(options), options.id);

export const grokBotConversationAdapter: ConversationAdapter = {
    deleteConversation: deleteGrokBotConversationById,
    getConversation: getGrokBotConversation,
    getConversationRaw: getGrokBotConversationRaw,
    listConversations: listGrokBotConversations,
    source: 'grok-bot',
};
