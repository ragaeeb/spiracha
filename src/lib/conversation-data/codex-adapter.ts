import { getThreadBrowseData, listCodexThreadsForPath } from '../codex-browser-queries';
import type { ThreadBrowseData } from '../codex-browser-types';
import { CodexThreadNotFoundError, resolveCodexThreadDbPath } from '../codex-database';
import { deleteCodexThread } from '../codex-thread-mutations';
import { parseCodexTranscriptFile } from '../codex-thread-parser';
import type { ThreadRow } from '../codex-thread-types';
import { cleanInlineTitle } from '../shared-text';
import { runWithTranscriptLoadLimit } from '../transcript-load-limiter';
import { createConversationUiPath, createDeepLinks } from './adapter-helpers';
import { normalizeCodexEvents } from './codex-messages';
import { selectConversationMessages } from './message-selector';
import { getConversationPathMatch } from './path-match';
import { createRawConversationDownload } from './raw-download';
import type {
    ConversationAdapter,
    ConversationDetail,
    ConversationMessage,
    ConversationPathMatch,
    DeleteConversationOptions,
    GetConversationOptions,
    ListConversationsOptions,
} from './types';

const getCodexDbPath = (options: { locations?: { codexDbPath?: string } }) => {
    return options.locations?.codexDbPath ?? resolveCodexThreadDbPath();
};

const toTimestampMs = (thread: ThreadRow) => {
    return thread.updated_at_ms ?? thread.updated_at * 1000;
};

const toCreatedAtMs = (thread: ThreadRow) => {
    return thread.created_at_ms ?? thread.created_at * 1000;
};

const readCodexMessages = async (thread: ThreadRow): Promise<ConversationMessage[]> => {
    let transcript: Awaited<ReturnType<typeof parseCodexTranscriptFile>>;
    try {
        transcript = await runWithTranscriptLoadLimit(
            () =>
                parseCodexTranscriptFile(thread.rollout_path, {
                    includeRaw: false,
                }),
            {
                id: thread.id,
                integration: 'codex',
                operation: 'api',
                path: thread.rollout_path,
            },
        );
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            return [];
        }

        throw error;
    }

    return normalizeCodexEvents(transcript.events);
};

const buildCodexConversation = async (
    thread: ThreadRow,
    matches: ConversationPathMatch[],
    options: { includeMessages: boolean; messageSelector: ListConversationsOptions['messageSelector'] },
): Promise<ConversationDetail> => {
    const allMessages = options.includeMessages ? await readCodexMessages(thread) : [];
    const messages = options.includeMessages
        ? selectConversationMessages(allMessages, options.messageSelector ?? 'last_final_answer')
        : [];

    return {
        createdAtMs: toCreatedAtMs(thread),
        deepLinks: createDeepLinks(
            'codex',
            thread.id,
            createConversationUiPath('threads', thread.id),
            `codex://threads/${encodeURIComponent(thread.id)}`,
        ),
        id: thread.id,
        matches,
        ...(thread.model ? { model: thread.model } : {}),
        messageCount: options.includeMessages ? allMessages.length : null,
        messages,
        metadata: {
            agentNickname: thread.agent_nickname,
            agentPath: thread.agent_path,
            agentRole: thread.agent_role,
            archived: Boolean(thread.archived),
            cliVersion: thread.cli_version,
            modelProvider: thread.model_provider,
            tokensUsed: thread.tokens_used,
        },
        source: 'codex',
        title: cleanInlineTitle(thread.title || thread.first_user_message || thread.id),
        updatedAtMs: toTimestampMs(thread),
        workspaceKey: thread.cwd ? `folder:${thread.cwd}` : null,
        workspacePath: thread.cwd || null,
    };
};

const filterThreadsForPath = async (
    threads: ThreadRow[],
    cwd: string,
): Promise<Array<{ matches: ConversationPathMatch[]; thread: ThreadRow }>> => {
    const filtered: Array<{ matches: ConversationPathMatch[]; thread: ThreadRow }> = [];
    for (const thread of threads) {
        const match = await getConversationPathMatch(cwd, thread.cwd);
        if (match) {
            filtered.push({ matches: [match], thread });
        }
    }

    return filtered;
};

const listCodexConversations = async (options: ListConversationsOptions): Promise<ConversationDetail[]> => {
    if (!options.cwd) {
        return [];
    }

    const dbPath = getCodexDbPath(options);
    if (!(await Bun.file(dbPath).exists())) {
        return [];
    }
    const threads = await listCodexThreadsForPath(dbPath, options.cwd, {
        updatedAfterMs: options.updatedAfterMs,
        updatedBeforeMs: options.updatedBeforeMs,
    });
    const matchedThreads = await filterThreadsForPath(threads, options.cwd);

    return Promise.all(
        matchedThreads.map(({ matches, thread }) =>
            buildCodexConversation(thread, matches, {
                includeMessages: options.includeMessages ?? false,
                messageSelector: options.messageSelector,
            }),
        ),
    );
};

const getCodexConversation = async (options: GetConversationOptions): Promise<ConversationDetail | null> => {
    const dbPath = getCodexDbPath(options);
    let browseData: ThreadBrowseData;
    try {
        browseData = await getThreadBrowseData(dbPath, options.id);
    } catch (error) {
        if (error instanceof CodexThreadNotFoundError) {
            return null;
        }

        throw error;
    }

    return buildCodexConversation(browseData.thread, [], {
        includeMessages: true,
        messageSelector: options.messageSelector ?? 'all',
    });
};

const getCodexConversationRaw = async (options: GetConversationOptions) => {
    const dbPath = getCodexDbPath(options);
    try {
        return createRawConversationDownload((await getThreadBrowseData(dbPath, options.id)).thread.rollout_path);
    } catch (error) {
        if (error instanceof CodexThreadNotFoundError) {
            return null;
        }
        throw error;
    }
};

const deleteCodexConversation = async (options: DeleteConversationOptions) => {
    const result = await deleteCodexThread(getCodexDbPath(options), options.id, { deleteSessionFiles: true });
    return {
        deletedFiles: result.deletedSessionFiles,
        deletedIds: result.deletedThreadIds,
    };
};

export const codexConversationAdapter: ConversationAdapter = {
    deleteConversation: deleteCodexConversation,
    getConversation: getCodexConversation,
    getConversationRaw: getCodexConversationRaw,
    listConversations: listCodexConversations,
    source: 'codex',
};
