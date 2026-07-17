import { mapWithConcurrency } from '../concurrency';
import {
    listQoderSessionsForGroup,
    listQoderWorkspaceGroups,
    readQoderSessionTranscript,
    resolveQoderCliProjectsDir,
} from '../qoder-db';
import type {
    QoderSessionSummary,
    QoderSessionTranscript,
    QoderTranscriptEntry,
    QoderTranscriptPart,
} from '../qoder-exporter-types';
import { resolveQoderGlobalStateDb, resolveQoderWorkspaceStorageDir } from '../qoder-exporter-types';
import { getFinalQoderAssistantMessageEntryIds, getQoderMessagePhase } from '../qoder-transcript-phase';
import { cleanInlineTitle } from '../shared';
import { runWithTranscriptLoadLimit } from '../transcript-load-limiter';
import {
    createDeepLinks,
    createTextMessage,
    finalizeMessages,
    normalizeAssistantPhase,
    normalizeRole,
    toDateMs,
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

const QODER_CONVERSATION_HYDRATION_CONCURRENCY = 4;

const getPartString = (part: QoderTranscriptPart, key: string): string | null => {
    const value = part.raw[key];
    return typeof value === 'string' && value.trim() ? value : null;
};

const getQoderLocations = (options: {
    locations?: {
        qoderAcpSocketPath?: string;
        qoderCliProjectsDir?: string;
        qoderGlobalStateDb?: string;
        qoderWorkspaceStorageDir?: string;
    };
}) => ({
    acpSocketPath: options.locations?.qoderAcpSocketPath,
    cliProjectsDir: options.locations?.qoderCliProjectsDir ?? resolveQoderCliProjectsDir(),
    globalStateDb: options.locations?.qoderGlobalStateDb ?? resolveQoderGlobalStateDb(),
    workspaceStorageDir: options.locations?.qoderWorkspaceStorageDir ?? resolveQoderWorkspaceStorageDir(),
});

const isWithinUpdatedWindow = (
    session: QoderSessionSummary,
    options: Pick<ListConversationsForPathOptions, 'updatedAfterMs' | 'updatedBeforeMs'>,
): boolean => {
    const updatedAtMs = session.lastActiveAtMs ?? 0;
    if (options.updatedAfterMs !== undefined && updatedAtMs < options.updatedAfterMs) {
        return false;
    }
    if (options.updatedBeforeMs !== undefined && updatedAtMs > options.updatedBeforeMs) {
        return false;
    }
    return true;
};

const partToMessages = (
    entry: QoderTranscriptEntry,
    part: QoderTranscriptPart,
    partIndex: number,
    finalEntryIds: Set<string>,
): ConversationMessage[] => {
    if (entry.entryType === 'tool_call') {
        return createTextMessage({
            createdAtMs: toDateMs(entry.timestamp),
            id: `${entry.entryId}:${partIndex}`,
            metadata: {
                requestId: entry.requestId,
                toolCallId: getPartString(part, 'toolCallId') ?? entry.entryId,
                toolName: getPartString(part, 'toolName'),
            },
            order: partIndex,
            phase: 'tool_call',
            role: 'tool',
            text: part.text,
        });
    }

    if (entry.entryType === 'tool_output') {
        return createTextMessage({
            createdAtMs: toDateMs(entry.timestamp),
            id: `${entry.entryId}:${partIndex}`,
            metadata: {
                requestId: entry.requestId,
                toolCallId: getPartString(part, 'toolCallId'),
                toolName: getPartString(part, 'toolName'),
            },
            order: partIndex,
            phase: 'tool_output',
            role: 'tool',
            text: part.text,
        });
    }

    return createTextMessage({
        createdAtMs: toDateMs(entry.timestamp),
        id: `${entry.entryId}:${partIndex}`,
        order: partIndex,
        phase: normalizeAssistantPhase(getQoderMessagePhase(entry, finalEntryIds), 'unknown'),
        role: normalizeRole(entry.role),
        text: part.text,
    });
};

const transcriptToMessages = (transcript: QoderSessionTranscript) => {
    const finalEntryIds = getFinalQoderAssistantMessageEntryIds(transcript.entries);
    return finalizeMessages(
        transcript.entries.flatMap((entry) =>
            entry.parts.flatMap((part, partIndex) => partToMessages(entry, part, partIndex, finalEntryIds)),
        ),
    );
};

const buildConversation = async (
    session: QoderSessionSummary,
    locations: ReturnType<typeof getQoderLocations>,
    matches: ConversationPathMatch[],
    options: Pick<ListConversationsForPathOptions, 'includeMessages' | 'messageSelector'>,
    loadedTranscript: QoderSessionTranscript | null = null,
): Promise<ConversationDetail> => {
    const transcript = options.includeMessages
        ? (loadedTranscript ??
          (await runWithTranscriptLoadLimit(
              () =>
                  readQoderSessionTranscript(
                      locations.globalStateDb,
                      locations.workspaceStorageDir,
                      session.sessionId,
                      locations.cliProjectsDir,
                      {
                          acpSocketPath: locations.acpSocketPath,
                          enableAcp: locations.acpSocketPath ? true : undefined,
                      },
                  ),
              {
                  id: session.sessionId,
                  path: session.sourceStatePath ?? locations.globalStateDb,
                  source: 'qoder-api',
              },
          )))
        : null;
    const allMessages = transcript ? transcriptToMessages(transcript) : [];
    const messages = options.includeMessages
        ? selectConversationMessages(allMessages, options.messageSelector ?? 'last_final_answer')
        : [];
    const assistantMessageCount = options.includeMessages
        ? allMessages.filter((message) => message.role === 'assistant').length
        : session.assistantMessageCount;
    const userMessageCount = options.includeMessages
        ? allMessages.filter((message) => message.role === 'user').length
        : session.userMessageCount;
    const renderablePartCount = options.includeMessages ? allMessages.length : session.renderablePartCount;

    return {
        createdAtMs: session.createdAtMs,
        deepLinks: createDeepLinks('qoder', session.sessionId, `/qoder-sessions/${session.sessionId}`),
        id: session.sessionId,
        matches,
        messageCount: options.includeMessages ? allMessages.length : session.messageCount,
        messages,
        metadata: {
            agentClass: session.agentClass,
            assistantMessageCount,
            executionMode: session.executionMode,
            fileOperationCount: session.fileOperationCount,
            historyIds: session.historyIds,
            model: session.model,
            query: session.query,
            renderablePartCount,
            requestId: session.requestId,
            sourceStatePath: session.sourceStatePath,
            status: session.status,
            taskId: session.taskId,
            userMessageCount,
            workspaceStorageId: session.workspaceStorageId,
        },
        source: 'qoder',
        title: cleanInlineTitle(session.title),
        updatedAtMs: session.lastActiveAtMs,
        workspaceKey: session.workspaceKey,
        workspacePath: session.worktree,
    };
};

const listQoderConversationsForPath = async (options: ListConversationsForPathOptions) => {
    const locations = getQoderLocations(options);
    const groups = await listQoderWorkspaceGroups(locations.globalStateDb, locations.workspaceStorageDir);
    const candidates: { match: ConversationPathMatch; session: QoderSessionSummary }[] = [];

    for (const group of groups) {
        const match = await getConversationPathMatch(options.cwd, group.worktree);
        if (!match) {
            continue;
        }

        const sessions = await listQoderSessionsForGroup(
            group.key,
            locations.globalStateDb,
            locations.workspaceStorageDir,
        );
        for (const session of sessions) {
            if (!isWithinUpdatedWindow(session, options)) {
                continue;
            }

            candidates.push({ match, session });
        }
    }

    return await mapWithConcurrency(candidates, QODER_CONVERSATION_HYDRATION_CONCURRENCY, ({ match, session }) =>
        buildConversation(session, locations, [match], options),
    );
};

const getQoderConversation = async (options: GetConversationOptions): Promise<ConversationDetail | null> => {
    const locations = getQoderLocations(options);
    const transcript = await runWithTranscriptLoadLimit(
        () =>
            readQoderSessionTranscript(
                locations.globalStateDb,
                locations.workspaceStorageDir,
                options.id,
                locations.cliProjectsDir,
                {
                    acpSocketPath: locations.acpSocketPath,
                    enableAcp: locations.acpSocketPath ? true : undefined,
                },
            ),
        {
            id: options.id,
            path: locations.globalStateDb,
            source: 'qoder-api',
        },
    );
    return transcript
        ? buildConversation(
              transcript.session,
              locations,
              [],
              {
                  includeMessages: true,
                  messageSelector: options.messageSelector ?? 'all',
              },
              transcript,
          )
        : null;
};

export const qoderConversationAdapter: ConversationAdapter = {
    getConversation: getQoderConversation,
    listConversationsForPath: listQoderConversationsForPath,
    source: 'qoder',
};
