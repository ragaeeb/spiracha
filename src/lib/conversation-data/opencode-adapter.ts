import { mapWithConcurrency } from '../concurrency';
import {
    deleteOpenCodeSession,
    listOpenCodeSessionsForGroup,
    listOpenCodeWorkspaceGroups,
    readOpenCodeSessionTranscript,
} from '../opencode-db';
import type {
    OpenCodeSessionSummary,
    OpenCodeSessionTranscript,
    OpenCodeTranscriptPart,
} from '../opencode-exporter-types';
import { resolveOpenCodeDbPath } from '../opencode-exporter-types';
import { splitOpenCodeThinkTaggedText } from '../opencode-think-tags';
import { getFinalOpenCodeAssistantTextPartIds, getOpenCodeTextPartPhase } from '../opencode-transcript-phase';
import { cleanInlineTitle } from '../shared';
import { runWithTranscriptLoadLimit } from '../transcript-load-limiter';
import {
    createConversationUiPath,
    createDeepLinks,
    createTextMessage,
    finalizeMessages,
    isWithinUpdatedWindow,
    normalizeAssistantPhase,
    normalizeRole,
    normalizeToolStatus,
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

const OPENCODE_CONVERSATION_HYDRATION_CONCURRENCY = 4;

const getDbPath = (options: { locations?: { opencodeDbPath?: string } }) =>
    options.locations?.opencodeDbPath ?? resolveOpenCodeDbPath();

const textPartToMessages = (
    part: OpenCodeTranscriptPart,
    finalTextPartIds: Set<string>,
    order: number,
): ConversationMessage[] => {
    const split =
        part.role === 'assistant'
            ? splitOpenCodeThinkTaggedText(part.text ?? '')
            : { reasoningBlocks: [], visibleText: part.text ?? '' };
    return [
        ...createTextMessage({
            createdAtMs: part.createdAtMs,
            id: `${part.partId}:reasoning`,
            order,
            phase: 'reasoning',
            role: 'assistant',
            text: split.reasoningBlocks.join('\n\n'),
        }),
        ...createTextMessage({
            createdAtMs: part.createdAtMs,
            id: part.partId,
            order,
            phase: normalizeAssistantPhase(getOpenCodeTextPartPhase(part, finalTextPartIds), 'unknown'),
            role: normalizeRole(part.role),
            text: split.visibleText,
        }),
    ];
};

const partToMessages = (
    part: OpenCodeTranscriptPart,
    finalTextPartIds: Set<string>,
    order: number,
): ConversationMessage[] => {
    if (part.type === 'text') {
        return textPartToMessages(part, finalTextPartIds, order);
    }

    if (part.type === 'reasoning') {
        return createTextMessage({
            createdAtMs: part.createdAtMs,
            id: part.partId,
            order,
            phase: 'reasoning',
            role: 'assistant',
            text: part.text,
        });
    }

    if (part.type === 'tool') {
        const metadata = { callId: part.callId, status: part.status, toolName: part.toolName };
        const toolName = part.toolName ?? 'unknown';
        const namespace = toolName.includes('.') ? (toolName.split('.')[0] ?? null) : null;
        const durationMs =
            part.startTimeMs !== null &&
            part.startTimeMs !== undefined &&
            part.endTimeMs !== null &&
            part.endTimeMs !== undefined
                ? Math.max(0, part.endTimeMs - part.startTimeMs)
                : null;
        return [
            ...createTextMessage({
                createdAtMs: part.createdAtMs,
                id: `${part.partId}:tool_call`,
                metadata,
                order,
                phase: 'tool_call',
                role: 'tool',
                text: [part.toolName, part.argumentsText ?? part.title].filter(Boolean).join('\n'),
                toolEvidence: {
                    callId: part.callId ?? null,
                    command: null,
                    durationMs,
                    exitCode: null,
                    inputText: part.argumentsText ?? part.title ?? null,
                    name: toolName,
                    namespace,
                    outputText: null,
                    status: normalizeToolStatus(part.status),
                    workdir: null,
                },
            }),
            ...createTextMessage({
                createdAtMs: part.createdAtMs,
                id: `${part.partId}:tool_output`,
                metadata,
                order,
                phase: 'tool_output',
                role: 'tool',
                text: part.outputText,
                toolEvidence: {
                    callId: part.callId ?? null,
                    command: null,
                    durationMs,
                    exitCode: null,
                    inputText: null,
                    name: toolName,
                    namespace,
                    outputText: part.outputText ?? null,
                    status: normalizeToolStatus(part.status),
                    workdir: null,
                },
            }),
        ];
    }

    return [];
};

const transcriptToMessages = (transcript: OpenCodeSessionTranscript) => {
    const parts = transcript.messages.flatMap((message) => message.parts);
    const finalTextPartIds = getFinalOpenCodeAssistantTextPartIds(parts);
    return finalizeMessages(parts.flatMap((part, order) => partToMessages(part, finalTextPartIds, order)));
};

const buildConversation = async (
    session: OpenCodeSessionSummary,
    dbPath: string,
    matches: ConversationPathMatch[],
    options: Pick<ListConversationsForPathOptions, 'includeMessages' | 'messageSelector'>,
    loadedTranscript: OpenCodeSessionTranscript | null = null,
): Promise<ConversationDetail> => {
    const transcript =
        loadedTranscript ??
        (options.includeMessages
            ? await runWithTranscriptLoadLimit(() => readOpenCodeSessionTranscript(dbPath, session.sessionId), {
                  id: session.sessionId,
                  integration: 'opencode',
                  operation: 'api',
                  path: dbPath,
              })
            : null);
    const allMessages = transcript ? transcriptToMessages(transcript) : [];
    const messages = options.includeMessages
        ? selectConversationMessages(allMessages, options.messageSelector ?? 'last_final_answer')
        : [];

    return {
        createdAtMs: session.createdAtMs,
        deepLinks: createDeepLinks(
            'opencode',
            session.sessionId,
            createConversationUiPath('opencode-sessions', session.sessionId),
        ),
        id: session.sessionId,
        matches,
        messageCount: options.includeMessages ? allMessages.length : session.messageCount,
        messages,
        metadata: {
            agent: session.agent,
            cost: session.cost,
            model: session.model,
            modelLabel: session.modelLabel,
            totalTokens: session.totalTokens,
        },
        source: 'opencode',
        title: cleanInlineTitle(session.title),
        updatedAtMs: session.lastUpdatedAtMs,
        workspaceKey: session.workspaceKey,
        workspacePath: session.worktree,
    };
};

const listOpenCodeConversationsForPath = async (options: ListConversationsForPathOptions) => {
    const dbPath = getDbPath(options);
    const groups = await listOpenCodeWorkspaceGroups(dbPath);
    const conversations: ConversationDetail[] = [];

    for (const group of groups) {
        const match = await getConversationPathMatch(options.cwd, group.worktree);
        if (!match) {
            continue;
        }
        const sessions = (await listOpenCodeSessionsForGroup(group.key, dbPath)).filter((session) =>
            isWithinUpdatedWindow(session.lastUpdatedAtMs, options),
        );
        conversations.push(
            ...(await mapWithConcurrency(sessions, OPENCODE_CONVERSATION_HYDRATION_CONCURRENCY, (session) =>
                buildConversation(session, dbPath, [match], options),
            )),
        );
    }

    return conversations;
};

const getOpenCodeConversation = async (options: GetConversationOptions): Promise<ConversationDetail | null> => {
    const dbPath = getDbPath(options);
    const transcript = await runWithTranscriptLoadLimit(() => readOpenCodeSessionTranscript(dbPath, options.id), {
        id: options.id,
        integration: 'opencode',
        operation: 'api',
        path: dbPath,
    });
    return transcript
        ? buildConversation(
              transcript.session,
              dbPath,
              [],
              {
                  includeMessages: true,
                  messageSelector: options.messageSelector ?? 'all',
              },
              transcript,
          )
        : null;
};

const deleteOpenCodeConversation = async (options: DeleteConversationOptions) => {
    const result = await deleteOpenCodeSession(getDbPath(options), options.id);
    return {
        deletedFiles: [],
        deletedIds: result.deletedSessionIds,
    };
};

export const opencodeConversationAdapter: ConversationAdapter = {
    deleteConversation: deleteOpenCodeConversation,
    getConversation: getOpenCodeConversation,
    listConversationsForPath: listOpenCodeConversationsForPath,
    source: 'opencode',
};
