import { renderSelectedTranscriptExport } from './conversation-data/conversation-export';
import { normalizeMiniMaxCodeTranscript } from './conversation-data/minimax-code-messages';
import type {
    MiniMaxCodeExportOptions,
    MiniMaxCodeSessionSummary,
    MiniMaxCodeSessionTranscript,
} from './minimax-code-exporter-types';

const buildMetadata = (session: MiniMaxCodeSessionSummary): Record<string, unknown> => ({
    agent_name: session.agentName,
    created_at_unix_ms: session.createdAtMs,
    exported_from: 'minimax_code_v2_snapshot',
    last_updated_at_unix_ms: session.lastActiveAtMs,
    message_count: session.messageCount,
    model: session.currentModelId,
    model_variant: session.currentModelVariant,
    session_id: session.sessionId,
    source_snapshot_path: session.snapshotPath,
    status: session.status,
    title: session.title,
    tool_call_count: session.toolCallCount,
    tool_result_count: session.toolResultCount,
    workspace_key: session.workspaceKey,
    worktree: session.worktree,
});

export const renderMiniMaxCodeTranscript = (
    transcript: MiniMaxCodeSessionTranscript,
    options: MiniMaxCodeExportOptions,
): string | null =>
    renderSelectedTranscriptExport(
        {
            bodyAvailability: 'full',
            messages: normalizeMiniMaxCodeTranscript(transcript),
            metadata: buildMetadata(transcript.session),
            ...(transcript.session.currentModelId ? { model: transcript.session.currentModelId } : {}),
            title: transcript.session.title || transcript.session.sessionId,
        },
        options,
    );
