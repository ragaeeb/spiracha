import {
    deleteGrokSession,
    listGrokSessionsForGroup,
    listGrokWorkspaceGroups,
    readGrokSessionTranscript,
    resolveGrokSessionsDir,
} from '../grok-db';
import type {
    GrokSessionSummary,
    GrokSessionTranscript,
    GrokTranscriptEntry,
    GrokTranscriptPart,
} from '../grok-exporter-types';
import { getFinalGrokAssistantTextPartIds, getGrokTextPartPhase } from '../grok-transcript-phase';
import { cleanInlineTitle } from '../shared';
import {
    createDeepLinks,
    createTextMessage,
    finalizeMessages,
    normalizeAssistantPhase,
    normalizeRole,
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

const getSessionsDir = (options: { locations?: { grokSessionsDir?: string } }) =>
    options.locations?.grokSessionsDir ?? resolveGrokSessionsDir();

const partToMessages = (
    entry: GrokTranscriptEntry,
    part: GrokTranscriptPart,
    finalTextPartIds: Set<string>,
    order: number,
): ConversationMessage[] => {
    if (part.type === 'text') {
        return createTextMessage({
            createdAtMs: entry.createdAtMs,
            id: part.partId,
            metadata: { modelFingerprint: entry.modelFingerprint, modelId: entry.modelId },
            order,
            phase: normalizeAssistantPhase(getGrokTextPartPhase(entry, part, finalTextPartIds), 'unknown'),
            role: normalizeRole(entry.role),
            text: part.text,
        });
    }

    if (part.type === 'reasoning') {
        return createTextMessage({
            createdAtMs: entry.createdAtMs,
            id: part.partId,
            order,
            phase: 'reasoning',
            role: 'assistant',
            text: part.text,
        });
    }

    if (part.type === 'tool_call') {
        return createTextMessage({
            createdAtMs: entry.createdAtMs,
            id: part.partId,
            metadata: { toolCallId: part.toolCallId, toolName: part.toolName },
            order,
            phase: 'tool_call',
            role: 'tool',
            text: [part.toolName, part.argumentsText].filter(Boolean).join('\n'),
        });
    }

    if (part.type === 'tool_result') {
        return createTextMessage({
            createdAtMs: entry.createdAtMs,
            id: part.partId,
            metadata: { toolCallId: part.toolCallId },
            order,
            phase: 'tool_output',
            role: 'tool',
            text: part.outputText,
        });
    }

    return [];
};

const transcriptToMessages = (transcript: GrokSessionTranscript): ConversationMessage[] => {
    const finalTextPartIds = getFinalGrokAssistantTextPartIds(transcript.entries);
    return finalizeMessages(
        transcript.entries.flatMap((entry, entryIndex) =>
            entry.parts.flatMap((part, partIndex) =>
                partToMessages(entry, part, finalTextPartIds, entryIndex + partIndex),
            ),
        ),
    );
};

const buildConversation = async (
    session: GrokSessionSummary,
    sessionsDir: string,
    matches: ConversationPathMatch[],
    options: Pick<ListConversationsForPathOptions, 'includeMessages' | 'messageSelector'>,
    loadedTranscript: GrokSessionTranscript | null = null,
): Promise<ConversationDetail> => {
    const transcript =
        loadedTranscript ??
        (options.includeMessages
            ? await readGrokSessionTranscript(sessionsDir, session.sessionId, { includeRawPayloads: false })
            : null);
    const allMessages = transcript ? transcriptToMessages(transcript) : [];
    const messages = options.includeMessages
        ? selectConversationMessages(allMessages, options.messageSelector ?? 'last_final_answer')
        : [];

    return {
        createdAtMs: session.createdAtMs,
        deepLinks: createDeepLinks('grok', session.sessionId, `/grok-sessions/${session.sessionId}`),
        id: session.sessionId,
        matches,
        messageCount: options.includeMessages ? allMessages.length : session.messageCount,
        messages,
        metadata: {
            agentName: session.agentName,
            currentModelId: session.currentModelId,
            gitBranch: session.gitBranch,
            headCommit: session.headCommit,
            modelLabel: session.modelLabel,
            renderablePartCount: session.renderablePartCount,
            sandboxProfile: session.sandboxProfile,
        },
        source: 'grok',
        title: cleanInlineTitle(session.title),
        updatedAtMs: session.lastActiveAtMs,
        workspaceKey: session.workspaceKey,
        workspacePath: session.worktree,
    };
};

const listGrokConversationsForPath = async (options: ListConversationsForPathOptions) => {
    const sessionsDir = getSessionsDir(options);
    const groups = await listGrokWorkspaceGroups(sessionsDir);
    const conversations: ConversationDetail[] = [];

    for (const group of groups) {
        const match = await getConversationPathMatch(options.cwd, group.worktree);
        if (!match) {
            continue;
        }
        const sessions = await listGrokSessionsForGroup(group.key, sessionsDir);
        for (const session of sessions) {
            conversations.push(await buildConversation(session, sessionsDir, [match], options));
        }
    }

    return conversations;
};

const getGrokConversation = async (options: GetConversationOptions): Promise<ConversationDetail | null> => {
    const sessionsDir = getSessionsDir(options);
    const transcript = await readGrokSessionTranscript(sessionsDir, options.id, { includeRawPayloads: false });
    return transcript
        ? buildConversation(
              transcript.session,
              sessionsDir,
              [],
              {
                  includeMessages: true,
                  messageSelector: options.messageSelector ?? 'all',
              },
              transcript,
          )
        : null;
};

const deleteGrokConversation = async (options: DeleteConversationOptions) => {
    const result = await deleteGrokSession(getSessionsDir(options), options.id);
    return {
        deletedFiles: result.deletedFiles,
        deletedIds: result.deletedSessionIds,
    };
};

export const grokConversationAdapter: ConversationAdapter = {
    deleteConversation: deleteGrokConversation,
    getConversation: getGrokConversation,
    listConversationsForPath: listGrokConversationsForPath,
    source: 'grok',
};
