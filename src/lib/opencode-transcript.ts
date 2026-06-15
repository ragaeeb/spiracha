import type {
    OpenCodeExportOptions,
    OpenCodeSessionSummary,
    OpenCodeSessionTranscript,
    OpenCodeTranscriptPart,
} from './opencode-exporter-types';
import { splitOpenCodeThinkTaggedText } from './opencode-think-tags';
import { getFinalOpenCodeAssistantTextPartIds, getOpenCodeTextPartPhase } from './opencode-transcript-phase';
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
const MIN_DATE_MS = -8_640_000_000_000_000;
const MAX_DATE_MS = 8_640_000_000_000_000;

const formatUnixMillis = (value: number | null): string | null => {
    if (
        value === null ||
        value === undefined ||
        !Number.isFinite(value) ||
        value < MIN_DATE_MS ||
        value > MAX_DATE_MS
    ) {
        return null;
    }

    return new Date(value).toISOString();
};

const getSessionTitle = (session: OpenCodeSessionSummary): string => {
    return cleanInlineTitle(session.title || session.sessionId);
};

const buildMetadataEntries = (session: OpenCodeSessionSummary): MetadataEntry[] => [
    { key: 'exported_from', value: 'opencode_sqlite' },
    { key: 'session_id', value: session.sessionId },
    { key: 'title', value: session.title },
    { key: 'slug', value: session.slug },
    { key: 'project_id', value: session.projectId },
    { key: 'worktree', value: session.worktree },
    { key: 'directory', value: session.directory },
    { key: 'agent', value: session.agent },
    { key: 'model', value: session.modelLabel },
    { key: 'created_at_unix_ms', value: session.createdAtMs },
    { key: 'created_at_iso', value: formatUnixMillis(session.createdAtMs) },
    { key: 'last_updated_at_unix_ms', value: session.lastUpdatedAtMs },
    { key: 'last_updated_at_iso', value: formatUnixMillis(session.lastUpdatedAtMs) },
    { key: 'message_count', value: session.messageCount },
    { key: 'part_count', value: session.partCount },
    { key: 'total_tokens', value: session.totalTokens },
    { key: 'cost', value: session.cost },
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

const renderTextPart = (
    part: OpenCodeTranscriptPart,
    options: OpenCodeExportOptions,
    finalAssistantTextPartIds: Set<string>,
): string => {
    const { reasoningBlocks, visibleText } =
        part.role === 'assistant'
            ? splitOpenCodeThinkTaggedText(part.text ?? '')
            : { reasoningBlocks: [], visibleText: part.text ?? '' };
    const sections: string[] = [];

    if (options.includeCommentary) {
        sections.push(
            ...reasoningBlocks
                .map((block) => cleanExtractedText(block).trim())
                .filter(Boolean)
                .map((block) => renderSection('Reasoning', block, options.outputFormat)),
        );
    }

    const text = cleanExtractedText(visibleText).trim();
    if (
        text &&
        (getOpenCodeTextPartPhase(part, finalAssistantTextPartIds) !== 'commentary' || options.includeCommentary)
    ) {
        sections.push(renderSection(roleTitle(part.role), text, options.outputFormat));
    }

    return sections.join('\n\n');
};

const renderReasoningPart = (part: OpenCodeTranscriptPart, options: OpenCodeExportOptions): string => {
    if (!options.includeCommentary) {
        return '';
    }

    const { reasoningBlocks, visibleText } = splitOpenCodeThinkTaggedText(part.text ?? '');
    const text = cleanExtractedText([...reasoningBlocks, visibleText].filter(Boolean).join('\n\n')).trim();
    return text ? renderSection('Reasoning', text, options.outputFormat) : '';
};

const renderToolPart = (part: OpenCodeTranscriptPart, options: OpenCodeExportOptions): string => {
    if (!options.includeTools) {
        return '';
    }

    const toolName = part.toolName ?? 'unknown';
    const lines = [`Tool: ${formatInlineLiteral(toolName, options.outputFormat)}`];
    if (part.status) {
        lines.push(`Status: ${part.status}`);
    }
    if (part.callId) {
        lines.push(`Call ID: ${part.callId}`);
    }
    if (part.title) {
        lines.push(`Title: ${part.title}`);
    }
    if (part.argumentsText?.trim()) {
        lines.push('', 'Input:', '', renderCodeBlock(part.argumentsText.trim(), options.outputFormat));
    }
    if (part.outputText?.trim()) {
        lines.push('', 'Output:', '', renderCodeBlock(truncateOutput(part.outputText.trim()), options.outputFormat));
    }

    return renderSection('Tool Call', lines.join('\n'), options.outputFormat);
};

const renderPart = (
    part: OpenCodeTranscriptPart,
    options: OpenCodeExportOptions,
    finalAssistantTextPartIds: Set<string>,
): string => {
    if (part.type === 'text') {
        return renderTextPart(part, options, finalAssistantTextPartIds);
    }

    if (part.type === 'reasoning') {
        return renderReasoningPart(part, options);
    }

    if (part.type === 'tool') {
        return renderToolPart(part, options);
    }

    return '';
};

export const renderOpenCodeTranscript = (
    transcript: OpenCodeSessionTranscript,
    options: OpenCodeExportOptions,
): string | null => {
    const partsList = transcript.messages.flatMap((message) => message.parts);
    const finalAssistantTextPartIds = getFinalOpenCodeAssistantTextPartIds(partsList);
    const sections = partsList.map((part) => renderPart(part, options, finalAssistantTextPartIds)).filter(Boolean);
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
