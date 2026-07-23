import type {
    MiniMaxCodeExportOptions,
    MiniMaxCodeSessionSummary,
    MiniMaxCodeSessionTranscript,
    MiniMaxCodeToolCall,
    MiniMaxCodeTranscriptMessage,
} from './minimax-code-exporter-types';
import { getMiniMaxCodeMessagePhase } from './minimax-code-transcript-phase';
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

const buildMetadataEntries = (session: MiniMaxCodeSessionSummary): MetadataEntry[] => [
    { key: 'exported_from', value: 'minimax_code_v2_snapshot' },
    { key: 'session_id', value: session.sessionId },
    { key: 'title', value: session.title },
    { key: 'source_snapshot_path', value: session.snapshotPath },
    { key: 'workspace_key', value: session.workspaceKey },
    { key: 'worktree', value: session.worktree },
    { key: 'agent_name', value: session.agentName },
    { key: 'model', value: session.currentModelId },
    { key: 'model_variant', value: session.currentModelVariant },
    { key: 'status', value: session.status },
    { key: 'created_at_unix_ms', value: session.createdAtMs },
    { key: 'last_updated_at_unix_ms', value: session.lastActiveAtMs },
    { key: 'message_count', value: session.messageCount },
    { key: 'tool_call_count', value: session.toolCallCount },
    { key: 'tool_result_count', value: session.toolResultCount },
];

const truncateOutput = (text: string): string => {
    return text.length <= TOOL_OUTPUT_PREVIEW_LIMIT
        ? text
        : `${text.slice(0, TOOL_OUTPUT_PREVIEW_LIMIT)}\n... (truncated)`;
};

const roleTitle = (role: string): string => {
    if (role === 'assistant') {
        return 'Assistant';
    }
    if (role === 'user') {
        return 'User';
    }
    return role ? cleanInlineTitle(role) : 'Message';
};

const renderToolCall = (toolCall: MiniMaxCodeToolCall, options: MiniMaxCodeExportOptions): string[] => {
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

const renderMessage = (message: MiniMaxCodeTranscriptMessage, options: MiniMaxCodeExportOptions): string[] => {
    const sections: string[] = [];
    if (options.includeCommentary && message.reasoning) {
        const reasoning = cleanExtractedText(message.reasoning).trim();
        if (reasoning) {
            sections.push(renderSection('Reasoning', reasoning, options.outputFormat));
        }
    }

    const content = cleanExtractedText(message.content ?? '').trim();
    const isCommentary = getMiniMaxCodeMessagePhase(message) === 'commentary';
    if (content && (!isCommentary || options.includeCommentary || message.role !== 'assistant')) {
        sections.push(renderSection(roleTitle(message.role), content, options.outputFormat));
    }

    sections.push(...message.toolCalls.flatMap((toolCall) => renderToolCall(toolCall, options)));
    return sections;
};

export const renderMiniMaxCodeTranscript = (
    transcript: MiniMaxCodeSessionTranscript,
    options: MiniMaxCodeExportOptions,
): string | null => {
    const sections = transcript.messages.flatMap((message) => renderMessage(message, options)).filter(Boolean);
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
