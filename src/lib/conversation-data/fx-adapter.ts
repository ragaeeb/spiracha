import { mapWithConcurrency } from '../concurrency';
import { deleteFxSession, listFxSessionsForGroup, listFxWorkspaceGroups, readFxSessionTranscript } from '../fx-db';
import type { FxSessionSummary, FxSessionTranscript, FxToolCall, FxTranscriptMessage } from '../fx-exporter-types';
import { resolveFxDataDir } from '../fx-exporter-types';
import { getFxMessagePhase } from '../fx-transcript-phase';
import { runWithTranscriptLoadLimit } from '../transcript-load-limiter';
import {
    createConversationUiPath,
    createDeepLinks,
    createTextMessage,
    finalizeMessages,
    isWithinUpdatedWindow,
    normalizeRole,
} from './adapter-helpers';
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

const FX_CONVERSATION_HYDRATION_CONCURRENCY = 4;

const getDataDir = (options: { locations?: { fxDataDir?: string } }) =>
    options.locations?.fxDataDir ?? resolveFxDataDir();

const toolCallToMessages = (
    toolCall: FxToolCall,
    message: FxTranscriptMessage,
    toolIndex: number,
    order: number,
    worktree: string,
): ConversationMessage[] => {
    const id = `${message.messageId}:tool:${toolIndex}`;
    const metadata = { callId: toolCall.callId, status: toolCall.status, toolName: toolCall.toolName };
    const evidence = {
        callId: toolCall.callId,
        command: toolCall.command,
        durationMs: null,
        exitCode: toolCall.status === 'succeeded' ? 0 : toolCall.status === 'failed' ? 1 : null,
        name: toolCall.toolName,
        namespace: null,
        status: toolCall.status,
        workdir: worktree,
    } as const;
    return [
        ...createTextMessage({
            createdAtMs: message.createdAtMs,
            id: `${id}:call`,
            metadata,
            order,
            phase: 'tool_call',
            role: 'tool',
            text: [toolCall.toolName, toolCall.argumentsText].filter(Boolean).join('\n'),
            toolEvidence: { ...evidence, inputText: toolCall.argumentsText, outputText: null },
        }),
        ...createTextMessage({
            createdAtMs: message.createdAtMs,
            id: `${id}:output`,
            metadata,
            order,
            phase: 'tool_output',
            role: 'tool',
            text: toolCall.outputText,
            toolEvidence: { ...evidence, inputText: null, outputText: toolCall.outputText },
        }),
    ];
};

const transcriptMessageToMessages = (
    message: FxTranscriptMessage,
    order: number,
    worktree: string,
): ConversationMessage[] => {
    const metadata = { finishReason: message.finishReason, messageType: message.messageType };
    return [
        ...createTextMessage({
            createdAtMs: message.createdAtMs,
            id: message.messageId,
            metadata,
            order,
            phase: getFxMessagePhase(message) ?? 'unknown',
            role: normalizeRole(message.role),
            text: message.content,
        }),
        ...message.toolCalls.flatMap((toolCall, toolIndex) =>
            toolCallToMessages(toolCall, message, toolIndex, order, worktree),
        ),
    ];
};

const transcriptToMessages = (transcript: FxSessionTranscript) =>
    finalizeMessages(
        transcript.messages.flatMap((message, order) =>
            transcriptMessageToMessages(message, order, transcript.session.worktree),
        ),
    );

const buildConversation = async (
    session: FxSessionSummary,
    dataDir: string,
    matches: ConversationPathMatch[],
    options: Pick<ListConversationsForPathOptions, 'includeMessages' | 'messageSelector'>,
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
    const allMessages = transcript ? transcriptToMessages(transcript) : [];
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

const listFxConversationsForPath = async (options: ListConversationsForPathOptions) => {
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
    listConversationsForPath: listFxConversationsForPath,
    source: 'fx',
};
