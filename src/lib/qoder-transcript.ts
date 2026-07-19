import type {
    QoderExportOptions,
    QoderSessionSummary,
    QoderSessionTranscript,
    QoderTranscriptEntry,
    QoderTranscriptPart,
} from './qoder-exporter-types';
import { getFinalQoderAssistantMessageEntryIds, getQoderMessagePhase } from './qoder-transcript-phase';
import {
    cleanExtractedText,
    cleanInlineTitle,
    formatInlineLiteral,
    type MetadataEntry,
    renderDocumentTitle,
    renderMetadataBlock,
    renderSection,
} from './shared';

const getSessionTitle = (session: QoderSessionSummary): string => {
    return cleanInlineTitle(session.title || session.sessionId);
};

const buildMetadataEntries = (session: QoderSessionSummary): MetadataEntry[] => [
    { key: 'exported_from', value: 'qoder_local_history' },
    { key: 'session_id', value: session.sessionId },
    { key: 'task_id', value: session.taskId },
    { key: 'request_id', value: session.requestId },
    { key: 'title', value: session.title },
    { key: 'status', value: session.status },
    { key: 'workspace_key', value: session.workspaceKey },
    { key: 'workspace_path', value: session.workspacePath },
    { key: 'workspace_storage_id', value: session.workspaceStorageId },
    { key: 'source_state_path', value: session.sourceStatePath },
    { key: 'agent_class', value: session.agentClass },
    { key: 'model', value: session.model },
    { key: 'execution_mode', value: session.executionMode },
    { key: 'created_at_iso', value: session.createdAtIso },
    { key: 'last_active_at_iso', value: session.lastActiveAtIso },
    { key: 'message_count', value: session.messageCount },
    { key: 'file_operation_count', value: session.fileOperationCount },
    { key: 'snapshot_file_count', value: session.snapshotFileCount },
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

const renderTextPart = (part: QoderTranscriptPart, title: string, options: QoderExportOptions): string => {
    const text = cleanExtractedText(part.text ?? '').trim();
    return text ? renderSection(title, text, options.outputFormat) : '';
};

const getPartString = (part: QoderTranscriptPart, key: string): string | null => {
    const value = part.raw[key];
    return typeof value === 'string' && value.trim() ? value : null;
};

const renderToolPart = (part: QoderTranscriptPart, title: string, options: QoderExportOptions): string => {
    const text = cleanExtractedText(part.text ?? '').trim();
    if (!text) {
        return '';
    }

    const lines: string[] = [];
    const toolName = getPartString(part, 'toolName');
    const toolCallId = getPartString(part, 'toolCallId');
    if (toolName) {
        lines.push(`Tool: ${formatInlineLiteral(toolName, options.outputFormat)}`);
    }
    if (toolCallId) {
        lines.push(`Call ID: ${toolCallId}`);
    }
    if (lines.length > 0) {
        lines.push('');
    }
    lines.push(text);
    return renderSection(title, lines.join('\n'), options.outputFormat);
};

const renderPart = (
    entry: QoderTranscriptEntry,
    part: QoderTranscriptPart,
    options: QoderExportOptions,
    finalAssistantMessageEntryIds: Set<string>,
): string => {
    if (entry.entryType === 'tool_call') {
        return options.includeTools && part.type === 'text' ? renderToolPart(part, 'Tool call', options) : '';
    }

    if (entry.entryType === 'tool_output') {
        return options.includeTools && part.type === 'text' ? renderToolPart(part, 'Tool output', options) : '';
    }

    if (getQoderMessagePhase(entry, finalAssistantMessageEntryIds) === 'commentary' && !options.includeCommentary) {
        return '';
    }

    switch (part.type) {
        case 'text':
            return renderTextPart(part, roleTitle(entry.role), options);
        case 'unknown':
            return '';
    }
};

export const renderQoderTranscript = (
    transcript: QoderSessionTranscript,
    options: QoderExportOptions,
): string | null => {
    const finalAssistantMessageEntryIds = getFinalQoderAssistantMessageEntryIds(transcript.entries);
    const sections = transcript.entries.flatMap((entry) =>
        entry.parts.map((part) => renderPart(entry, part, options, finalAssistantMessageEntryIds)).filter(Boolean),
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
