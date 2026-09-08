import { mapWithConcurrency } from '../concurrency';
import type { QoderSessionSummary, QoderSessionTranscript } from '../qoder-exporter-types';
import {
    resolveQoderCliProjectsDir,
    resolveQoderGlobalStateDb,
    resolveQoderWorkspaceStorageDir,
} from '../qoder-exporter-types';
import { readQoderSessionTranscript } from '../qoder-session-transcript';
import { listQoderSessionsForGroup, listQoderWorkspaceGroups } from '../qoder-sessions';
import { normalizeQoderTranscriptEntries } from '../qoder-transcript-parser';
import { cleanInlineTitle } from '../shared-text';
import { runWithTranscriptLoadLimit } from '../transcript-load-limiter';
import { createConversationUiPath, createDeepLinks, isWithinUpdatedWindow } from './adapter-helpers';
import { selectConversationMessages } from './message-selector';
import { getConversationPathMatch } from './path-match';
import { createRawConversationDownload } from './raw-download';
import type {
    ConversationAdapter,
    ConversationDetail,
    ConversationPathMatch,
    GetConversationOptions,
    ListConversationsOptions,
} from './types';

const QODER_CONVERSATION_HYDRATION_CONCURRENCY = 4;

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

const transcriptToMessages = (transcript: QoderSessionTranscript) =>
    normalizeQoderTranscriptEntries(transcript.entries);

const buildConversation = async (
    session: QoderSessionSummary,
    locations: ReturnType<typeof getQoderLocations>,
    matches: ConversationPathMatch[],
    options: Pick<ListConversationsOptions, 'includeMessages' | 'messageSelector'>,
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
                  integration: 'qoder',
                  operation: 'api',
                  path: session.sourceStatePath ?? locations.globalStateDb,
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
        deepLinks: createDeepLinks(
            'qoder',
            session.sessionId,
            createConversationUiPath('qoder-sessions', session.sessionId),
        ),
        id: session.sessionId,
        matches,
        ...(session.model ? { model: session.model } : {}),
        messageCount: options.includeMessages ? allMessages.length : session.messageCount,
        messages,
        metadata: {
            agentClass: session.agentClass,
            assistantMessageCount,
            executionMode: session.executionMode,
            fileOperationCount: session.fileOperationCount,
            historyIds: session.historyIds,
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

const listQoderConversations = async (options: ListConversationsOptions) => {
    if (!options.cwd) {
        return [];
    }

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
            if (!isWithinUpdatedWindow(session.lastActiveAtMs, options)) {
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
            integration: 'qoder',
            operation: 'api',
            path: locations.globalStateDb,
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

const getQoderConversationRaw = async (options: GetConversationOptions) => {
    const locations = getQoderLocations(options);
    const transcript = await readQoderSessionTranscript(
        locations.globalStateDb,
        locations.workspaceStorageDir,
        options.id,
        locations.cliProjectsDir,
        { enableAcp: false },
    );
    const cliTranscriptPath = transcript?.rawSession.sourceCliTranscriptPath;
    const filePath = typeof cliTranscriptPath === 'string' ? cliTranscriptPath : transcript?.session.sourceStatePath;
    return filePath ? createRawConversationDownload(filePath) : null;
};

export const qoderConversationAdapter: ConversationAdapter = {
    getConversation: getQoderConversation,
    getConversationRaw: getQoderConversationRaw,
    listConversations: listQoderConversations,
    source: 'qoder',
};
