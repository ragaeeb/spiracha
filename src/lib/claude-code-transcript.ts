import type {
    ClaudeCodeExportOptions,
    ClaudeCodeSessionSummary,
    ClaudeCodeSessionTranscript,
    ClaudeCodeTranscriptEntry,
    ClaudeCodeTranscriptPart,
} from './claude-code-exporter-types';
import { getClaudeCodeAssistantMessagePhase } from './claude-code-transcript-phase';
import {
    buildHeadroomMetadataEntries,
    type HeadroomRehydrator,
    resolveHeadroomRehydrator,
} from './headroom-transcript-rehydration';
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

const getSessionTitle = (session: ClaudeCodeSessionSummary): string => {
    return cleanInlineTitle(session.title || session.sessionId);
};

const buildMetadataEntries = (
    session: ClaudeCodeSessionSummary,
    rehydrator: HeadroomRehydrator | null,
): MetadataEntry[] => [
    { key: 'exported_from', value: 'claude_code_local_jsonl' },
    { key: 'session_id', value: session.sessionId },
    { key: 'title', value: session.title },
    { key: 'source_transcript_path', value: session.filePath },
    { key: 'workspace_key', value: session.workspaceKey },
    { key: 'worktree', value: session.worktree },
    { key: 'cwd', value: session.cwd },
    { key: 'model', value: session.model },
    { key: 'version', value: session.version },
    { key: 'git_branch', value: session.gitBranch },
    { key: 'created_at_iso', value: session.createdAtIso },
    { key: 'last_active_at_iso', value: session.lastActiveAtIso },
    { key: 'message_count', value: session.messageCount },
    { key: 'tool_call_count', value: session.toolCallCount },
    { key: 'tool_result_count', value: session.toolResultCount },
    { key: 'total_tokens', value: session.totalTokens },
    ...buildHeadroomMetadataEntries(rehydrator),
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

    return role ? cleanInlineTitle(role) : 'Message';
};

const truncateOutput = (text: string): string => {
    if (text.length <= TOOL_OUTPUT_PREVIEW_LIMIT) {
        return text;
    }

    return `${text.slice(0, TOOL_OUTPUT_PREVIEW_LIMIT)}\n... (truncated)`;
};

const rehydrateClaudeText = (
    text: string,
    entry: ClaudeCodeTranscriptEntry,
    options: ClaudeCodeExportOptions,
    sessionId: string,
): string => {
    const rehydrator = options.headroomRehydrator;
    return (
        rehydrator?.rehydrateText(text, {
            client: 'claude-code',
            model: entry.model ?? null,
            provider: 'anthropic',
            sessionId,
        }) ?? text
    );
};

const renderTextPart = (
    entry: ClaudeCodeTranscriptEntry,
    part: ClaudeCodeTranscriptPart,
    role: string,
    options: ClaudeCodeExportOptions,
    sessionId: string,
): string => {
    const text = cleanExtractedText(rehydrateClaudeText(part.text ?? '', entry, options, sessionId)).trim();
    return text ? renderSection(roleTitle(role), text, options.outputFormat) : '';
};

const renderThinkingPart = (
    entry: ClaudeCodeTranscriptEntry,
    part: ClaudeCodeTranscriptPart,
    options: ClaudeCodeExportOptions,
    sessionId: string,
): string => {
    if (!options.includeCommentary) {
        return '';
    }

    const text = cleanExtractedText(rehydrateClaudeText(part.text ?? '', entry, options, sessionId)).trim();
    return text ? renderSection('Reasoning', text, options.outputFormat) : '';
};

const renderToolUsePart = (part: ClaudeCodeTranscriptPart, options: ClaudeCodeExportOptions): string => {
    if (!options.includeTools) {
        return '';
    }

    const toolName = part.toolName ?? 'unknown';
    const lines = [`Tool: ${formatInlineLiteral(toolName, options.outputFormat)}`];
    if (part.toolUseId) {
        lines.push(`Call ID: ${part.toolUseId}`);
    }
    if (part.argumentsText?.trim()) {
        lines.push('', 'Input:', '', renderCodeBlock(part.argumentsText.trim(), options.outputFormat));
    }

    return renderSection('Tool Call', lines.join('\n'), options.outputFormat);
};

const renderToolResultPart = (
    entry: ClaudeCodeTranscriptEntry,
    part: ClaudeCodeTranscriptPart,
    options: ClaudeCodeExportOptions,
    sessionId: string,
): string => {
    if (!options.includeTools) {
        return '';
    }

    const outputText = rehydrateClaudeText(part.outputText ?? '', entry, options, sessionId).trim();
    if (!outputText) {
        return '';
    }

    const lines: string[] = [];
    if (part.isError) {
        lines.push('Error: true', '');
    }
    if (part.toolUseId) {
        lines.push(`Call ID: ${part.toolUseId}`, '');
    }
    lines.push(renderCodeBlock(truncateOutput(outputText), options.outputFormat));
    return renderSection('Tool Output', lines.join('\n'), options.outputFormat);
};

const renderAttachmentPart = (
    entry: ClaudeCodeTranscriptEntry,
    part: ClaudeCodeTranscriptPart,
    options: ClaudeCodeExportOptions,
    sessionId: string,
): string => {
    if (!options.includeCommentary) {
        return '';
    }

    const text = cleanExtractedText(rehydrateClaudeText(part.text ?? '', entry, options, sessionId)).trim();
    if (!text) {
        return '';
    }

    const title = part.attachmentType ? `Attachment: ${part.attachmentType}` : 'Attachment';
    return renderSection(title, text, options.outputFormat);
};

const renderPart = (
    entry: ClaudeCodeTranscriptEntry,
    part: ClaudeCodeTranscriptPart,
    options: ClaudeCodeExportOptions,
    sessionId: string,
): string => {
    switch (part.type) {
        case 'text':
            if (getClaudeCodeAssistantMessagePhase(entry) === 'commentary' && !options.includeCommentary) {
                return '';
            }
            return renderTextPart(entry, part, entry.role, options, sessionId);
        case 'thinking':
            return renderThinkingPart(entry, part, options, sessionId);
        case 'tool_use':
            return renderToolUsePart(part, options);
        case 'tool_result':
            return renderToolResultPart(entry, part, options, sessionId);
        case 'attachment':
            return renderAttachmentPart(entry, part, options, sessionId);
        case 'unknown':
            return '';
    }
};

export const renderClaudeCodeTranscript = (
    transcript: ClaudeCodeSessionTranscript,
    options: ClaudeCodeExportOptions,
): string | null => {
    const rehydrator = options.headroomRehydrator ?? resolveHeadroomRehydrator(options);
    const renderOptions = { ...options, headroomRehydrator: rehydrator };
    const sections = transcript.entries.flatMap((entry) =>
        entry.parts.map((part) => renderPart(entry, part, renderOptions, transcript.session.sessionId)).filter(Boolean),
    );
    if (sections.length === 0) {
        return null;
    }

    const parts = [
        renderDocumentTitle(getSessionTitle(transcript.session), options.outputFormat),
        '',
        options.includeMetadata
            ? renderMetadataBlock(buildMetadataEntries(transcript.session, rehydrator), options.outputFormat)
            : '',
        ...sections,
    ].filter(Boolean);

    return `${parts.join('\n').trimEnd()}\n`;
};
