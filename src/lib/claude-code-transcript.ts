import type {
    ClaudeCodeExportOptions,
    ClaudeCodeSessionSummary,
    ClaudeCodeSessionTranscript,
} from './claude-code-exporter-types';
import { isClaudeCodeSyntheticTranscriptEntry } from './claude-code-transcript-phase';
import { claudeCodeTranscriptToMessages } from './conversation-data/claude-code-messages';
import { renderSelectedTranscriptExport } from './conversation-data/conversation-export';

const buildMetadata = (session: ClaudeCodeSessionSummary): Record<string, unknown> => ({
    attachment_count: session.attachmentCount,
    created_at_iso: session.createdAtIso,
    cwd: session.cwd,
    exported_from: 'claude_code_local_jsonl',
    git_branch: session.gitBranch,
    last_active_at_iso: session.lastActiveAtIso,
    message_count: session.messageCount,
    model: session.model,
    session_id: session.sessionId,
    source_transcript_path: session.filePath,
    title: session.title,
    tool_call_count: session.toolCallCount,
    tool_result_count: session.toolResultCount,
    total_tokens: session.totalTokens,
    version: session.version,
    workspace_key: session.workspaceKey,
    worktree: session.worktree,
});

export const renderClaudeCodeTranscript = (
    transcript: ClaudeCodeSessionTranscript,
    options: ClaudeCodeExportOptions,
): string | null =>
    renderSelectedTranscriptExport(
        {
            bodyAvailability: 'full',
            messages: claudeCodeTranscriptToMessages({
                ...transcript,
                entries: transcript.entries.filter((entry) => !isClaudeCodeSyntheticTranscriptEntry(entry)),
            }),
            metadata: buildMetadata(transcript.session),
            ...(transcript.session.model ? { model: transcript.session.model } : {}),
            title: transcript.session.title || transcript.session.sessionId,
        },
        options,
    );
