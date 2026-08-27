import type {
    FxExportOptions,
    FxSessionSummary,
    FxSessionTranscript,
    FxToolCall,
    FxTranscriptMessage,
} from './fx-exporter-types';
import { getFxMessagePhase } from './fx-transcript-phase';
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
} from './shared';

const TOOL_OUTPUT_PREVIEW_LIMIT = 4000;

const buildMetadataEntries = (session: FxSessionSummary): MetadataEntry[] => [
    { key: 'exported_from', value: 'fx_event_log' },
    { key: 'session_id', value: session.sessionId },
    { key: 'title', value: session.title },
    { key: 'session_directory', value: session.sessionDir },
    { key: 'workspace_key', value: session.workspaceKey },
    { key: 'worktree', value: session.worktree },
    { key: 'model', value: session.currentModelId },
    { key: 'model_variant', value: session.currentModelVariant },
    { key: 'status', value: session.status },
    { key: 'created_at_unix_ms', value: session.createdAtMs },
    { key: 'last_updated_at_unix_ms', value: session.lastActiveAtMs },
    { key: 'message_count', value: session.messageCount },
    { key: 'tool_call_count', value: session.toolCallCount },
    { key: 'tool_result_count', value: session.toolResultCount },
    { key: 'total_input_tokens', value: session.totalInputTokens },
    { key: 'total_output_tokens', value: session.totalOutputTokens },
];

const truncateOutput = (text: string): string =>
    text.length <= TOOL_OUTPUT_PREVIEW_LIMIT ? text : `${text.slice(0, TOOL_OUTPUT_PREVIEW_LIMIT)}\n... (truncated)`;

const roleTitle = (role: string, assistantModel: string | null): string => {
    if (role === 'assistant') {
        return formatModelLabel(assistantModel);
    }
    if (role === 'user') {
        return 'User';
    }
    return role ? cleanInlineTitle(role) : 'Message';
};

const renderToolCall = (toolCall: FxToolCall, options: FxExportOptions): string[] => {
    if (!options.includeTools) {
        return [];
    }
    const callLines = [`Tool: ${formatInlineLiteral(toolCall.toolName, options.outputFormat)}`];
    if (toolCall.callId) {
        callLines.push(`Call ID: ${toolCall.callId}`);
    }
    callLines.push(`Status: ${toolCall.status}`);
    if (toolCall.argumentsText?.trim()) {
        callLines.push('', 'Input:', '', renderCodeBlock(toolCall.argumentsText.trim(), options.outputFormat));
    }
    const sections = [renderSection('Tool Call', callLines.join('\n'), options.outputFormat)];
    if (toolCall.outputText?.trim()) {
        sections.push(
            renderSection(
                'Tool Output',
                renderCodeBlock(truncateOutput(toolCall.outputText.trim()), options.outputFormat),
                options.outputFormat,
            ),
        );
    }
    return sections;
};

const renderMessage = (
    message: FxTranscriptMessage,
    options: FxExportOptions,
    assistantModel: string | null,
): string[] => {
    const sections: string[] = [];
    const content = cleanExtractedText(message.content ?? '').trim();
    const isCommentary = getFxMessagePhase(message) === 'commentary';
    if (content && (!isCommentary || options.includeCommentary || message.role !== 'assistant')) {
        sections.push(renderSection(roleTitle(message.role, assistantModel), content, options.outputFormat));
    }
    sections.push(...message.toolCalls.flatMap((toolCall) => renderToolCall(toolCall, options)));
    return sections;
};

export const renderFxTranscript = (transcript: FxSessionTranscript, options: FxExportOptions): string | null => {
    const sections = transcript.messages
        .flatMap((message) => renderMessage(message, options, transcript.session.currentModelId))
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
