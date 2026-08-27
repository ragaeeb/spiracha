import path from 'node:path';
import {
    createClineTranscriptCache,
    deleteClineTask,
    listClineTasksForGroup,
    listClineWorkspaceGroups,
    readClineTaskTranscript,
} from '../cline-db';
import type { ClineTaskSummary, ClineTaskTranscript } from '../cline-exporter-types';
import { isSafeClineSessionId, resolveClineDataDir } from '../cline-exporter-types';
import { mapWithConcurrency } from '../concurrency';
import { runWithTranscriptLoadLimit } from '../transcript-load-limiter';
import { createConversationUiPath, createDeepLinks, isWithinUpdatedWindow } from './adapter-helpers';
import { selectConversationMessages } from './message-selector';
import { getConversationPathMatch } from './path-match';
import { createRawConversationDownload } from './raw-download';
import type {
    ConversationAdapter,
    ConversationDataLocations,
    ConversationDetail,
    ConversationMessage,
    ConversationPathMatch,
    DeleteConversationOptions,
    GetConversationOptions,
    ListConversationsForPathOptions,
} from './types';

const CLINE_CONVERSATION_HYDRATION_CONCURRENCY = 4;

const getDataDir = (options: { locations?: ConversationDataLocations }) =>
    options.locations?.clineDataDir ?? resolveClineDataDir();

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
    dataDir: string,
    matches: ConversationPathMatch[],
    options: Pick<ListConversationsForPathOptions, 'includeMessages' | 'messageSelector'>,
    loadedTranscript: ClineTaskTranscript | null = null,
): Promise<ConversationDetail> => {
    const transcript =
        loadedTranscript ??
        (options.includeMessages
            ? await runWithTranscriptLoadLimit(
                  () => readClineTaskTranscript(dataDir, task.taskId, { includeRawPayloads: false }),
                  { id: task.taskId, integration: 'cline', operation: 'api', path: dataDir },
              )
            : null);
    const allMessages = transcript ? transcriptToMessages(transcript) : [];
    return {
        createdAtMs: task.createdAtMs,
        deepLinks: createDeepLinks('cline', task.taskId, createConversationUiPath('cline-tasks', task.taskId)),
        id: task.taskId,
        matches,
        ...(task.modelId ? { model: task.modelId } : {}),
        messageCount: options.includeMessages ? allMessages.length : task.messageCount,
        messages: options.includeMessages
            ? selectConversationMessages(allMessages, options.messageSelector ?? 'last_final_answer')
            : [],
        metadata: {
            cacheReads: task.cacheReads,
            cacheWrites: task.cacheWrites,
            isFavorited: task.isFavorited,
            tokensIn: task.tokensIn,
            tokensOut: task.tokensOut,
            totalCost: task.totalCost,
            ulid: task.ulid,
        },
        source: 'cline',
        title: task.title,
        updatedAtMs: task.lastActiveAtMs,
        workspaceKey: task.workspaceKey,
        workspacePath: task.workspaceSource === 'session_directory' ? null : task.worktree,
    };
};

const listClineConversationsForPath = async (options: ListConversationsForPathOptions) => {
    const dataDir = getDataDir(options);
    const transcriptCache = createClineTranscriptCache(dataDir);
    const groups = await listClineWorkspaceGroups(dataDir, transcriptCache);
    const conversations: ConversationDetail[] = [];
    for (const group of groups) {
        const match = await getConversationPathMatch(options.cwd, group.worktree);
        if (!match) {
            continue;
        }
        const tasks = (await listClineTasksForGroup(group.key, dataDir, transcriptCache)).filter((task) =>
            isWithinUpdatedWindow(task.lastActiveAtMs, options),
        );
        conversations.push(
            ...(await mapWithConcurrency(tasks, CLINE_CONVERSATION_HYDRATION_CONCURRENCY, (task) =>
                buildConversation(task, dataDir, [match], options),
            )),
        );
    }
    return conversations;
};

const getClineConversation = async (options: GetConversationOptions): Promise<ConversationDetail | null> => {
    const dataDir = getDataDir(options);
    const transcript = await runWithTranscriptLoadLimit(
        () => readClineTaskTranscript(dataDir, options.id, { includeRawPayloads: false }),
        { id: options.id, integration: 'cline', operation: 'api', path: dataDir },
    );
    return transcript
        ? buildConversation(
              transcript.task,
              dataDir,
              [],
              { includeMessages: true, messageSelector: options.messageSelector ?? 'all' },
              transcript,
          )
        : null;
};

const getClineConversationRaw = async (options: GetConversationOptions) => {
    return isSafeClineSessionId(options.id)
        ? createRawConversationDownload(
              path.join(getDataDir(options), 'sessions', options.id, `${options.id}.messages.json`),
          )
        : null;
};

const deleteClineConversation = async (options: DeleteConversationOptions) => {
    const result = await deleteClineTask(getDataDir(options), options.id);
    return { deletedFiles: result.deletedFiles, deletedIds: result.deletedTaskIds };
};

export const clineConversationAdapter: ConversationAdapter = {
    deleteConversation: deleteClineConversation,
    getConversation: getClineConversation,
    getConversationRaw: getClineConversationRaw,
    listConversationsForPath: listClineConversationsForPath,
    source: 'cline',
};
