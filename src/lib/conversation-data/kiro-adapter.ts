import { mapWithConcurrency } from '../concurrency';
import {
    deleteKiroSession,
    listKiroSessionsForGroup,
    listKiroWorkspaceGroups,
    readKiroSessionTranscript,
} from '../kiro-db';
import type {
    KiroSessionSummary,
    KiroSessionTranscript,
    KiroTranscriptEntry,
    KiroTranscriptPart,
} from '../kiro-exporter-types';
import { resolveKiroWorkspaceSessionsDir } from '../kiro-exporter-types';
import { getFinalKiroAssistantMessageEntryIds, getKiroMessagePhase } from '../kiro-transcript-phase';
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
    toDateMs,
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

const KIRO_CONVERSATION_HYDRATION_CONCURRENCY = 4;

const getPartString = (part: KiroTranscriptPart, key: string): string | null => {
    const value = part.raw[key];
    return typeof value === 'string' && value.trim() ? value : null;
};

const getPartNumber = (part: KiroTranscriptPart, key: string): number | null => {
    const value = part.raw[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const getSessionsDir = (options: { locations?: { kiroWorkspaceSessionsDir?: string } }) =>
    options.locations?.kiroWorkspaceSessionsDir ?? resolveKiroWorkspaceSessionsDir();

export const normalizeKiroTranscriptPart = (
    entry: KiroTranscriptEntry,
    part: KiroTranscriptPart,
    partIndex: number,
    finalEntryIds: Set<string>,
): ConversationMessage[] => {
    const createdAtMs = toDateMs(entry.timestamp);
    if (entry.entryType === 'tool_call') {
        const toolName = getPartString(part, 'toolName') ?? 'unknown';
        const callId = getPartString(part, 'toolCallId') ?? entry.entryId;
        return createTextMessage({
            createdAtMs,
            id: `${entry.entryId}:${partIndex}`,
            metadata: {
                executionId: entry.executionId,
                toolCallId: callId,
                toolName,
            },
            order: partIndex,
            phase: 'tool_call',
            role: 'tool',
            text: part.text,
            toolEvidence: {
                callId,
                command: getPartString(part, 'command'),
                durationMs: null,
                exitCode: null,
                inputText: part.text ?? null,
                name: toolName,
                namespace: toolName.includes('.') ? (toolName.split('.')[0] ?? null) : null,
                outputText: null,
                status: 'unknown',
                workdir: getPartString(part, 'workdir'),
            },
        });
    }

    if (entry.entryType === 'tool_output') {
        const toolName = getPartString(part, 'toolName') ?? 'unknown';
        const callId = getPartString(part, 'toolCallId');
        const exitCode = getPartNumber(part, 'exitCode');
        return createTextMessage({
            createdAtMs,
            id: `${entry.entryId}:${partIndex}`,
            metadata: {
                executionId: entry.executionId,
                toolCallId: callId,
                toolName,
            },
            order: partIndex,
            phase: 'tool_output',
            role: 'tool',
            text: part.text,
            toolEvidence: {
                callId,
                command: null,
                durationMs: null,
                exitCode,
                inputText: null,
                name: toolName,
                namespace: toolName.includes('.') ? (toolName.split('.')[0] ?? null) : null,
                outputText: part.text ?? null,
                status: normalizeToolStatus(null, exitCode),
                workdir: null,
            },
        });
    }

    return createTextMessage({
        createdAtMs,
        id: `${entry.entryId}:${partIndex}`,
        metadata: part.imageUrl ? { imageUrl: part.imageUrl } : {},
        order: partIndex,
        phase: normalizeAssistantPhase(getKiroMessagePhase(entry, finalEntryIds), 'unknown'),
        role: normalizeRole(entry.role),
        text: part.text ?? part.imageUrl,
    });
};

const transcriptToMessages = (transcript: KiroSessionTranscript) => {
    const finalEntryIds = getFinalKiroAssistantMessageEntryIds(transcript.entries);
    return finalizeMessages(
        transcript.entries.flatMap((entry) =>
            entry.parts.flatMap((part, partIndex) =>
                normalizeKiroTranscriptPart(entry, part, partIndex, finalEntryIds),
            ),
        ),
    );
};

const buildConversation = async (
    session: KiroSessionSummary,
    sessionsDir: string,
    matches: ConversationPathMatch[],
    options: Pick<ListConversationsForPathOptions, 'includeMessages' | 'messageSelector'>,
    loadedTranscript: KiroSessionTranscript | null = null,
): Promise<ConversationDetail> => {
    const transcript = options.includeMessages
        ? (loadedTranscript ??
          (await runWithTranscriptLoadLimit(() => readKiroSessionTranscript(sessionsDir, session.sessionId), {
              id: session.sessionId,
              integration: 'kiro',
              operation: 'api',
              path: session.filePath,
          })))
        : null;
    const allMessages = transcript ? transcriptToMessages(transcript) : [];
    const messages = options.includeMessages
        ? selectConversationMessages(allMessages, options.messageSelector ?? 'last_final_answer')
        : [];

    return {
        createdAtMs: session.createdAtMs,
        deepLinks: createDeepLinks(
            'kiro',
            session.sessionId,
            createConversationUiPath('kiro-sessions', session.sessionId),
        ),
        id: session.sessionId,
        matches,
        messageCount: options.includeMessages ? allMessages.length : session.messageCount,
        messages,
        metadata: {
            defaultModelTitle: session.defaultModelTitle,
            filePath: session.filePath,
            model: session.selectedModel ?? session.defaultModelTitle,
            selectedModel: session.selectedModel,
            sessionType: session.sessionType,
        },
        source: 'kiro',
        title: cleanInlineTitle(session.title),
        updatedAtMs: session.lastActiveAtMs,
        workspaceKey: session.workspaceKey,
        workspacePath: session.worktree,
    };
};

const listKiroConversationsForPath = async (options: ListConversationsForPathOptions) => {
    const sessionsDir = getSessionsDir(options);
    const groups = await listKiroWorkspaceGroups(sessionsDir);
    const conversations: ConversationDetail[] = [];

    for (const group of groups) {
        const match = await getConversationPathMatch(options.cwd, group.worktree);
        if (!match) {
            continue;
        }
        const sessions = (await listKiroSessionsForGroup(group.key, sessionsDir)).filter((session) =>
            isWithinUpdatedWindow(session.lastActiveAtMs, options),
        );
        conversations.push(
            ...(await mapWithConcurrency(sessions, KIRO_CONVERSATION_HYDRATION_CONCURRENCY, (session) =>
                buildConversation(session, sessionsDir, [match], options),
            )),
        );
    }

    return conversations;
};

const getKiroConversation = async (options: GetConversationOptions): Promise<ConversationDetail | null> => {
    const sessionsDir = getSessionsDir(options);
    const transcript = await runWithTranscriptLoadLimit(() => readKiroSessionTranscript(sessionsDir, options.id), {
        id: options.id,
        integration: 'kiro',
        operation: 'api',
        path: sessionsDir,
    });
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

const deleteKiroConversation = async (options: DeleteConversationOptions) => {
    const result = await deleteKiroSession(getSessionsDir(options), options.id);
    return {
        deletedFiles: result.deletedFiles,
        deletedIds: result.deletedSessionIds,
    };
};

export const kiroConversationAdapter: ConversationAdapter = {
    deleteConversation: deleteKiroConversation,
    getConversation: getKiroConversation,
    listConversationsForPath: listKiroConversationsForPath,
    source: 'kiro',
};
