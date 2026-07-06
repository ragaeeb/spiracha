import { mapWithConcurrency } from '../concurrency';
import {
    listCursorThreadsForGroup,
    listCursorWorkspaceGroups,
    readCursorThreadTranscriptWithAgentFiles,
} from '../cursor-db';
import type {
    CursorBubble,
    CursorThreadSummary,
    CursorThreadTranscript,
    CursorWorkspaceGroup,
} from '../cursor-exporter-types';
import { getCursorGlobalDbPath, resolveCursorUserDir } from '../cursor-exporter-types';
import { collectCursorThreadsForDeletion, isCursorRunning, pruneCursorThreads } from '../cursor-recovery';
import { cleanInlineTitle } from '../shared';
import { createDeepLinks, createTextMessage, finalizeMessages } from './adapter-helpers';
import { selectConversationMessages } from './message-selector';
import { getFirstConversationPathMatch } from './path-match';
import type {
    ConversationAdapter,
    ConversationDetail,
    ConversationMessage,
    ConversationPathMatch,
    DeleteConversationOptions,
    GetConversationOptions,
    ListConversationsForPathOptions,
} from './types';

const CURSOR_CONVERSATION_HYDRATION_CONCURRENCY = 4;

const getUserDir = (options: { locations?: { cursorUserDir?: string } }) =>
    options.locations?.cursorUserDir ?? resolveCursorUserDir();

const isWithinUpdatedWindow = (
    thread: CursorThreadSummary,
    options: Pick<ListConversationsForPathOptions, 'updatedAfterMs' | 'updatedBeforeMs'>,
): boolean => {
    const updatedAtMs = thread.lastUpdatedAtMs ?? 0;
    if (options.updatedAfterMs !== undefined && updatedAtMs < options.updatedAfterMs) {
        return false;
    }
    if (options.updatedBeforeMs !== undefined && updatedAtMs > options.updatedBeforeMs) {
        return false;
    }
    return true;
};

const bubbleToMessages = (bubble: CursorBubble, order: number): ConversationMessage[] => {
    const thinking = createTextMessage({
        createdAtMs: bubble.createdAtMs,
        id: `${bubble.bubbleId}:thinking`,
        order,
        phase: 'reasoning',
        role: 'assistant',
        text: bubble.thinking,
    });
    const text = createTextMessage({
        createdAtMs: bubble.createdAtMs,
        id: bubble.bubbleId,
        order,
        phase: bubble.kind === 'assistant' ? 'final_answer' : 'unknown',
        role: bubble.kind === 'assistant' ? 'assistant' : bubble.kind === 'user' ? 'user' : 'unknown',
        text: bubble.text,
    });
    const tool = bubble.toolCall
        ? createTextMessage({
              createdAtMs: bubble.createdAtMs,
              id: `${bubble.bubbleId}:tool`,
              metadata: { callId: bubble.toolCall.callId, status: bubble.toolCall.status },
              order,
              phase: bubble.toolCall.resultText ? 'tool_output' : 'tool_call',
              role: 'tool',
              text: bubble.toolCall.resultText ?? bubble.toolCall.argumentsText ?? bubble.toolCall.name,
          })
        : [];

    return [...thinking, ...text, ...tool];
};

const transcriptToMessages = (transcript: CursorThreadTranscript) => {
    return finalizeMessages(transcript.bubbles.flatMap((bubble, order) => bubbleToMessages(bubble, order)));
};

const getWorkspacePath = (group: CursorWorkspaceGroup) => {
    return group.folders[0] ?? null;
};

const buildConversation = async (
    thread: CursorThreadSummary,
    group: CursorWorkspaceGroup,
    userDir: string,
    matches: ConversationPathMatch[],
    options: Pick<ListConversationsForPathOptions, 'includeMessages' | 'messageSelector'>,
): Promise<ConversationDetail> => {
    const transcript = options.includeMessages
        ? await readCursorThreadTranscriptWithAgentFiles(getCursorGlobalDbPath(userDir), thread.composerId, userDir)
        : null;
    const allMessages = transcript ? transcriptToMessages(transcript) : [];
    const messages = options.includeMessages
        ? selectConversationMessages(allMessages, options.messageSelector ?? 'last_final_answer')
        : [];

    return {
        createdAtMs: thread.createdAtMs,
        deepLinks: createDeepLinks('cursor', thread.composerId, `/cursor-threads/${thread.composerId}`),
        id: thread.composerId,
        matches,
        messageCount: options.includeMessages ? allMessages.length : thread.bubbleCount,
        messages,
        metadata: {
            bubbleBytes: thread.bubbleBytes,
            bucketId: thread.bucketId,
            mode: thread.mode,
            transcriptDirs: thread.transcriptDirs,
        },
        source: 'cursor',
        title: cleanInlineTitle(thread.name),
        updatedAtMs: thread.lastUpdatedAtMs,
        workspaceKey: group.key,
        workspacePath: getWorkspacePath(group),
    };
};

const listCursorConversationsForPath = async (options: ListConversationsForPathOptions) => {
    const userDir = getUserDir(options);
    const groups = await listCursorWorkspaceGroups(userDir, { updatedAfterMs: options.updatedAfterMs });
    const candidates: { group: CursorWorkspaceGroup; match: ConversationPathMatch; thread: CursorThreadSummary }[] = [];

    for (const group of groups) {
        const match = await getFirstConversationPathMatch(options.cwd, group.folders);
        if (!match) {
            continue;
        }
        const threads = await listCursorThreadsForGroup(group, userDir, {
            includeTranscriptDirs: false,
            updatedAfterMs: options.updatedAfterMs,
        });
        for (const thread of threads) {
            if (!isWithinUpdatedWindow(thread, options)) {
                continue;
            }

            candidates.push({ group, match, thread });
        }
    }

    return await mapWithConcurrency(candidates, CURSOR_CONVERSATION_HYDRATION_CONCURRENCY, ({ group, match, thread }) =>
        buildConversation(thread, group, userDir, [match], options),
    );
};

const getCursorConversation = async (options: GetConversationOptions): Promise<ConversationDetail | null> => {
    const userDir = getUserDir(options);
    const groups = await listCursorWorkspaceGroups(userDir);
    for (const group of groups) {
        const threads = await listCursorThreadsForGroup(group, userDir, { includeTranscriptDirs: false });
        const thread = threads.find((entry) => entry.composerId === options.id);
        if (thread) {
            return buildConversation(thread, group, userDir, [], {
                includeMessages: true,
                messageSelector: options.messageSelector ?? 'all',
            });
        }
    }

    return null;
};

const deleteCursorConversation = async (options: DeleteConversationOptions) => {
    const userDir = getUserDir(options);
    if (!options.locations?.cursorUserDir && (await isCursorRunning())) {
        throw new Error(
            'Quit Cursor before deleting. It rewrites chat history on exit, which can resurrect deleted threads.',
        );
    }

    const existing = await getCursorConversation(options);
    if (!existing) {
        return { deletedFiles: [], deletedIds: [] };
    }

    const threads = await collectCursorThreadsForDeletion([options.id], userDir);
    const deletedFiles = threads.flatMap((thread) => thread.transcriptDirs);
    const result = await pruneCursorThreads(threads, true, userDir);
    return {
        deletedFiles,
        deletedIds: result.composerIds,
    };
};

export const cursorConversationAdapter: ConversationAdapter = {
    deleteConversation: deleteCursorConversation,
    getConversation: getCursorConversation,
    listConversationsForPath: listCursorConversationsForPath,
    source: 'cursor',
};
