import {
    deleteKiroSession,
    listKiroSessionsForGroup,
    listKiroWorkspaceGroups,
    readKiroSessionTranscript,
} from '../kiro-db';
import type {
    KiroSessionSummary,
    KiroSessionTranscript,
    KiroTranscriptEntry,
    KiroTranscriptPart,
} from '../kiro-exporter-types';
import { resolveKiroWorkspaceSessionsDir } from '../kiro-exporter-types';
import { getFinalKiroAssistantMessageEntryIds, getKiroMessagePhase } from '../kiro-transcript-phase';
import { cleanInlineTitle } from '../shared';
import {
    createDeepLinks,
    createTextMessage,
    finalizeMessages,
    normalizeAssistantPhase,
    normalizeRole,
    toDateMs,
} from './adapter-helpers';
import { selectConversationMessages } from './message-selector';
import { getConversationPathMatch } from './path-match';
import type {
    ConversationAdapter,
    ConversationDetail,
    ConversationMessage,
    ConversationPathMatch,
    DeleteConversationOptions,
    GetConversationOptions,
    ListConversationsForPathOptions,
} from './types';

const getSessionsDir = (options: { locations?: { kiroWorkspaceSessionsDir?: string } }) =>
    options.locations?.kiroWorkspaceSessionsDir ?? resolveKiroWorkspaceSessionsDir();

const partToMessages = (
    entry: KiroTranscriptEntry,
    part: KiroTranscriptPart,
    partIndex: number,
    finalEntryIds: Set<string>,
): ConversationMessage[] => {
    const createdAtMs = toDateMs(entry.timestamp);
    if (entry.entryType === 'tool_call') {
        return createTextMessage({
            createdAtMs,
            id: `${entry.entryId}:${partIndex}`,
            metadata: { executionId: entry.executionId },
            order: partIndex,
            phase: 'tool_call',
            role: 'tool',
            text: part.text,
        });
    }

    return createTextMessage({
        createdAtMs,
        id: `${entry.entryId}:${partIndex}`,
        metadata: part.imageUrl ? { imageUrl: part.imageUrl } : {},
        order: partIndex,
        phase: normalizeAssistantPhase(getKiroMessagePhase(entry, finalEntryIds), 'unknown'),
        role: normalizeRole(entry.role),
        text: part.text ?? part.imageUrl,
    });
};

const transcriptToMessages = (transcript: KiroSessionTranscript) => {
    const finalEntryIds = getFinalKiroAssistantMessageEntryIds(transcript.entries);
    return finalizeMessages(
        transcript.entries.flatMap((entry) =>
            entry.parts.flatMap((part, partIndex) => partToMessages(entry, part, partIndex, finalEntryIds)),
        ),
    );
};

const buildConversation = async (
    session: KiroSessionSummary,
    sessionsDir: string,
    matches: ConversationPathMatch[],
    options: Pick<ListConversationsForPathOptions, 'includeMessages' | 'messageSelector'>,
): Promise<ConversationDetail> => {
    const transcript = options.includeMessages ? await readKiroSessionTranscript(sessionsDir, session.sessionId) : null;
    const allMessages = transcript ? transcriptToMessages(transcript) : [];
    const messages = options.includeMessages
        ? selectConversationMessages(allMessages, options.messageSelector ?? 'last_final_answer')
        : [];

    return {
        createdAtMs: session.createdAtMs,
        deepLinks: createDeepLinks('kiro', session.sessionId, `/kiro-sessions/${session.sessionId}`),
        id: session.sessionId,
        matches,
        messageCount: options.includeMessages ? allMessages.length : session.messageCount,
        messages,
        metadata: {
            defaultModelTitle: session.defaultModelTitle,
            filePath: session.filePath,
            model: session.selectedModel ?? session.defaultModelTitle,
            selectedModel: session.selectedModel,
            sessionType: session.sessionType,
        },
        source: 'kiro',
        title: cleanInlineTitle(session.title),
        updatedAtMs: session.lastActiveAtMs,
        workspaceKey: session.workspaceKey,
        workspacePath: session.worktree,
    };
};

const listKiroConversationsForPath = async (options: ListConversationsForPathOptions) => {
    const sessionsDir = getSessionsDir(options);
    const groups = await listKiroWorkspaceGroups(sessionsDir);
    const conversations: ConversationDetail[] = [];

    for (const group of groups) {
        const match = await getConversationPathMatch(options.cwd, group.worktree);
        if (!match) {
            continue;
        }
        const sessions = await listKiroSessionsForGroup(group.key, sessionsDir);
        for (const session of sessions) {
            conversations.push(await buildConversation(session, sessionsDir, [match], options));
        }
    }

    return conversations;
};

const getKiroConversation = async (options: GetConversationOptions): Promise<ConversationDetail | null> => {
    const sessionsDir = getSessionsDir(options);
    const transcript = await readKiroSessionTranscript(sessionsDir, options.id);
    return transcript
        ? buildConversation(transcript.session, sessionsDir, [], {
              includeMessages: true,
              messageSelector: options.messageSelector ?? 'all',
          })
        : null;
};

const deleteKiroConversation = async (options: DeleteConversationOptions) => {
    const result = await deleteKiroSession(getSessionsDir(options), options.id);
    return {
        deletedFiles: result.deletedFiles,
        deletedIds: result.deletedSessionIds,
    };
};

export const kiroConversationAdapter: ConversationAdapter = {
    deleteConversation: deleteKiroConversation,
    getConversation: getKiroConversation,
    listConversationsForPath: listKiroConversationsForPath,
    source: 'kiro',
};
