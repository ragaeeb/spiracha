import { mapWithConcurrency } from '../concurrency';
import {
    listMiniMaxCodeSessionsForGroup,
    listMiniMaxCodeWorkspaceGroups,
    readMiniMaxCodeSessionTranscript,
} from '../minimax-code-db';
import type {
    MiniMaxCodeSessionSummary,
    MiniMaxCodeSessionTranscript,
    MiniMaxCodeToolCall,
    MiniMaxCodeTranscriptMessage,
} from '../minimax-code-exporter-types';
import { resolveMiniMaxCodeSessionsDir } from '../minimax-code-exporter-types';
import { getMiniMaxCodeMessagePhase } from '../minimax-code-transcript-phase';
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
    GetConversationOptions,
    ListConversationsForPathOptions,
} from './types';

const MINIMAX_CODE_CONVERSATION_HYDRATION_CONCURRENCY = 4;

const getSessionsDir = (options: { locations?: { minimaxCodeSessionsDir?: string } }) =>
    options.locations?.minimaxCodeSessionsDir ?? resolveMiniMaxCodeSessionsDir();

const toolCallToMessages = (
    toolCall: MiniMaxCodeToolCall,
    message: MiniMaxCodeTranscriptMessage,
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
        exitCode: null,
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
            toolEvidence: {
                ...evidence,
                inputText: toolCall.argumentsText,
                outputText: null,
            },
        }),
        ...createTextMessage({
            createdAtMs: message.createdAtMs,
            id: `${id}:output`,
            metadata,
            order,
            phase: 'tool_output',
            role: 'tool',
            text: toolCall.outputText,
            toolEvidence: {
                ...evidence,
                inputText: null,
                outputText: toolCall.outputText,
            },
        }),
    ];
};

const transcriptMessageToMessages = (
    message: MiniMaxCodeTranscriptMessage,
    order: number,
    worktree: string,
): ConversationMessage[] => {
    const metadata = {
        finishReason: message.finishReason,
        messageType: message.messageType,
        thinkingDurationMs: message.thinkingDurationMs,
    };
    const messages: ConversationMessage[] = [
        ...createTextMessage({
            createdAtMs: message.createdAtMs,
            id: `${message.messageId}:reasoning`,
            metadata,
            order,
            phase: 'reasoning',
            role: 'assistant',
            text: message.reasoning,
        }),
        ...createTextMessage({
            createdAtMs: message.createdAtMs,
            id: message.messageId,
            metadata,
            order,
            phase: getMiniMaxCodeMessagePhase(message) ?? 'unknown',
            role: normalizeRole(message.role),
            text: message.content,
        }),
    ];
    messages.push(
        ...message.toolCalls.flatMap((toolCall, toolIndex) =>
            toolCallToMessages(toolCall, message, toolIndex, order, worktree),
        ),
    );
    return messages;
};

const transcriptToMessages = (transcript: MiniMaxCodeSessionTranscript) => {
    return finalizeMessages(
        transcript.messages.flatMap((message, order) =>
            transcriptMessageToMessages(message, order, transcript.session.worktree),
        ),
    );
};

const buildConversation = async (
    session: MiniMaxCodeSessionSummary,
    sessionsDir: string,
    matches: ConversationPathMatch[],
    options: Pick<ListConversationsForPathOptions, 'includeMessages' | 'messageSelector'>,
    loadedTranscript: MiniMaxCodeSessionTranscript | null = null,
): Promise<ConversationDetail> => {
    const transcript =
        loadedTranscript ??
        (options.includeMessages
            ? await runWithTranscriptLoadLimit(
                  () => readMiniMaxCodeSessionTranscript(sessionsDir, session.sessionId, { includeRawPayloads: false }),
                  {
                      id: session.sessionId,
                      integration: 'minimax-code',
                      operation: 'api',
                      path: sessionsDir,
                  },
              )
            : null);
    const allMessages = transcript ? transcriptToMessages(transcript) : [];
    const messages = options.includeMessages
        ? selectConversationMessages(allMessages, options.messageSelector ?? 'last_final_answer')
        : [];
    return {
        createdAtMs: session.createdAtMs,
        deepLinks: createDeepLinks(
            'minimax-code',
            session.sessionId,
            createConversationUiPath('minimax-code-sessions', session.sessionId),
        ),
        id: session.sessionId,
        matches,
        messageCount: options.includeMessages ? allMessages.length : session.messageCount,
        messages,
        metadata: {
            agentName: session.agentName,
            appMode: session.appMode,
            currentModelId: session.currentModelId,
            currentModelVariant: session.currentModelVariant,
            runtime: session.runtime,
            sessionType: session.sessionType,
            status: session.status,
        },
        source: 'minimax-code',
        title: session.title,
        updatedAtMs: session.lastActiveAtMs,
        workspaceKey: session.workspaceKey,
        workspacePath: session.worktree,
    };
};

const listMiniMaxCodeConversationsForPath = async (options: ListConversationsForPathOptions) => {
    const sessionsDir = getSessionsDir(options);
    const groups = await listMiniMaxCodeWorkspaceGroups(sessionsDir);
    const conversations: ConversationDetail[] = [];
    for (const group of groups) {
        const match = await getConversationPathMatch(options.cwd, group.worktree);
        if (!match) {
            continue;
        }
        const sessions = (await listMiniMaxCodeSessionsForGroup(group.key, sessionsDir)).filter((session) =>
            isWithinUpdatedWindow(session.lastActiveAtMs, options),
        );
        conversations.push(
            ...(await mapWithConcurrency(sessions, MINIMAX_CODE_CONVERSATION_HYDRATION_CONCURRENCY, (session) =>
                buildConversation(session, sessionsDir, [match], options),
            )),
        );
    }
    return conversations;
};

const getMiniMaxCodeConversation = async (options: GetConversationOptions): Promise<ConversationDetail | null> => {
    const sessionsDir = getSessionsDir(options);
    const transcript = await runWithTranscriptLoadLimit(
        () => readMiniMaxCodeSessionTranscript(sessionsDir, options.id, { includeRawPayloads: false }),
        {
            id: options.id,
            integration: 'minimax-code',
            operation: 'api',
            path: sessionsDir,
        },
    );
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

export const minimaxCodeConversationAdapter: ConversationAdapter = {
    getConversation: getMiniMaxCodeConversation,
    listConversationsForPath: listMiniMaxCodeConversationsForPath,
    source: 'minimax-code',
};
