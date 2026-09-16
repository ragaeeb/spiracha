import { renderSelectedTranscriptExport } from './conversation-data/conversation-export';
import type { GrokExportOptions, GrokSessionSummary, GrokSessionTranscript } from './grok-exporter-types';
import { normalizeGrokTranscriptEntries } from './grok-transcript-parser';

const buildMetadata = (session: GrokSessionSummary): Record<string, unknown> => ({
    agent_name: session.agentName,
    created_at_iso: session.createdAtIso,
    cwd: session.cwd,
    exported_from: 'grok_local_session',
    git_branch: session.gitBranch,
    last_active_at_iso: session.lastActiveAtIso,
    message_count: session.messageCount,
    model: session.currentModelId,
    model_label: session.modelLabel,
    session_id: session.sessionId,
    source_transcript_path: session.chatHistoryPath,
    title: session.title,
    tool_call_count: session.toolCallCount,
    tool_result_count: session.toolResultCount,
    workspace_key: session.workspaceKey,
    worktree: session.worktree,
});

export const renderGrokTranscript = (transcript: GrokSessionTranscript, options: GrokExportOptions): string | null => {
    const model = transcript.session.modelLabel ?? transcript.session.currentModelId;
    return renderSelectedTranscriptExport(
        {
            bodyAvailability: 'full',
            messages: normalizeGrokTranscriptEntries(transcript.entries),
            metadata: buildMetadata(transcript.session),
            ...(model ? { model } : {}),
            title: transcript.session.title || transcript.session.sessionId,
        },
        options,
    );
};
