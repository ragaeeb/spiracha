import type {
    CommandCodeExportOptions,
    CommandCodeSessionSummary,
    CommandCodeSessionTranscript,
} from './command-code-exporter-types';
import { formatModelLabel } from './model-label';
import {
    cleanExtractedText,
    cleanInlineTitle,
    formatInlineLiteral,
    type MetadataEntry,
    renderCodeBlock,
    renderDocumentTitle,
    renderMetadataBlock,
    renderSection,
} from './shared-text';

const TOOL_OUTPUT_PREVIEW_LIMIT = 4000;

const buildMetadataEntries = (session: CommandCodeSessionSummary): MetadataEntry[] => [
    { key: 'exported_from', value: 'command_code_sessions' },
    { key: 'session_id', value: session.sessionId },
    { key: 'title', value: session.title },
    { key: 'source_transcript_path', value: session.filePath },
    { key: 'workspace_key', value: session.workspaceKey },
    { key: 'worktree', value: session.worktree },
    { key: 'cwd', value: session.cwd },
    { key: 'model', value: session.model },
    { key: 'model_label', value: session.modelLabel },
    { key: 'created_at_unix_ms', value: session.createdAtMs },
    { key: 'last_active_at_unix_ms', value: session.lastActiveAtMs },
    { key: 'record_count', value: session.recordCount },
    { key: 'message_count', value: session.messageCount },
    { key: 'tool_call_count', value: session.toolCallCount },
    { key: 'tool_output_count', value: session.toolOutputCount },
];

const roleTitle = (role: string, assistantModel: string | null): string => {
    if (role === 'assistant') {
        return formatModelLabel(assistantModel);
    }
    if (role === 'user') {
        return 'User';
    }
    if (role === 'system') {
        return 'System';
    }
    if (role === 'tool') {
        return 'Tool';
    }
    return role ? cleanInlineTitle(role) : 'Message';
};

const truncateOutput = (text: string): string => {
    return text.length <= TOOL_OUTPUT_PREVIEW_LIMIT
        ? text
        : `${text.slice(0, TOOL_OUTPUT_PREVIEW_LIMIT)}\n... (truncated)`;
};

const renderToolCall = (
    message: CommandCodeSessionTranscript['messages'][number],
    options: CommandCodeExportOptions,
) => {
    if (!options.includeTools) {
        return '';
    }

    const tool = message.toolEvidence;
    const lines = [`Tool: ${formatInlineLiteral(tool?.name ?? 'unknown', options.outputFormat)}`];
    if (tool?.callId) {
        lines.push(`Call ID: ${tool.callId}`);
    }
    if (tool?.status) {
        lines.push(`Status: ${tool.status}`);
    }
    if (tool?.inputText?.trim()) {
        lines.push('', 'Input:', '', renderCodeBlock(tool.inputText.trim(), options.outputFormat));
    }
    return renderSection('Tool Call', lines.join('\n'), options.outputFormat);
};

const renderToolOutput = (
    message: CommandCodeSessionTranscript['messages'][number],
    options: CommandCodeExportOptions,
) => {
    if (!options.includeTools) {
        return '';
    }

    const outputText = message.toolEvidence?.outputText?.trim() || cleanExtractedText(message.text).trim();
    if (!outputText) {
        return '';
    }

    const lines: string[] = [];
    if (message.toolEvidence?.callId) {
        lines.push(`Call ID: ${message.toolEvidence.callId}`, '');
    }
    lines.push(renderCodeBlock(truncateOutput(outputText), options.outputFormat));
    return renderSection('Tool Output', lines.join('\n'), options.outputFormat);
};

const renderMessage = (
    message: CommandCodeSessionTranscript['messages'][number],
    options: CommandCodeExportOptions,
    assistantModel: string | null,
) => {
    if ((message.phase === 'commentary' || message.phase === 'reasoning') && !options.includeCommentary) {
        return '';
    }
    if (message.phase === 'tool_call') {
        return renderToolCall(message, options);
    }
    if (message.phase === 'tool_output') {
        return renderToolOutput(message, options);
    }

    const text = cleanExtractedText(message.text).trim();
    return text
        ? renderSection(roleTitle(message.role, message.model ?? assistantModel), text, options.outputFormat)
        : '';
};

export const renderCommandCodeTranscript = (
    transcript: CommandCodeSessionTranscript,
    options: CommandCodeExportOptions,
): string | null => {
    const sections = transcript.messages
        .map((message) => renderMessage(message, options, transcript.session.model))
        .filter(Boolean);
    if (sections.length === 0) {
        return null;
    }

    const parts = [
        renderDocumentTitle(
            cleanInlineTitle(transcript.session.title || transcript.session.sessionId),
            options.outputFormat,
        ),
        '',
        options.includeMetadata
            ? renderMetadataBlock(buildMetadataEntries(transcript.session), options.outputFormat)
            : '',
        ...sections,
    ].filter(Boolean);
    return `${parts.join('\n').trimEnd()}\n`;
};
