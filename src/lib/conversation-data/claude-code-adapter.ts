import {
    deleteClaudeCodeSession,
    listClaudeCodeSessionTranscriptsForGroup,
    listClaudeCodeWorkspaceGroups,
    readClaudeCodeSessionTranscript,
} from '../claude-code-db';
import type {
    ClaudeCodeSessionSummary,
    ClaudeCodeSessionTranscript,
    ClaudeCodeTranscriptEntry,
    ClaudeCodeTranscriptPart,
} from '../claude-code-exporter-types';
import { getClaudeCodeAssistantMessagePhase, resolveClaudeCodeProjectsDir } from '../claude-code-exporter-types';
import { mapWithConcurrency } from '../concurrency';
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

const CLAUDE_CONVERSATION_HYDRATION_CONCURRENCY = 4;

const getProjectsDir = (options: { locations?: { claudeCodeProjectsDir?: string } }) =>
    options.locations?.claudeCodeProjectsDir ?? resolveClaudeCodeProjectsDir();

const partToMessages = (
    entry: ClaudeCodeTranscriptEntry,
    part: ClaudeCodeTranscriptPart,
    partIndex: number,
): ConversationMessage[] => {
    const createdAtMs = toDateMs(entry.timestamp);
    const baseId = `${entry.entryId}:${partIndex}`;
    if (part.type === 'text') {
        return createTextMessage({
            createdAtMs,
            id: baseId,
            order: partIndex,
            phase: normalizeAssistantPhase(getClaudeCodeAssistantMessagePhase(entry), 'unknown'),
            role: normalizeRole(entry.role),
            text: part.text,
        });
    }

    if (part.type === 'thinking') {
        return createTextMessage({
            createdAtMs,
            id: baseId,
            order: partIndex,
            phase: 'reasoning',
            role: 'assistant',
            text: part.text,
        });
    }

    if (part.type === 'tool_use') {
        return createTextMessage({
            createdAtMs,
            id: baseId,
            metadata: { toolName: part.toolName, toolUseId: part.toolUseId },
            order: partIndex,
            phase: 'tool_call',
            role: 'tool',
            text: [part.toolName, part.argumentsText].filter(Boolean).join('\n'),
        });
    }

    if (part.type === 'tool_result') {
        return createTextMessage({
            createdAtMs,
            id: baseId,
            metadata: { isError: part.isError, toolUseId: part.toolUseId },
            order: partIndex,
            phase: 'tool_output',
            role: 'tool',
            text: part.outputText,
        });
    }

    if (part.type === 'attachment') {
        const attachmentLabel = part.attachmentType?.trim() || 'file';
        return createTextMessage({
            createdAtMs,
            id: baseId,
            metadata: { attachmentType: part.attachmentType ?? null },
            order: partIndex,
            phase: 'unknown',
            role: normalizeRole(entry.role),
            text: part.text?.trim() || `[Attachment: ${attachmentLabel}]`,
        });
    }

    return [];
};

const transcriptToMessages = (transcript: ClaudeCodeSessionTranscript): ConversationMessage[] => {
    return finalizeMessages(
        transcript.entries.flatMap((entry) =>
            entry.parts.flatMap((part, partIndex) => partToMessages(entry, part, partIndex)),
        ),
    );
};

const buildConversation = async (
    session: ClaudeCodeSessionSummary,
    projectsDir: string,
    matches: ConversationPathMatch[],
    options: Pick<ListConversationsForPathOptions, 'includeMessages' | 'messageSelector'>,
    loadedTranscript: ClaudeCodeSessionTranscript | null = null,
): Promise<ConversationDetail> => {
    const transcript = options.includeMessages
        ? (loadedTranscript ??
          (await runWithTranscriptLoadLimit(() => readClaudeCodeSessionTranscript(projectsDir, session.sessionId), {
              id: session.sessionId,
              path: session.filePath,
              source: 'claude-code-api',
          })))
        : null;
    const allMessages = transcript ? transcriptToMessages(transcript) : [];
    const messages = options.includeMessages
        ? selectConversationMessages(allMessages, options.messageSelector ?? 'last_final_answer')
        : [];

    return {
        createdAtMs: session.createdAtMs,
        deepLinks: createDeepLinks(
            'claude-code',
            session.sessionId,
            createConversationUiPath('claude-code-sessions', session.sessionId),
        ),
        id: session.sessionId,
        matches,
        messageCount: options.includeMessages ? allMessages.length : session.messageCount,
        messages,
        metadata: {
            filePath: session.filePath,
            gitBranch: session.gitBranch,
            model: session.model,
            totalTokens: session.totalTokens,
            version: session.version,
        },
        source: 'claude-code',
        title: cleanInlineTitle(session.title),
        updatedAtMs: session.lastActiveAtMs,
        workspaceKey: session.workspaceKey,
        workspacePath: session.worktree,
    };
};

const listClaudeConversationsForPath = async (
    options: ListConversationsForPathOptions,
): Promise<ConversationDetail[]> => {
    const projectsDir = getProjectsDir(options);
    const groups = await listClaudeCodeWorkspaceGroups(projectsDir);
    const conversations: ConversationDetail[] = [];

    for (const group of groups) {
        const match = await getConversationPathMatch(options.cwd, group.worktree);
        if (!match) {
            continue;
        }

        const transcripts = (await listClaudeCodeSessionTranscriptsForGroup(group.key, projectsDir)).filter(
            (transcript) => isWithinUpdatedWindow(transcript.session.lastActiveAtMs, options),
        );
        conversations.push(
            ...(await mapWithConcurrency(transcripts, CLAUDE_CONVERSATION_HYDRATION_CONCURRENCY, (transcript) =>
                buildConversation(transcript.session, projectsDir, [match], options, transcript),
            )),
        );
    }

    return conversations;
};

const getClaudeConversation = async (options: GetConversationOptions): Promise<ConversationDetail | null> => {
    const projectsDir = getProjectsDir(options);
    const transcript = await runWithTranscriptLoadLimit(
        () => readClaudeCodeSessionTranscript(projectsDir, options.id),
        {
            id: options.id,
            path: projectsDir,
            source: 'claude-code-api',
        },
    );
    if (!transcript) {
        return null;
    }

    return buildConversation(
        transcript.session,
        projectsDir,
        [],
        {
            includeMessages: true,
            messageSelector: options.messageSelector ?? 'all',
        },
        transcript,
    );
};

const deleteClaudeConversation = async (options: DeleteConversationOptions) => {
    const result = await deleteClaudeCodeSession(getProjectsDir(options), options.id);
    return {
        deletedFiles: result.deletedFiles,
        deletedIds: result.deletedSessionIds,
    };
};

export const claudeCodeConversationAdapter: ConversationAdapter = {
    deleteConversation: deleteClaudeConversation,
    getConversation: getClaudeConversation,
    listConversationsForPath: listClaudeConversationsForPath,
    source: 'claude-code',
};
