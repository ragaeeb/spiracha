import type {
    GrokExportOptions,
    GrokSessionSummary,
    GrokSessionTranscript,
    GrokTranscriptEntry,
    GrokTranscriptPart,
} from './grok-exporter-types';
import {
    cleanExtractedText,
    cleanInlineTitle,
    formatInlineLiteral,
    type MetadataEntry,
    renderCodeBlock,
    renderDocumentTitle,
    renderMetadataBlock,
    renderSection,
} from './shared';

const TOOL_OUTPUT_PREVIEW_LIMIT = 4000;

const getSessionTitle = (session: GrokSessionSummary): string => {
    return cleanInlineTitle(session.title || session.sessionId);
};

const buildMetadataEntries = (session: GrokSessionSummary): MetadataEntry[] => [
    { key: 'exported_from', value: 'grok_local_session' },
    { key: 'session_id', value: session.sessionId },
    { key: 'title', value: session.title },
    { key: 'source_transcript_path', value: session.chatHistoryPath },
    { key: 'workspace_key', value: session.workspaceKey },
    { key: 'worktree', value: session.worktree },
    { key: 'cwd', value: session.cwd },
    { key: 'model', value: session.currentModelId },
    { key: 'model_label', value: session.modelLabel },
    { key: 'agent_name', value: session.agentName },
    { key: 'git_branch', value: session.gitBranch },
    { key: 'created_at_iso', value: session.createdAtIso },
    { key: 'last_active_at_iso', value: session.lastActiveAtIso },
    { key: 'message_count', value: session.messageCount },
    { key: 'tool_call_count', value: session.toolCallCount },
    { key: 'tool_result_count', value: session.toolResultCount },
];

const roleTitle = (role: string): string => {
    if (role === 'assistant') {
        return 'Assistant';
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
    if (text.length <= TOOL_OUTPUT_PREVIEW_LIMIT) {
        return text;
    }

    return `${text.slice(0, TOOL_OUTPUT_PREVIEW_LIMIT)}\n... (truncated)`;
};

const renderTextPart = (entry: GrokTranscriptEntry, part: GrokTranscriptPart, options: GrokExportOptions): string => {
    const text = cleanExtractedText(part.text ?? '').trim();
    return text ? renderSection(roleTitle(entry.role), text, options.outputFormat) : '';
};

const renderReasoningPart = (part: GrokTranscriptPart, options: GrokExportOptions): string => {
    if (!options.includeCommentary) {
        return '';
    }

    const text = cleanExtractedText(part.text ?? '').trim();
    return text ? renderSection('Reasoning', text, options.outputFormat) : '';
};

const renderToolCallPart = (part: GrokTranscriptPart, options: GrokExportOptions): string => {
    if (!options.includeTools) {
        return '';
    }

    const toolName = part.toolName ?? 'unknown';
    const lines = [`Tool: ${formatInlineLiteral(toolName, options.outputFormat)}`];
    if (part.toolCallId) {
        lines.push(`Call ID: ${part.toolCallId}`);
    }
    if (part.argumentsText?.trim()) {
        lines.push('', 'Input:', '', renderCodeBlock(part.argumentsText.trim(), options.outputFormat));
    }

    return renderSection('Tool Call', lines.join('\n'), options.outputFormat);
};

const renderToolResultPart = (part: GrokTranscriptPart, options: GrokExportOptions): string => {
    if (!options.includeTools) {
        return '';
    }

    const outputText = part.outputText?.trim();
    if (!outputText) {
        return '';
    }

    const lines: string[] = [];
    if (part.toolCallId) {
        lines.push(`Call ID: ${part.toolCallId}`, '');
    }
    lines.push(renderCodeBlock(truncateOutput(outputText), options.outputFormat));
    return renderSection('Tool Output', lines.join('\n'), options.outputFormat);
};

const renderPart = (entry: GrokTranscriptEntry, part: GrokTranscriptPart, options: GrokExportOptions): string => {
    switch (part.type) {
        case 'text':
            return renderTextPart(entry, part, options);
        case 'reasoning':
            return renderReasoningPart(part, options);
        case 'tool_call':
            return renderToolCallPart(part, options);
        case 'tool_result':
            return renderToolResultPart(part, options);
        case 'unknown':
            return '';
    }
};

export const renderGrokTranscript = (transcript: GrokSessionTranscript, options: GrokExportOptions): string | null => {
    const sections = transcript.entries.flatMap((entry) =>
        entry.parts.map((part) => renderPart(entry, part, options)).filter(Boolean),
    );
    if (sections.length === 0) {
        return null;
    }

    const parts = [
        renderDocumentTitle(getSessionTitle(transcript.session), options.outputFormat),
        '',
        options.includeMetadata
            ? renderMetadataBlock(buildMetadataEntries(transcript.session), options.outputFormat)
            : '',
        ...sections,
    ].filter(Boolean);

    return `${parts.join('\n').trimEnd()}\n`;
};
