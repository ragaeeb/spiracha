import type {
    CursorBubble,
    CursorExportOptions,
    CursorThreadHead,
    CursorThreadTranscript,
    CursorToolCall,
} from './cursor-exporter-types';
import {
    cleanExtractedText,
    cleanInlineTitle,
    type ExportFormat,
    formatInlineLiteral,
    type MetadataEntry,
    renderCodeBlock,
    renderDocumentTitle,
    renderMetadataBlock,
    renderSection,
} from './shared';

const TOOL_RESULT_PREVIEW_LIMIT = 4000;

const formatUnixMillis = (value: number | null): string | null => {
    if (value === null || value === undefined) {
        return null;
    }

    return new Date(value).toISOString();
};

const prettyToolArguments = (argumentsText: string | null): string | null => {
    if (!argumentsText) {
        return null;
    }

    try {
        return JSON.stringify(JSON.parse(argumentsText), null, 2);
    } catch {
        return argumentsText;
    }
};

const truncateResult = (resultText: string): string => {
    if (resultText.length <= TOOL_RESULT_PREVIEW_LIMIT) {
        return resultText;
    }

    return `${resultText.slice(0, TOOL_RESULT_PREVIEW_LIMIT)}\n... (truncated)`;
};

export const renderCursorToolCall = (toolCall: CursorToolCall, outputFormat: ExportFormat): string => {
    const lines: string[] = [`Tool: ${formatInlineLiteral(toolCall.name, outputFormat)}`];
    if (toolCall.status) {
        lines.push(`Status: ${toolCall.status}`);
    }

    const args = prettyToolArguments(toolCall.argumentsText);
    if (args) {
        lines.push('', 'Arguments:', '', renderCodeBlock(args, outputFormat));
    }

    const result = toolCall.resultText?.trim();
    if (result) {
        lines.push('', 'Result:', '', renderCodeBlock(truncateResult(result), outputFormat));
    }

    return renderSection('Tool Call', lines.join('\n'), outputFormat);
};

const renderUserBubble = (bubble: CursorBubble, outputFormat: ExportFormat): string => {
    const text = cleanExtractedText(bubble.text).trim();
    return text ? renderSection('User', text, outputFormat) : '';
};

const renderAssistantBubble = (bubble: CursorBubble, options: CursorExportOptions): string[] => {
    const blocks: string[] = [];

    if (options.includeCommentary && bubble.thinking?.trim()) {
        const reasoning = cleanExtractedText(bubble.thinking).trim();
        if (reasoning) {
            blocks.push(renderSection('Reasoning', reasoning, options.outputFormat));
        }
    }

    const text = cleanExtractedText(bubble.text).trim();
    if (text) {
        blocks.push(renderSection('Assistant', text, options.outputFormat));
    }

    if (options.includeTools && bubble.toolCall) {
        blocks.push(renderCursorToolCall(bubble.toolCall, options.outputFormat));
    }

    return blocks;
};

export const renderCursorBubble = (bubble: CursorBubble, options: CursorExportOptions): string[] => {
    if (bubble.kind === 'user') {
        const block = renderUserBubble(bubble, options.outputFormat);
        return block ? [block] : [];
    }

    return renderAssistantBubble(bubble, options);
};

const getThreadTitle = (head: CursorThreadHead): string => {
    if (head.name) {
        return cleanInlineTitle(head.name);
    }

    return head.composerId;
};

const buildMetadataEntries = (transcript: CursorThreadTranscript): MetadataEntry[] => {
    const { head } = transcript;

    return [
        { key: 'exported_from', value: 'cursor_global_storage_bubbles' },
        { key: 'composer_id', value: head.composerId },
        { key: 'title', value: head.name },
        { key: 'mode', value: head.mode },
        { key: 'created_at_unix_ms', value: head.createdAtMs },
        { key: 'created_at_iso', value: formatUnixMillis(head.createdAtMs) },
        { key: 'last_updated_at_unix_ms', value: head.lastUpdatedAtMs },
        { key: 'last_updated_at_iso', value: formatUnixMillis(head.lastUpdatedAtMs) },
        { key: 'rendered_message_count', value: transcript.renderableBubbleCount },
        {
            key: 'omitted_message_count',
            value: transcript.omittedBubbleCount > 0 ? transcript.omittedBubbleCount : null,
        },
    ];
};

const buildTruncationNotice = (transcript: CursorThreadTranscript, outputFormat: ExportFormat): string => {
    if (transcript.omittedBubbleCount <= 0) {
        return '';
    }

    const orderedCount = transcript.head.orderedBubbleIds.length;
    const message = [
        `Cursor indexed only the most recent ${orderedCount} of`,
        `${orderedCount + transcript.omittedBubbleCount} stored messages for this thread,`,
        'so earlier messages are not part of its conversation index and are not included here.',
    ].join(' ');

    return renderSection('Note', message, outputFormat);
};

export const renderCursorTranscript = (
    transcript: CursorThreadTranscript,
    options: CursorExportOptions,
): string | null => {
    const sections: string[] = [];
    for (const bubble of transcript.bubbles) {
        sections.push(...renderCursorBubble(bubble, options));
    }

    if (sections.length === 0) {
        return null;
    }

    const title = getThreadTitle(transcript.head);
    const parts = [
        renderDocumentTitle(title, options.outputFormat),
        '',
        options.includeMetadata ? renderMetadataBlock(buildMetadataEntries(transcript), options.outputFormat) : '',
        buildTruncationNotice(transcript, options.outputFormat),
        ...sections,
    ].filter(Boolean);

    return `${parts.join('\n').trimEnd()}\n`;
};
