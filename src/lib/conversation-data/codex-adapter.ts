import {
    deleteCodexThread,
    getThreadBrowseData,
    listScopedThreads,
    resolveCodexThreadDbPath,
} from '../codex-browser-db';
import type { MessageEvent, ThreadBrowseData, ThreadEvent } from '../codex-browser-types';
import { parseCodexTranscriptFile } from '../codex-thread-parser';
import type { ThreadRow } from '../codex-thread-types';
import { cleanInlineTitle } from '../shared';
import { runWithTranscriptLoadLimit } from '../transcript-load-limiter';
import { createDeepLinks, finalizeMessages, normalizeRole, toDateMs } from './adapter-helpers';
import { selectConversationMessages } from './message-selector';
import { getConversationPathMatch } from './path-match';
import type {
    ConversationAdapter,
    ConversationDetail,
    ConversationMessage,
    ConversationMessagePhase,
    ConversationPathMatch,
    DeleteConversationOptions,
    GetConversationOptions,
    ListConversationsForPathOptions,
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

const normalizeMessagePhase = (event: MessageEvent): ConversationMessagePhase => {
    if (event.role !== 'assistant') {
        return 'unknown';
    }

    if (event.phase === 'final_answer' || event.phase === 'final') {
        return 'final_answer';
    }

    if (event.phase === 'commentary' || event.isHiddenByDefault) {
        return 'commentary';
    }

    return 'unknown';
};

const toMessageEventMessage = (event: MessageEvent): ConversationMessage | null => {
    const text = event.text.trim();
    if (!text) {
        return null;
    }

    return {
        createdAtMs: toDateMs(event.timestamp),
        id: `codex:${event.sequence}`,
        metadata: {
            model: event.model,
            variant: event.variant,
        },
        order: event.sequence,
        phase: normalizeMessagePhase(event),
        role: normalizeRole(event.role),
        text,
    };
};

const toToolMessage = (event: ThreadEvent): ConversationMessage | null => {
    if (event.kind === 'tool_call') {
        return {
            createdAtMs: toDateMs(event.timestamp),
            id: `codex:${event.sequence}`,
            metadata: {
                callId: event.callId,
                command: event.command,
                name: event.name,
                workdir: event.workdir,
            },
            order: event.sequence,
            phase: 'tool_call',
            role: 'tool',
            text: event.command ?? event.name,
        };
    }

    if (event.kind === 'tool_output') {
        const text = event.summary || event.outputText;
        return {
            createdAtMs: toDateMs(event.timestamp),
            id: `codex:${event.sequence}`,
            metadata: {
                callId: event.callId,
                exitCode: event.exitCode,
                wallTime: event.wallTime,
            },
            order: event.sequence,
            phase: 'tool_output',
            role: 'tool',
            text,
        };
    }

    return null;
};

const toConversationMessage = (event: ThreadEvent): ConversationMessage | null => {
    if (event.kind === 'message') {
        return toMessageEventMessage(event);
    }

    if (event.kind === 'reasoning') {
        const text = event.summary.join('\n').trim();
        return text
            ? {
                  createdAtMs: toDateMs(event.timestamp),
                  id: `codex:${event.sequence}`,
                  metadata: {
                      hasEncryptedContent: event.hasEncryptedContent,
                  },
                  order: event.sequence,
                  phase: 'reasoning',
                  role: 'assistant',
                  text,
              }
            : null;
    }

    return toToolMessage(event);
};

const readCodexMessages = async (thread: ThreadRow): Promise<ConversationMessage[]> => {
    const transcript = await runWithTranscriptLoadLimit(
        () =>
            parseCodexTranscriptFile(thread.rollout_path, {
                includeRaw: false,
            }),
        {
            id: thread.id,
            path: thread.rollout_path,
            source: 'codex-api',
        },
    );

    return finalizeMessages(
        transcript.events.flatMap((event) => {
            const message = toConversationMessage(event);
            return message ? [message] : [];
        }),
    );
};

const buildCodexConversation = async (
    thread: ThreadRow,
    matches: ConversationPathMatch[],
    options: { includeMessages: boolean; messageSelector: ListConversationsForPathOptions['messageSelector'] },
): Promise<ConversationDetail> => {
    const allMessages = options.includeMessages ? await readCodexMessages(thread) : [];
    const messages = options.includeMessages
        ? selectConversationMessages(allMessages, options.messageSelector ?? 'last_final_answer')
        : [];

    return {
        createdAtMs: toCreatedAtMs(thread),
        deepLinks: createDeepLinks('codex', thread.id, `/threads/${thread.id}`, `codex://threads/${thread.id}`),
        id: thread.id,
        matches,
        messageCount: options.includeMessages ? allMessages.length : null,
        messages,
        metadata: {
            agentNickname: thread.agent_nickname,
            agentPath: thread.agent_path,
            agentRole: thread.agent_role,
            archived: Boolean(thread.archived),
            cliVersion: thread.cli_version,
            model: thread.model,
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

const listCodexConversationsForPath = async (
    options: ListConversationsForPathOptions,
): Promise<ConversationDetail[]> => {
    const dbPath = getCodexDbPath(options);
    const threads = listScopedThreads(dbPath, null);
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
        browseData = getThreadBrowseData(dbPath, options.id);
    } catch (error) {
        if (error instanceof Error && /not found/i.test(error.message)) {
            return null;
        }

        throw error;
    }

    return buildCodexConversation(browseData.thread, [], {
        includeMessages: true,
        messageSelector: options.messageSelector ?? 'all',
    });
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
    listConversationsForPath: listCodexConversationsForPath,
    source: 'codex',
};
