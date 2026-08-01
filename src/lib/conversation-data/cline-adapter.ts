import {
    deleteClineTask,
    listClineTasksForGroup,
    listClineWorkspaceGroups,
    readClineTaskTranscript,
} from '../cline-db';
import type { ClineTaskSummary, ClineTaskTranscript } from '../cline-exporter-types';
import { resolveClineGlobalStorageDir } from '../cline-exporter-types';
import { mapWithConcurrency } from '../concurrency';
import { runWithTranscriptLoadLimit } from '../transcript-load-limiter';
import { createConversationUiPath, createDeepLinks, isWithinUpdatedWindow } from './adapter-helpers';
import { selectConversationMessages } from './message-selector';
import { getConversationPathMatch } from './path-match';
import type {
    ConversationAdapter,
    ConversationDetail,
    ConversationMessage,
    ConversationPathMatch,
    DeleteConversationOptions,
    GetConversationOptions,
    ListConversationsForPathOptions,
} from './types';

const CLINE_CONVERSATION_HYDRATION_CONCURRENCY = 4;

const getGlobalStorageDir = (options: { locations?: { clineGlobalStorageDir?: string } }) =>
    options.locations?.clineGlobalStorageDir ?? resolveClineGlobalStorageDir();

const transcriptToMessages = (transcript: ClineTaskTranscript): ConversationMessage[] =>
    transcript.messages.map((message, order) => ({
        createdAtMs: message.createdAtMs,
        id: message.messageId,
        metadata: {},
        order,
        phase: message.phase,
        role: message.role,
        text: message.text,
        toolEvidence: message.tool
            ? {
                  callId: message.tool.callId,
                  command: message.tool.command,
                  durationMs: null,
                  exitCode: null,
                  inputText: message.tool.inputText,
                  name: message.tool.name,
                  namespace: null,
                  outputText: message.tool.outputText,
                  status: message.tool.status,
                  workdir: message.tool.workdir,
              }
            : null,
    }));

const buildConversation = async (
    task: ClineTaskSummary,
    globalStorageDir: string,
    matches: ConversationPathMatch[],
    options: Pick<ListConversationsForPathOptions, 'includeMessages' | 'messageSelector'>,
    loadedTranscript: ClineTaskTranscript | null = null,
): Promise<ConversationDetail> => {
    const transcript =
        loadedTranscript ??
        (options.includeMessages
            ? await runWithTranscriptLoadLimit(
                  () => readClineTaskTranscript(globalStorageDir, task.taskId, { includeRawPayloads: false }),
                  { id: task.taskId, integration: 'cline', operation: 'api', path: globalStorageDir },
              )
            : null);
    const allMessages = transcript ? transcriptToMessages(transcript) : [];
    return {
        createdAtMs: task.createdAtMs,
        deepLinks: createDeepLinks('cline', task.taskId, createConversationUiPath('cline-tasks', task.taskId)),
        id: task.taskId,
        matches,
        messageCount: options.includeMessages ? allMessages.length : task.messageCount,
        messages: options.includeMessages
            ? selectConversationMessages(allMessages, options.messageSelector ?? 'last_final_answer')
            : [],
        metadata: {
            cacheReads: task.cacheReads,
            cacheWrites: task.cacheWrites,
            isFavorited: task.isFavorited,
            modelId: task.modelId,
            tokensIn: task.tokensIn,
            tokensOut: task.tokensOut,
            totalCost: task.totalCost,
            ulid: task.ulid,
        },
        source: 'cline',
        title: task.title,
        updatedAtMs: task.lastActiveAtMs,
        workspaceKey: task.workspaceKey,
        workspacePath: task.worktree,
    };
};

const listClineConversationsForPath = async (options: ListConversationsForPathOptions) => {
    const globalStorageDir = getGlobalStorageDir(options);
    const groups = await listClineWorkspaceGroups(globalStorageDir);
    const conversations: ConversationDetail[] = [];
    for (const group of groups) {
        const match = await getConversationPathMatch(options.cwd, group.worktree);
        if (!match) {
            continue;
        }
        const tasks = (await listClineTasksForGroup(group.key, globalStorageDir)).filter((task) =>
            isWithinUpdatedWindow(task.lastActiveAtMs, options),
        );
        conversations.push(
            ...(await mapWithConcurrency(tasks, CLINE_CONVERSATION_HYDRATION_CONCURRENCY, (task) =>
                buildConversation(task, globalStorageDir, [match], options),
            )),
        );
    }
    return conversations;
};

const getClineConversation = async (options: GetConversationOptions): Promise<ConversationDetail | null> => {
    const globalStorageDir = getGlobalStorageDir(options);
    const transcript = await runWithTranscriptLoadLimit(
        () => readClineTaskTranscript(globalStorageDir, options.id, { includeRawPayloads: false }),
        { id: options.id, integration: 'cline', operation: 'api', path: globalStorageDir },
    );
    return transcript
        ? buildConversation(
              transcript.task,
              globalStorageDir,
              [],
              { includeMessages: true, messageSelector: options.messageSelector ?? 'all' },
              transcript,
          )
        : null;
};

const deleteClineConversation = async (options: DeleteConversationOptions) => {
    const result = await deleteClineTask(getGlobalStorageDir(options), options.id);
    return { deletedFiles: result.deletedFiles, deletedIds: result.deletedTaskIds };
};

export const clineConversationAdapter: ConversationAdapter = {
    deleteConversation: deleteClineConversation,
    getConversation: getClineConversation,
    listConversationsForPath: listClineConversationsForPath,
    source: 'cline',
};
