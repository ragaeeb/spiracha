import path from 'node:path';
import {
    deleteCommandCodeSession,
    listCommandCodeSessionSummaries,
    readCommandCodeSessionTranscript,
    readCommandCodeSessionTranscriptAtPath,
    resolveCommandCodeProjectsDir,
} from '../command-code-db';
import type { CommandCodeSessionSummary } from '../command-code-exporter-types';
import { createConversationUiPath, createDeepLinks } from './adapter-helpers';
import { selectConversationMessages } from './message-selector';
import { getConversationPathMatch } from './path-match';
import type {
    ConversationAdapter,
    ConversationDetail,
    ConversationPathMatch,
    DeleteConversationOptions,
    GetConversationOptions,
    GetConversationRawOptions,
    ListConversationsOptions,
} from './types';

const getProjectsDir = (options: { locations?: { commandCodeProjectsDir?: string } }) =>
    options.locations?.commandCodeProjectsDir ?? resolveCommandCodeProjectsDir();

const buildConversation = (
    summary: CommandCodeSessionSummary,
    matches: ConversationPathMatch[],
    options: Pick<ListConversationsOptions, 'includeMessages' | 'messageSelector'>,
    messages: ConversationDetail['messages'] = [],
): ConversationDetail => ({
    createdAtMs: summary.createdAtMs,
    deepLinks: createDeepLinks(
        'command-code',
        summary.sessionId,
        createConversationUiPath('command-code-sessions', summary.sessionId),
    ),
    id: summary.sessionId,
    matches,
    ...(summary.model ? { model: summary.model } : {}),
    messageCount: summary.messageCount,
    messages: options.includeMessages
        ? selectConversationMessages(messages, options.messageSelector ?? 'last_final_answer')
        : [],
    metadata: {
        filePath: summary.filePath,
        recordCount: summary.recordCount,
        workspaceKey: summary.workspaceKey,
    },
    source: 'command-code',
    title: summary.title,
    updatedAtMs: summary.lastActiveAtMs,
    workspaceKey: summary.workspaceKey,
    workspacePath: summary.worktree,
});

const listCommandCodeConversations = async (options: ListConversationsOptions) => {
    if (!options.cwd) {
        return [];
    }

    const projectsDir = getProjectsDir(options);
    if (options.includeMessages) {
        const summaries = await listCommandCodeSessionSummaries(projectsDir, options.cwd);
        const conversations: ConversationDetail[] = [];
        for (const summary of summaries) {
            const match = await getConversationPathMatch(options.cwd, summary.worktree);
            if (!match) {
                continue;
            }
            const transcript = await readCommandCodeSessionTranscriptAtPath(summary.filePath);
            if (!transcript) {
                continue;
            }
            conversations.push(buildConversation(summary, [match], options, transcript.messages));
        }
        return conversations;
    }

    const summaries = await listCommandCodeSessionSummaries(projectsDir, options.cwd);
    const conversations: ConversationDetail[] = [];
    for (const summary of summaries) {
        const match = await getConversationPathMatch(options.cwd, summary.worktree);
        if (match) {
            conversations.push(buildConversation(summary, [match], options));
        }
    }
    return conversations;
};

const getCommandCodeConversation = async (options: GetConversationOptions): Promise<ConversationDetail | null> => {
    const transcript = await readCommandCodeSessionTranscript(getProjectsDir(options), options.id);
    return transcript
        ? buildConversation(
              transcript.session,
              [],
              { includeMessages: true, messageSelector: options.messageSelector ?? 'all' },
              transcript.messages,
          )
        : null;
};

const getCommandCodeConversationRaw = async (options: GetConversationRawOptions) => {
    const transcript = await readCommandCodeSessionTranscript(getProjectsDir(options), options.id);
    if (!transcript) {
        return null;
    }

    return {
        blob: Bun.file(transcript.session.filePath),
        fileName: path.basename(transcript.session.filePath),
        mimeType: 'application/x-ndjson' as const,
    };
};

const deleteCommandCodeConversation = async (options: DeleteConversationOptions) => {
    const result = await deleteCommandCodeSession(getProjectsDir(options), options.id);
    return {
        deletedFiles: result.deletedFiles,
        deletedIds: result.deletedSessionIds,
    };
};

export const commandCodeConversationAdapter: ConversationAdapter = {
    deleteConversation: deleteCommandCodeConversation,
    getConversation: getCommandCodeConversation,
    getConversationRaw: getCommandCodeConversationRaw,
    listConversations: listCommandCodeConversations,
    source: 'command-code',
};
