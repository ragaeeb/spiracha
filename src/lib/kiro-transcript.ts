import { renderSelectedTranscriptExport } from './conversation-data/conversation-export';
import type { KiroExportOptions, KiroSessionSummary, KiroSessionTranscript } from './kiro-exporter-types';
import { normalizeKiroTranscriptEntries } from './kiro-transcript-parser';

const buildMetadata = (session: KiroSessionSummary): Record<string, unknown> => ({
    autonomy_mode: session.autonomyMode,
    created_at_iso: session.createdAtIso,
    default_model_title: session.defaultModelTitle,
    exported_from: 'kiro_workspace_sessions',
    image_count: session.imageCount,
    last_active_at_iso: session.lastActiveAtIso,
    message_count: session.messageCount,
    prompt_log_count: session.promptLogCount,
    selected_model: session.selectedModel,
    selected_profile_id: session.selectedProfileId,
    session_id: session.sessionId,
    session_type: session.sessionType,
    source_session_path: session.filePath,
    title: session.title,
    workspace_directory: session.workspaceDirectory,
    workspace_key: session.workspaceKey,
    workspace_path: session.workspacePath,
});

export const renderKiroTranscript = (transcript: KiroSessionTranscript, options: KiroExportOptions): string | null => {
    const model = transcript.session.selectedModel ?? transcript.session.defaultModelTitle;
    return renderSelectedTranscriptExport(
        {
            bodyAvailability: 'full',
            messages: normalizeKiroTranscriptEntries(transcript.entries),
            metadata: buildMetadata(transcript.session),
            ...(model ? { model } : {}),
            title: transcript.session.title || transcript.session.sessionId,
        },
        options,
    );
};
