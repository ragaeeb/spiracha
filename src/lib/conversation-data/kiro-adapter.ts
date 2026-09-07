import { mapWithConcurrency } from '../concurrency';
import {
    deleteKiroSession,
    findKiroTranscriptPath,
    listKiroSessionsForGroup,
    listKiroWorkspaceGroups,
    readKiroSessionTranscript,
} from '../kiro-db';
import type { KiroSessionSummary, KiroSessionTranscript } from '../kiro-exporter-types';
import { resolveKiroWorkspaceSessionsDir } from '../kiro-exporter-types';
import { normalizeKiroTranscriptEntries } from '../kiro-transcript-parser';
import { cleanInlineTitle } from '../shared-text';
import { runWithTranscriptLoadLimit } from '../transcript-load-limiter';
import { createConversationUiPath, createDeepLinks } from './adapter-helpers';
import { selectConversationMessages } from './message-selector';
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

const KIRO_CONVERSATION_HYDRATION_CONCURRENCY = 4;

const getSessionsDir = (options: { locations?: { kiroWorkspaceSessionsDir?: string } }) =>
    options.locations?.kiroWorkspaceSessionsDir ?? resolveKiroWorkspaceSessionsDir();

const transcriptToMessages = (transcript: KiroSessionTranscript) => normalizeKiroTranscriptEntries(transcript.entries);

const buildConversation = async (
    session: KiroSessionSummary,
    sessionsDir: string,
    matches: ConversationPathMatch[],
    options: Pick<ListConversationsOptions, 'includeMessages' | 'messageSelector'>,
    loadedTranscript: KiroSessionTranscript | null = null,
): Promise<ConversationDetail> => {
    const transcript = options.includeMessages
        ? (loadedTranscript ??
          (await runWithTranscriptLoadLimit(() => readKiroSessionTranscript(sessionsDir, session.sessionId), {
              id: session.sessionId,
              integration: 'kiro',
              operation: 'api',
              path: session.filePath,
          })))
        : null;
    const allMessages = transcript ? transcriptToMessages(transcript) : [];
    const messages = options.includeMessages
        ? selectConversationMessages(allMessages, options.messageSelector ?? 'last_final_answer')
        : [];
    const model = session.selectedModel ?? session.defaultModelTitle ?? undefined;

    return {
        createdAtMs: session.createdAtMs,
        deepLinks: createDeepLinks(
            'kiro',
            session.sessionId,
            createConversationUiPath('kiro-sessions', session.sessionId),
        ),
        id: session.sessionId,
        matches,
        ...(model ? { model } : {}),
        messageCount: options.includeMessages ? allMessages.length : session.messageCount,
        messages,
        metadata: {
            continuationSessionIds: session.continuationSessionIds,
            filePath: session.filePath,
            sessionType: session.sessionType,
        },
        source: 'kiro',
        title: cleanInlineTitle(session.title),
        updatedAtMs: session.lastActiveAtMs,
        workspaceKey: session.workspaceKey,
        workspacePath: session.worktree,
    };
};

const listKiroConversations = async (options: ListConversationsOptions) => {
    if (!options.cwd) {
        return [];
    }

    const sessionsDir = getSessionsDir(options);
    const groups = await listKiroWorkspaceGroups(sessionsDir);
    const conversations: ConversationDetail[] = [];

    for (const group of groups) {
        const match = await getConversationPathMatch(options.cwd, group.worktree);
        if (!match) {
            continue;
        }
        const sessions = await listKiroSessionsForGroup(group.key, sessionsDir, {
            updatedAfterMs: options.updatedAfterMs,
            updatedBeforeMs: options.updatedBeforeMs,
        });
        conversations.push(
            ...(await mapWithConcurrency(sessions, KIRO_CONVERSATION_HYDRATION_CONCURRENCY, (session) =>
                buildConversation(session, sessionsDir, [match], options),
            )),
        );
    }

    return conversations;
};

const getKiroConversation = async (options: GetConversationOptions): Promise<ConversationDetail | null> => {
    const sessionsDir = getSessionsDir(options);
    const transcript = await runWithTranscriptLoadLimit(() => readKiroSessionTranscript(sessionsDir, options.id), {
        id: options.id,
        integration: 'kiro',
        operation: 'api',
        path: sessionsDir,
    });
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

const getKiroConversationRaw = async (options: GetConversationOptions) => {
    const filePath = await findKiroTranscriptPath(getSessionsDir(options), options.id);
    return filePath ? createRawConversationDownload(filePath) : null;
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
    getConversationRaw: getKiroConversationRaw,
    listConversations: listKiroConversations,
    source: 'kiro',
};
