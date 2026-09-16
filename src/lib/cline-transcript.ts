import type { ClineExportOptions, ClineTaskTranscript } from './cline-exporter-types';
import { normalizeClineTranscriptMessages } from './cline-transcript-parser';
import { renderNormalizedExport } from './conversation-data/conversation-export';

export const renderClineTranscript = (transcript: ClineTaskTranscript, options: ClineExportOptions): string => {
    return renderNormalizedExport(
        {
            bodyAvailability: 'full',
            messages: normalizeClineTranscriptMessages(transcript.messages),
            metadata: {
                created_at_unix_ms: transcript.task.createdAtMs,
                exported_from: 'cline_session_messages',
                last_updated_at_unix_ms: transcript.task.lastActiveAtMs,
                model: transcript.task.modelId,
                session_id: transcript.task.taskId,
                workspace: transcript.task.worktree,
            },
            ...(transcript.task.modelId ? { model: transcript.task.modelId } : {}),
            title: transcript.task.title,
        },
        {
            completeness: 'allow_partial',
            includeCommentary: options.includeCommentary,
            includeMetadata: options.includeMetadata,
            includeTools: options.includeTools,
            outputFormat: options.outputFormat,
        },
    );
};
