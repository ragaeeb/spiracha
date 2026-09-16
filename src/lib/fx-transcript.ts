import { renderSelectedTranscriptExport } from './conversation-data/conversation-export';
import { normalizeFxTranscript } from './conversation-data/fx-messages';
import type { FxExportOptions, FxSessionSummary, FxSessionTranscript } from './fx-exporter-types';

const buildMetadata = (session: FxSessionSummary): Record<string, unknown> => ({
    created_at_unix_ms: session.createdAtMs,
    exported_from: 'fx_event_log',
    last_updated_at_unix_ms: session.lastActiveAtMs,
    message_count: session.messageCount,
    model: session.currentModelId,
    model_variant: session.currentModelVariant,
    session_directory: session.sessionDir,
    session_id: session.sessionId,
    status: session.status,
    title: session.title,
    tool_call_count: session.toolCallCount,
    tool_result_count: session.toolResultCount,
    total_input_tokens: session.totalInputTokens,
    total_output_tokens: session.totalOutputTokens,
    workspace_key: session.workspaceKey,
    worktree: session.worktree,
});

export const renderFxTranscript = (transcript: FxSessionTranscript, options: FxExportOptions): string | null =>
    renderSelectedTranscriptExport(
        {
            bodyAvailability: 'full',
            messages: normalizeFxTranscript(transcript),
            metadata: buildMetadata(transcript.session),
            ...(transcript.session.currentModelId ? { model: transcript.session.currentModelId } : {}),
            title: transcript.session.title || transcript.session.sessionId,
        },
        options,
    );
