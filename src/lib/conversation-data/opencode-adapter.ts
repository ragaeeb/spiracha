import { mapWithConcurrency } from '../concurrency';
import {
    deleteOpenCodeSession,
    listOpenCodeSessionsForGroup,
    listOpenCodeWorkspaceGroups,
    readOpenCodeSessionTranscript,
} from '../opencode-db';
import type { OpenCodeSessionSummary, OpenCodeSessionTranscript } from '../opencode-exporter-types';
import { resolveOpenCodeDbPath } from '../opencode-exporter-types';
import { cleanInlineTitle } from '../shared-text';
import { runWithTranscriptLoadLimit } from '../transcript-load-limiter';
import { createConversationUiPath, createDeepLinks } from './adapter-helpers';
import { selectConversationMessages } from './message-selector';
import { openCodePartsToMessages } from './opencode-message-normalizer';
import { getConversationPathMatch } from './path-match';
import type {
    ConversationAdapter,
    ConversationDetail,
    ConversationPathMatch,
    DeleteConversationOptions,
    GetConversationOptions,
    ListConversationsOptions,
} from './types';

const OPENCODE_CONVERSATION_HYDRATION_CONCURRENCY = 4;

const getDbPath = (options: { locations?: { opencodeDbPath?: string } }) =>
    options.locations?.opencodeDbPath ?? resolveOpenCodeDbPath();

const transcriptToMessages = (transcript: OpenCodeSessionTranscript) => {
    return openCodePartsToMessages(transcript.messages.flatMap((message) => message.parts));
};

const buildConversation = async (
    session: OpenCodeSessionSummary,
    dbPath: string,
    matches: ConversationPathMatch[],
    options: Pick<ListConversationsOptions, 'includeMessages' | 'messageSelector'>,
    loadedTranscript: OpenCodeSessionTranscript | null = null,
): Promise<ConversationDetail> => {
    const transcript =
        loadedTranscript ??
        (options.includeMessages
            ? await runWithTranscriptLoadLimit(() => readOpenCodeSessionTranscript(dbPath, session.sessionId), {
                  id: session.sessionId,
                  integration: 'opencode',
                  operation: 'api',
                  path: dbPath,
              })
            : null);
    const allMessages = transcript ? transcriptToMessages(transcript) : [];
    const messages = options.includeMessages
        ? selectConversationMessages(allMessages, options.messageSelector ?? 'last_final_answer')
        : [];
    const model = session.model.id ?? session.modelLabel ?? undefined;

    return {
        createdAtMs: session.createdAtMs,
        deepLinks: createDeepLinks(
            'opencode',
            session.sessionId,
            createConversationUiPath('opencode-sessions', session.sessionId),
        ),
        id: session.sessionId,
        matches,
        ...(model ? { model } : {}),
        messageCount: options.includeMessages ? allMessages.length : session.messageCount,
        messages,
        metadata: {
            agent: session.agent,
            cost: session.cost,
            totalTokens: session.totalTokens,
        },
        source: 'opencode',
        title: cleanInlineTitle(session.title),
        updatedAtMs: session.lastUpdatedAtMs,
        workspaceKey: session.workspaceKey,
        workspacePath: session.worktree,
    };
};

const listOpenCodeConversations = async (options: ListConversationsOptions) => {
    if (!options.cwd) {
        return [];
    }

    const dbPath = getDbPath(options);
    const groups = await listOpenCodeWorkspaceGroups(dbPath);
    const conversations: ConversationDetail[] = [];

    for (const group of groups) {
        const match = await getConversationPathMatch(options.cwd, group.worktree);
        if (!match) {
            continue;
        }
        const sessions = await listOpenCodeSessionsForGroup(group.key, dbPath, {
            updatedAfterMs: options.updatedAfterMs,
            updatedBeforeMs: options.updatedBeforeMs,
        });
        conversations.push(
            ...(await mapWithConcurrency(sessions, OPENCODE_CONVERSATION_HYDRATION_CONCURRENCY, (session) =>
                buildConversation(session, dbPath, [match], options),
            )),
        );
    }

    return conversations;
};

const getOpenCodeConversation = async (options: GetConversationOptions): Promise<ConversationDetail | null> => {
    const dbPath = getDbPath(options);
    const transcript = await runWithTranscriptLoadLimit(() => readOpenCodeSessionTranscript(dbPath, options.id), {
        id: options.id,
        integration: 'opencode',
        operation: 'api',
        path: dbPath,
    });
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

const deleteOpenCodeConversation = async (options: DeleteConversationOptions) => {
    const result = await deleteOpenCodeSession(getDbPath(options), options.id);
    return {
        deletedFiles: [],
        deletedIds: result.deletedSessionIds,
    };
};

export const opencodeConversationAdapter: ConversationAdapter = {
    deleteConversation: deleteOpenCodeConversation,
    getConversation: getOpenCodeConversation,
    listConversations: listOpenCodeConversations,
    source: 'opencode',
};
