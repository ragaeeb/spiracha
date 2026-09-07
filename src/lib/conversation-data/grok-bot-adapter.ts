import path from 'node:path';
import type { GrokBotConversation, GrokBotConversationSummary, GrokBotTranscriptEntry } from '../grok-bot-db';
import {
    deleteGrokBotConversation,
    findGrokBotConversationReplicaPath,
    listGrokBotConversations as listGrokBotConversationSummaries,
    readGrokBotConversation,
    resolveGrokBotPersistenceDir,
} from '../grok-bot-db';
import { createConversationUiPath, createDeepLinks, createTextMessage, normalizeRole } from './adapter-helpers';
import { selectConversationMessages } from './message-selector';
import type {
    ConversationAdapter,
    ConversationDetail,
    ConversationMessage,
    DeleteConversationOptions,
    GetConversationOptions,
    ListConversationsOptions,
} from './types';

type SafeAgentRef = {
    id: string;
    kind?: string;
    name?: string;
};

const getPersistenceDir = (options: { locations?: { grokBotPersistenceDir?: string } }) =>
    options.locations?.grokBotPersistenceDir ?? resolveGrokBotPersistenceDir();

const safeAgentRef = (value: unknown): SafeAgentRef | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.id !== 'string' || !record.id.trim()) {
        return null;
    }

    return {
        id: record.id,
        ...(typeof record.kind === 'string' && record.kind ? { kind: record.kind } : {}),
        ...(typeof record.name === 'string' && record.name ? { name: record.name } : {}),
    };
};

const safeAttachment = (entry: GrokBotTranscriptEntry) => {
    if (entry.kind !== 'user-attachment') {
        return null;
    }

    const fileName = typeof entry.file_name === 'string' ? path.basename(entry.file_name) : null;
    const byteSize = typeof entry.byteSize === 'number' && Number.isFinite(entry.byteSize) ? entry.byteSize : null;
    return {
        ...(fileName ? { fileName } : {}),
        ...(byteSize === null ? {} : { byteSize }),
    };
};

const entryText = (entry: GrokBotTranscriptEntry): string | null => {
    if (typeof entry.content === 'string') {
        return entry.content;
    }
    if (typeof entry.message === 'object' && entry.message !== null && !Array.isArray(entry.message)) {
        const content = (entry.message as Record<string, unknown>).content;
        return typeof content === 'string' ? content : null;
    }
    return null;
};

const entryMessageMetadata = (entry: GrokBotTranscriptEntry, chatKind: 'direct' | 'group') => {
    const author = safeAgentRef(entry.author);
    const toAgent = safeAgentRef(entry.toAgent);
    return {
        chatKind,
        entryKind: entry.kind,
        ...(author
            ? {
                  authorId: author.id,
                  ...(author.kind ? { authorKind: author.kind } : {}),
                  ...(author.name ? { authorName: author.name } : {}),
              }
            : {}),
        ...(toAgent
            ? {
                  toAgentId: toAgent.id,
                  ...(toAgent.kind ? { toAgentKind: toAgent.kind } : {}),
                  ...(toAgent.name ? { toAgentName: toAgent.name } : {}),
              }
            : {}),
    };
};

const messageId = (entry: GrokBotTranscriptEntry, index: number, usedIds: Map<string, number>) => {
    const baseId = entry.id ?? `entry-${index}`;
    const occurrence = usedIds.get(baseId) ?? 0;
    usedIds.set(baseId, occurrence + 1);
    return occurrence === 0 ? baseId : `${baseId}-${occurrence}`;
};

const transcriptToMessages = (
    entries: GrokBotTranscriptEntry[],
    chatKind: 'direct' | 'group',
): ConversationMessage[] => {
    const usedIds = new Map<string, number>();
    return entries.flatMap((entry, index) => {
        if (entry.kind !== 'message' && entry.kind !== 'send-message') {
            return [];
        }

        const role =
            entry.kind === 'send-message'
                ? 'assistant'
                : normalizeRole(typeof entry.role === 'string' ? entry.role : undefined);
        const text = entryText(entry);
        return createTextMessage({
            createdAtMs: entry.timestampMs,
            id: messageId(entry, index, usedIds),
            metadata: entryMessageMetadata(entry, chatKind),
            order: index,
            phase: role === 'assistant' ? 'final_answer' : 'unknown',
            role,
            text,
        });
    });
};

const latestTimestamp = (values: Array<number | null>) => {
    const timestamps = values.filter((value): value is number => value !== null);
    return timestamps.length > 0 ? Math.max(...timestamps) : null;
};

const memberMetadata = (conversation: GrokBotConversationSummary) =>
    conversation.roster.memberIds.flatMap((memberId) => {
        const member = conversation.rosterRows.find((row) => row.id === memberId);
        return member ? [{ id: member.id, name: member.name }] : [];
    });

const buildMetadata = (conversation: GrokBotConversationSummary, transcript?: GrokBotConversation['transcript']) => {
    const chatKind = conversation.roster.isGroup ? 'group' : 'direct';
    const sourceEntryKinds = transcript ? [...new Set(transcript.entries.map((entry) => entry.kind))] : [];
    const attachments = transcript?.entries.flatMap((entry) => {
        const attachment = safeAttachment(entry);
        return attachment ? [attachment] : [];
    });
    const eventKinds = transcript
        ? [
              ...new Set(
                  transcript.entries
                      .filter((entry) => entry.kind === 'event')
                      .map((entry) =>
                          typeof entry.event === 'string'
                              ? entry.event
                              : typeof entry.type === 'string'
                                ? entry.type
                                : entry.kind,
                      ),
              ),
          ]
        : [];

    return {
        chatKind,
        ...(conversation.roster.description ? { description: conversation.roster.description } : {}),
        ...(conversation.roster.title ? { agentTitle: conversation.roster.title } : {}),
        memberIds: conversation.roster.memberIds,
        members: memberMetadata(conversation),
        ...(sourceEntryKinds.length > 0 ? { sourceEntryKinds } : {}),
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
        ...(eventKinds.length > 0 ? { eventKinds } : {}),
    };
};

const buildConversation = (
    conversation: GrokBotConversationSummary,
    options: Pick<ListConversationsOptions, 'includeMessages' | 'messageSelector'>,
    transcript?: GrokBotConversation['transcript'],
): ConversationDetail => {
    const chatKind = conversation.roster.isGroup ? 'group' : 'direct';
    const allMessages = transcript ? transcriptToMessages(transcript.entries, chatKind) : [];
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
        metadata: buildMetadata(conversation, transcript),
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
