import { mapWithConcurrency } from '../concurrency';
import {
    deleteMiniMaxCodeSession,
    listMiniMaxCodeSessionsForGroup,
    listMiniMaxCodeWorkspaceGroups,
    readMiniMaxCodeSessionTranscript,
} from '../minimax-code-db';
import type { MiniMaxCodeSessionSummary, MiniMaxCodeSessionTranscript } from '../minimax-code-exporter-types';
import { resolveMiniMaxCodeRuntimeDbPath, resolveMiniMaxCodeSessionsDir } from '../minimax-code-exporter-types';
import { runWithTranscriptLoadLimit } from '../transcript-load-limiter';
import { createConversationUiPath, createDeepLinks, isWithinUpdatedWindow } from './adapter-helpers';
import { selectConversationMessages } from './message-selector';
import { normalizeMiniMaxCodeTranscript } from './minimax-code-messages';
import { getConversationPathMatch } from './path-match';
import { createRawConversationDownload } from './raw-download';
import type {
    ConversationAdapter,
    ConversationDetail,
    ConversationPathMatch,
    DeleteConversationOptions,
    GetConversationOptions,
    ListConversationsOptions,
} from './types';

const MINIMAX_CODE_CONVERSATION_HYDRATION_CONCURRENCY = 4;

const getSessionsDir = (options: { locations?: { minimaxCodeSessionsDir?: string } }) =>
    options.locations?.minimaxCodeSessionsDir ?? resolveMiniMaxCodeSessionsDir();

const getRuntimeDbPath = (options: { locations?: { minimaxCodeRuntimeDbPath?: string } }, sessionsDir: string) =>
    options.locations?.minimaxCodeRuntimeDbPath ?? resolveMiniMaxCodeRuntimeDbPath(sessionsDir);

const buildConversation = async (
    session: MiniMaxCodeSessionSummary,
    sessionsDir: string,
    matches: ConversationPathMatch[],
    options: Pick<ListConversationsOptions, 'includeMessages' | 'messageSelector'>,
    loadedTranscript: MiniMaxCodeSessionTranscript | null = null,
): Promise<ConversationDetail> => {
    const transcript =
        loadedTranscript ??
        (options.includeMessages
            ? await runWithTranscriptLoadLimit(
                  () => readMiniMaxCodeSessionTranscript(sessionsDir, session.sessionId, { includeRawPayloads: false }),
                  {
                      id: session.sessionId,
                      integration: 'minimax-code',
                      operation: 'api',
                      path: sessionsDir,
                  },
              )
            : null);
    const allMessages = transcript ? normalizeMiniMaxCodeTranscript(transcript) : [];
    const messages = options.includeMessages
        ? selectConversationMessages(allMessages, options.messageSelector ?? 'last_final_answer')
        : [];
    return {
        createdAtMs: session.createdAtMs,
        deepLinks: createDeepLinks(
            'minimax-code',
            session.sessionId,
            createConversationUiPath('minimax-code-sessions', session.sessionId),
        ),
        id: session.sessionId,
        matches,
        ...(session.currentModelId ? { model: session.currentModelId } : {}),
        messageCount: options.includeMessages ? allMessages.length : session.messageCount,
        messages,
        metadata: {
            agentName: session.agentName,
            appMode: session.appMode,
            currentModelVariant: session.currentModelVariant,
            runtime: session.runtime,
            sessionType: session.sessionType,
            status: session.status,
        },
        source: 'minimax-code',
        title: session.title,
        updatedAtMs: session.lastActiveAtMs,
        workspaceKey: session.workspaceKey,
        workspacePath: session.worktree,
    };
};

const listMiniMaxCodeConversations = async (options: ListConversationsOptions) => {
    if (!options.cwd) {
        return [];
    }

    const sessionsDir = getSessionsDir(options);
    const groups = await listMiniMaxCodeWorkspaceGroups(sessionsDir);
    const conversations: ConversationDetail[] = [];
    for (const group of groups) {
        const match = await getConversationPathMatch(options.cwd, group.worktree);
        if (!match) {
            continue;
        }
        const sessions = (await listMiniMaxCodeSessionsForGroup(group.key, sessionsDir)).filter((session) =>
            isWithinUpdatedWindow(session.lastActiveAtMs, options),
        );
        conversations.push(
            ...(await mapWithConcurrency(sessions, MINIMAX_CODE_CONVERSATION_HYDRATION_CONCURRENCY, (session) =>
                buildConversation(session, sessionsDir, [match], options),
            )),
        );
    }
    return conversations;
};

const getMiniMaxCodeConversation = async (options: GetConversationOptions): Promise<ConversationDetail | null> => {
    const sessionsDir = getSessionsDir(options);
    const transcript = await runWithTranscriptLoadLimit(
        () => readMiniMaxCodeSessionTranscript(sessionsDir, options.id, { includeRawPayloads: false }),
        {
            id: options.id,
            integration: 'minimax-code',
            operation: 'api',
            path: sessionsDir,
        },
    );
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

const getMiniMaxCodeConversationRaw = async (options: GetConversationOptions) => {
    const transcript = await readMiniMaxCodeSessionTranscript(getSessionsDir(options), options.id, {
        includeRawPayloads: false,
    });
    return transcript ? createRawConversationDownload(transcript.session.snapshotPath) : null;
};

const deleteMiniMaxCodeConversation = async (options: DeleteConversationOptions) => {
    const sessionsDir = getSessionsDir(options);
    const result = await deleteMiniMaxCodeSession(sessionsDir, getRuntimeDbPath(options, sessionsDir), options.id);
    return {
        deletedFiles: result.deletedFiles,
        deletedIds: result.deletedSessionIds,
    };
};

export const minimaxCodeConversationAdapter: ConversationAdapter = {
    deleteConversation: deleteMiniMaxCodeConversation,
    getConversation: getMiniMaxCodeConversation,
    getConversationRaw: getMiniMaxCodeConversationRaw,
    listConversations: listMiniMaxCodeConversations,
    source: 'minimax-code',
};
