import type {
    CommandCodeExportOptions,
    CommandCodeSessionSummary,
    CommandCodeSessionTranscript,
} from './command-code-exporter-types';
import { renderSelectedTranscriptExport } from './conversation-data/conversation-export';

const buildMetadata = (session: CommandCodeSessionSummary): Record<string, unknown> => ({
    created_at_unix_ms: session.createdAtMs,
    cwd: session.cwd,
    exported_from: 'command_code_sessions',
    last_active_at_unix_ms: session.lastActiveAtMs,
    message_count: session.messageCount,
    model: session.model,
    model_label: session.modelLabel,
    record_count: session.recordCount,
    session_id: session.sessionId,
    source_transcript_path: session.filePath,
    title: session.title,
    tool_call_count: session.toolCallCount,
    tool_output_count: session.toolOutputCount,
    workspace_key: session.workspaceKey,
    worktree: session.worktree,
});

export const renderCommandCodeTranscript = (
    transcript: CommandCodeSessionTranscript,
    options: CommandCodeExportOptions,
): string | null =>
    renderSelectedTranscriptExport(
        {
            bodyAvailability: 'full',
            messages: transcript.messages,
            metadata: buildMetadata(transcript.session),
            ...(transcript.session.model ? { model: transcript.session.model } : {}),
            title: transcript.session.title || transcript.session.sessionId,
        },
        {
            includeCommentary: options.includeCommentary,
            includeMetadata: options.includeMetadata,
            includeTools: options.includeTools,
            outputFormat: options.outputFormat,
        },
    );
