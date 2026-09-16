import { renderSelectedTranscriptExport } from './conversation-data/conversation-export';
import type { QoderExportOptions, QoderSessionSummary, QoderSessionTranscript } from './qoder-exporter-types';
import { normalizeQoderTranscriptEntries } from './qoder-transcript-parser';

const buildMetadata = (session: QoderSessionSummary): Record<string, unknown> => ({
    agent_class: session.agentClass,
    created_at_iso: session.createdAtIso,
    execution_mode: session.executionMode,
    exported_from: 'qoder_local_history',
    file_operation_count: session.fileOperationCount,
    last_active_at_iso: session.lastActiveAtIso,
    message_count: session.messageCount,
    model: session.model,
    request_id: session.requestId,
    session_id: session.sessionId,
    snapshot_file_count: session.snapshotFileCount,
    source_state_path: session.sourceStatePath,
    status: session.status,
    task_id: session.taskId,
    title: session.title,
    workspace_key: session.workspaceKey,
    workspace_path: session.workspacePath,
    workspace_storage_id: session.workspaceStorageId,
});

export const renderQoderTranscript = (transcript: QoderSessionTranscript, options: QoderExportOptions): string | null =>
    renderSelectedTranscriptExport(
        {
            bodyAvailability: 'full',
            messages: normalizeQoderTranscriptEntries(transcript.entries),
            metadata: buildMetadata(transcript.session),
            ...(transcript.session.model ? { model: transcript.session.model } : {}),
            title: transcript.session.title || transcript.session.sessionId,
        },
        options,
    );
