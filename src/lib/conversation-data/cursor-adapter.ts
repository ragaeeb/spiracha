import { mapWithConcurrency } from '../concurrency';
import {
    getCursorThreadSummaryByComposerId,
    listCursorThreadsForGroup,
    listCursorWorkspaceGroups,
    readCursorThreadTranscriptWithAgentFiles,
} from '../cursor-db';
import type {
    CursorPruneResult,
    CursorThreadSummary,
    CursorThreadTranscript,
    CursorWorkspaceGroup,
} from '../cursor-exporter-types';
import { getCursorGlobalDbPath, resolveCursorUserDir } from '../cursor-exporter-types';
import { collectCursorThreadsForDeletion, isCursorRunning, pruneCursorThreads } from '../cursor-recovery';
import { cleanInlineTitle } from '../shared-text';
import { runWithTranscriptLoadLimit } from '../transcript-load-limiter';
import { createConversationUiPath, createDeepLinks } from './adapter-helpers';
import { cursorBubblesToMessages } from './cursor-message-normalizer';
import { selectConversationMessages } from './message-selector';
import { getFirstConversationPathMatch } from './path-match';
import type {
    ConversationAdapter,
    ConversationDetail,
    ConversationPathMatch,
    DeleteConversationOptions,
    DeleteConversationResult,
    GetConversationOptions,
    ListConversationsOptions,
} from './types';

const CURSOR_CONVERSATION_HYDRATION_CONCURRENCY = 4;

const getUserDir = (options: { locations?: { cursorUserDir?: string } }) =>
    options.locations?.cursorUserDir ?? resolveCursorUserDir();

const transcriptToMessages = (transcript: CursorThreadTranscript) => {
    return cursorBubblesToMessages(transcript.bubbles);
};

const getWorkspacePath = (group: CursorWorkspaceGroup) => {
    return group.folders[0] ?? null;
};

const buildConversation = async (
    thread: CursorThreadSummary,
    group: CursorWorkspaceGroup,
    userDir: string,
    matches: ConversationPathMatch[],
    options: Pick<ListConversationsOptions, 'includeMessages' | 'messageSelector'>,
): Promise<ConversationDetail> => {
    const globalDbPath = getCursorGlobalDbPath(userDir);
    const transcript = options.includeMessages
        ? await runWithTranscriptLoadLimit(
              () => readCursorThreadTranscriptWithAgentFiles(globalDbPath, thread.composerId, userDir),
              {
                  id: thread.composerId,
                  integration: 'cursor',
                  operation: 'api',
                  path: thread.transcriptDirs[0] ?? globalDbPath,
              },
          )
        : null;
    const allMessages = transcript ? transcriptToMessages(transcript) : [];
    const messages = options.includeMessages
        ? selectConversationMessages(allMessages, options.messageSelector ?? 'last_final_answer')
        : [];

    return {
        createdAtMs: thread.createdAtMs,
        deepLinks: createDeepLinks(
            'cursor',
            thread.composerId,
            createConversationUiPath('cursor-threads', thread.composerId),
        ),
        id: thread.composerId,
        matches,
        ...(thread.model ? { model: thread.model } : {}),
        messageCount: options.includeMessages ? allMessages.length : thread.bubbleCount,
        messages,
        metadata: {
            bubbleBytes: thread.bubbleBytes,
            bucketId: thread.bucketId,
            mode: thread.mode,
        },
        source: 'cursor',
        title: cleanInlineTitle(thread.name),
        updatedAtMs: thread.lastUpdatedAtMs,
        workspaceKey: group.key,
        workspacePath: getWorkspacePath(group),
    };
};

const listCursorConversations = async (options: ListConversationsOptions) => {
    if (!options.cwd) {
        return [];
    }

    const userDir = getUserDir(options);
    const groups = await listCursorWorkspaceGroups(userDir);
    const candidates: { group: CursorWorkspaceGroup; match: ConversationPathMatch; thread: CursorThreadSummary }[] = [];

    for (const group of groups) {
        const match = await getFirstConversationPathMatch(options.cwd, group.folders);
        if (!match) {
            continue;
        }
        const threads = await listCursorThreadsForGroup(group, userDir, {
            includeBubbleStats: true,
            includeModelAttribution: true,
            includeTranscriptDirs: false,
            updatedAfterMs: options.updatedAfterMs,
            updatedBeforeMs: options.updatedBeforeMs,
        });
        for (const thread of threads) {
            candidates.push({ group, match, thread });
        }
    }

    return await mapWithConcurrency(candidates, CURSOR_CONVERSATION_HYDRATION_CONCURRENCY, ({ group, match, thread }) =>
        buildConversation(thread, group, userDir, [match], options),
    );
};

const getCursorConversation = async (options: GetConversationOptions): Promise<ConversationDetail | null> => {
    const userDir = getUserDir(options);
    const direct = await getCursorThreadSummaryByComposerId(options.id, userDir, { includeTranscriptDirs: false });
    if (direct) {
        return buildConversation(direct.thread, direct.group, userDir, [], {
            includeMessages: true,
            messageSelector: options.messageSelector ?? 'all',
        });
    }

    return null;
};

export const deleteCursorConversation = async (
    options: DeleteConversationOptions,
    checkCursorRunning: () => Promise<boolean> = isCursorRunning,
) => {
    const userDir = getUserDir(options);
    if (await checkCursorRunning()) {
        throw new Error(
            'Quit Cursor before deleting. It rewrites chat history on exit, which can resurrect deleted threads.',
        );
    }

    const threads = await collectCursorThreadsForDeletion([options.id], userDir);
    if (threads.length === 0) {
        return { deletedFiles: [], deletedIds: [] };
    }
    const result = await pruneCursorThreads(
        threads,
        { apply: true, deleteSessionFiles: options.deleteSessionFiles ?? true },
        userDir,
    );
    return toCursorDeleteConversationResult(result);
};

export const toCursorDeleteConversationResult = (result: CursorPruneResult): DeleteConversationResult => ({
    ...(result.cleanupFailures.length > 0 ? { cleanupFailures: result.cleanupFailures } : {}),
    deletedFiles: result.transcriptDirsRemovedPaths,
    deletedIds: result.composerIds,
});

export const cursorConversationAdapter: ConversationAdapter = {
    deleteConversation: deleteCursorConversation,
    getConversation: getCursorConversation,
    listConversations: listCursorConversations,
    source: 'cursor',
};
