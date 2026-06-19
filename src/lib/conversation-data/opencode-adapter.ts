import {
    listOpenCodeSessionsForGroup,
    listOpenCodeWorkspaceGroups,
    readOpenCodeSessionTranscript,
} from '../opencode-db';
import type {
    OpenCodeSessionSummary,
    OpenCodeSessionTranscript,
    OpenCodeTranscriptPart,
} from '../opencode-exporter-types';
import { resolveOpenCodeDbPath } from '../opencode-exporter-types';
import { splitOpenCodeThinkTaggedText } from '../opencode-think-tags';
import { getFinalOpenCodeAssistantTextPartIds, getOpenCodeTextPartPhase } from '../opencode-transcript-phase';
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
    GetConversationOptions,
    ListConversationsForPathOptions,
} from './types';

const getDbPath = (options: { locations?: { opencodeDbPath?: string } }) =>
    options.locations?.opencodeDbPath ?? resolveOpenCodeDbPath();

const textPartToMessages = (
    part: OpenCodeTranscriptPart,
    finalTextPartIds: Set<string>,
    order: number,
): ConversationMessage[] => {
    const split = splitOpenCodeThinkTaggedText(part.text ?? '');
    return [
        ...createTextMessage({
            createdAtMs: part.createdAtMs,
            id: `${part.partId}:reasoning`,
            order,
            phase: 'reasoning',
            role: 'assistant',
            text: split.reasoningBlocks.join('\n\n'),
        }),
        ...createTextMessage({
            createdAtMs: part.createdAtMs,
            id: part.partId,
            order,
            phase: normalizeAssistantPhase(getOpenCodeTextPartPhase(part, finalTextPartIds), 'unknown'),
            role: normalizeRole(part.role),
            text: split.visibleText,
        }),
    ];
};

const partToMessages = (
    part: OpenCodeTranscriptPart,
    finalTextPartIds: Set<string>,
    order: number,
): ConversationMessage[] => {
    if (part.type === 'text') {
        return textPartToMessages(part, finalTextPartIds, order);
    }

    if (part.type === 'reasoning') {
        return createTextMessage({
            createdAtMs: part.createdAtMs,
            id: part.partId,
            order,
            phase: 'reasoning',
            role: 'assistant',
            text: part.text,
        });
    }

    if (part.type === 'tool') {
        return createTextMessage({
            createdAtMs: part.createdAtMs,
            id: part.partId,
            metadata: { callId: part.callId, status: part.status, toolName: part.toolName },
            order,
            phase: part.outputText ? 'tool_output' : 'tool_call',
            role: 'tool',
            text: part.outputText ?? part.argumentsText ?? part.title ?? part.toolName,
        });
    }

    return [];
};

const transcriptToMessages = (transcript: OpenCodeSessionTranscript) => {
    const parts = transcript.messages.flatMap((message) => message.parts);
    const finalTextPartIds = getFinalOpenCodeAssistantTextPartIds(parts);
    return finalizeMessages(parts.flatMap((part, order) => partToMessages(part, finalTextPartIds, order)));
};

const buildConversation = async (
    session: OpenCodeSessionSummary,
    dbPath: string,
    matches: ConversationPathMatch[],
    options: Pick<ListConversationsForPathOptions, 'includeMessages' | 'messageSelector'>,
    loadedTranscript: OpenCodeSessionTranscript | null = null,
): Promise<ConversationDetail> => {
    const transcript =
        loadedTranscript ??
        (options.includeMessages ? await readOpenCodeSessionTranscript(dbPath, session.sessionId) : null);
    const allMessages = transcript ? transcriptToMessages(transcript) : [];
    const messages = options.includeMessages
        ? selectConversationMessages(allMessages, options.messageSelector ?? 'last_final_answer')
        : [];

    return {
        createdAtMs: session.createdAtMs,
        deepLinks: createDeepLinks('opencode', session.sessionId, `/opencode-sessions/${session.sessionId}`),
        id: session.sessionId,
        matches,
        messageCount: options.includeMessages ? allMessages.length : session.messageCount,
        messages,
        metadata: {
            agent: session.agent,
            cost: session.cost,
            model: session.model,
            modelLabel: session.modelLabel,
            totalTokens: session.totalTokens,
        },
        source: 'opencode',
        title: cleanInlineTitle(session.title),
        updatedAtMs: session.lastUpdatedAtMs,
        workspaceKey: session.workspaceKey,
        workspacePath: session.worktree,
    };
};

const listOpenCodeConversationsForPath = async (options: ListConversationsForPathOptions) => {
    const dbPath = getDbPath(options);
    const groups = await listOpenCodeWorkspaceGroups(dbPath);
    const conversations: ConversationDetail[] = [];

    for (const group of groups) {
        const match = await getConversationPathMatch(options.cwd, group.worktree);
        if (!match) {
            continue;
        }
        const sessions = await listOpenCodeSessionsForGroup(group.key, dbPath);
        for (const session of sessions) {
            conversations.push(await buildConversation(session, dbPath, [match], options));
        }
    }

    return conversations;
};

const getOpenCodeConversation = async (options: GetConversationOptions): Promise<ConversationDetail | null> => {
    const dbPath = getDbPath(options);
    const transcript = await readOpenCodeSessionTranscript(dbPath, options.id);
    return transcript
        ? buildConversation(
              transcript.session,
              dbPath,
              [],
              {
                  includeMessages: true,
                  messageSelector: options.messageSelector ?? 'all',
              },
              transcript,
          )
        : null;
};

export const opencodeConversationAdapter: ConversationAdapter = {
    getConversation: getOpenCodeConversation,
    listConversationsForPath: listOpenCodeConversationsForPath,
    source: 'opencode',
};
