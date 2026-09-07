import { mapWithConcurrency } from '../concurrency';
import { deleteFxSession, listFxSessionsForGroup, listFxWorkspaceGroups, readFxSessionTranscript } from '../fx-db';
import type { FxSessionSummary, FxSessionTranscript } from '../fx-exporter-types';
import { resolveFxDataDir } from '../fx-exporter-types';
import { runWithTranscriptLoadLimit } from '../transcript-load-limiter';
import { createConversationUiPath, createDeepLinks, isWithinUpdatedWindow } from './adapter-helpers';
import { normalizeFxTranscript } from './fx-messages';
import { selectConversationMessages } from './message-selector';
import { getConversationPathMatch } from './path-match';
import type {
    ConversationAdapter,
    ConversationDetail,
    ConversationPathMatch,
    DeleteConversationOptions,
    GetConversationOptions,
    ListConversationsOptions,
} from './types';

const FX_CONVERSATION_HYDRATION_CONCURRENCY = 4;

const getDataDir = (options: { locations?: { fxDataDir?: string } }) =>
    options.locations?.fxDataDir ?? resolveFxDataDir();

const buildConversation = async (
    session: FxSessionSummary,
    dataDir: string,
    matches: ConversationPathMatch[],
    options: Pick<ListConversationsOptions, 'includeMessages' | 'messageSelector'>,
    loadedTranscript: FxSessionTranscript | null = null,
): Promise<ConversationDetail> => {
    const transcript =
        loadedTranscript ??
        (options.includeMessages
            ? await runWithTranscriptLoadLimit(
                  () => readFxSessionTranscript(dataDir, session.sessionId, { includeRawPayloads: false }),
                  { id: session.sessionId, integration: 'fx', operation: 'api', path: dataDir },
              )
            : null);
    const allMessages = transcript ? normalizeFxTranscript(transcript) : [];
    const messages = options.includeMessages
        ? selectConversationMessages(allMessages, options.messageSelector ?? 'last_final_answer')
        : [];
    return {
        createdAtMs: session.createdAtMs,
        deepLinks: createDeepLinks('fx', session.sessionId, createConversationUiPath('fx-sessions', session.sessionId)),
        id: session.sessionId,
        matches,
        ...(session.currentModelId ? { model: session.currentModelId } : {}),
        messageCount: options.includeMessages ? allMessages.length : session.messageCount,
        messages,
        metadata: {
            conversationLanguage: session.conversationLanguage,
            currentModelVariant: session.currentModelVariant,
            status: session.status,
            totalInputTokens: session.totalInputTokens,
            totalOutputTokens: session.totalOutputTokens,
        },
        source: 'fx',
        title: session.title,
        updatedAtMs: session.lastActiveAtMs,
        workspaceKey: session.workspaceKey,
        workspacePath: session.worktree,
    };
};

const listFxConversations = async (options: ListConversationsOptions) => {
    if (!options.cwd) {
        return [];
    }

    const dataDir = getDataDir(options);
    const groups = await listFxWorkspaceGroups(dataDir);
    const conversations: ConversationDetail[] = [];
    for (const group of groups) {
        const match = await getConversationPathMatch(options.cwd, group.worktree);
        if (!match) {
            continue;
        }
        const sessions = (await listFxSessionsForGroup(group.key, dataDir)).filter((session) =>
            isWithinUpdatedWindow(session.lastActiveAtMs, options),
        );
        conversations.push(
            ...(await mapWithConcurrency(sessions, FX_CONVERSATION_HYDRATION_CONCURRENCY, (session) =>
                buildConversation(session, dataDir, [match], options),
            )),
        );
    }
    return conversations;
};

const getFxConversation = async (options: GetConversationOptions): Promise<ConversationDetail | null> => {
    const dataDir = getDataDir(options);
    const transcript = await runWithTranscriptLoadLimit(
        () => readFxSessionTranscript(dataDir, options.id, { includeRawPayloads: false }),
        { id: options.id, integration: 'fx', operation: 'api', path: dataDir },
    );
    return transcript
        ? buildConversation(
              transcript.session,
              dataDir,
              [],
              { includeMessages: true, messageSelector: options.messageSelector ?? 'all' },
              transcript,
          )
        : null;
};

const deleteFxConversation = async (options: DeleteConversationOptions) => {
    const result = await deleteFxSession(getDataDir(options), options.id);
    return { deletedFiles: result.deletedFiles, deletedIds: result.deletedSessionIds };
};

export const fxConversationAdapter: ConversationAdapter = {
    deleteConversation: deleteFxConversation,
    getConversation: getFxConversation,
    listConversations: listFxConversations,
    source: 'fx',
};
