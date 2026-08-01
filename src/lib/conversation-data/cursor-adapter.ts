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
import { getCursorTextBubblePhase, getFinalCursorAssistantTextBubbleIds } from '../cursor-transcript-phase';
import { cleanInlineTitle } from '../shared';
import { runWithTranscriptLoadLimit } from '../transcript-load-limiter';
import {
    createConversationUiPath,
    createDeepLinks,
    createTextMessage,
    finalizeMessages,
    isWithinUpdatedWindow,
    normalizeToolStatus,
} from './adapter-helpers';
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

const bubbleToMessages = (
    bubble: CursorBubble,
    finalAssistantTextBubbleIds: Set<string>,
    order: number,
): ConversationMessage[] => {
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
        phase: getCursorTextBubblePhase(bubble, finalAssistantTextBubbleIds) ?? 'unknown',
        role: bubble.kind === 'assistant' ? 'assistant' : bubble.kind === 'user' ? 'user' : 'unknown',
        text: bubble.text,
    });
    const toolCall = bubble.toolCall
        ? createTextMessage({
              createdAtMs: bubble.createdAtMs,
              id: `${bubble.bubbleId}:tool_call`,
              metadata: { callId: bubble.toolCall.callId, status: bubble.toolCall.status },
              order,
              phase: 'tool_call',
              role: 'tool',
              text: [bubble.toolCall.name, bubble.toolCall.argumentsText].filter(Boolean).join('\n'),
              toolEvidence: {
                  callId: bubble.toolCall.callId,
                  command: null,
                  durationMs: null,
                  exitCode: null,
                  inputText: bubble.toolCall.argumentsText,
                  name: bubble.toolCall.name,
                  namespace: bubble.toolCall.name.includes('.') ? (bubble.toolCall.name.split('.')[0] ?? null) : null,
                  outputText: null,
                  status: normalizeToolStatus(bubble.toolCall.status),
                  workdir: null,
              },
          })
        : [];
    const toolOutput = bubble.toolCall
        ? createTextMessage({
              createdAtMs: bubble.createdAtMs,
              id: `${bubble.bubbleId}:tool_output`,
              metadata: { callId: bubble.toolCall.callId, status: bubble.toolCall.status },
              order,
              phase: 'tool_output',
              role: 'tool',
              text: bubble.toolCall.resultText,
              toolEvidence: {
                  callId: bubble.toolCall.callId,
                  command: null,
                  durationMs: null,
                  exitCode: null,
                  inputText: null,
                  name: bubble.toolCall.name,
                  namespace: bubble.toolCall.name.includes('.') ? (bubble.toolCall.name.split('.')[0] ?? null) : null,
                  outputText: bubble.toolCall.resultText,
                  status: normalizeToolStatus(bubble.toolCall.status),
                  workdir: null,
              },
          })
        : [];

    return [...thinking, ...text, ...toolCall, ...toolOutput];
};

const transcriptToMessages = (transcript: CursorThreadTranscript) => {
    const finalAssistantTextBubbleIds = getFinalCursorAssistantTextBubbleIds(transcript.bubbles);
    return finalizeMessages(
        transcript.bubbles.flatMap((bubble, order) => bubbleToMessages(bubble, finalAssistantTextBubbleIds, order)),
    );
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

const listCursorConversationsForPath = async (options: ListConversationsForPathOptions) => {
    const userDir = getUserDir(options);
    const groups = await listCursorWorkspaceGroups(userDir);
    const candidates: { group: CursorWorkspaceGroup; match: ConversationPathMatch; thread: CursorThreadSummary }[] = [];

    for (const group of groups) {
        const match = await getFirstConversationPathMatch(options.cwd, group.folders);
        if (!match) {
            continue;
        }
        const threads = await listCursorThreadsForGroup(group, userDir, {
            includeTranscriptDirs: false,
        });
        for (const thread of threads) {
            if (!isWithinUpdatedWindow(thread.lastUpdatedAtMs, options)) {
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
