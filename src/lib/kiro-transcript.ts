import type {
    KiroExportOptions,
    KiroSessionSummary,
    KiroSessionTranscript,
    KiroTranscriptEntry,
    KiroTranscriptPart,
} from './kiro-exporter-types';
import { getFinalKiroAssistantMessageEntryIds, getKiroMessagePhase } from './kiro-transcript-phase';
import {
    cleanExtractedText,
    cleanInlineTitle,
    type MetadataEntry,
    renderDocumentTitle,
    renderMetadataBlock,
    renderSection,
} from './shared';

const getSessionTitle = (session: KiroSessionSummary): string => {
    return cleanInlineTitle(session.title || session.sessionId);
};

const buildMetadataEntries = (session: KiroSessionSummary): MetadataEntry[] => [
    { key: 'exported_from', value: 'kiro_workspace_sessions' },
    { key: 'session_id', value: session.sessionId },
    { key: 'title', value: session.title },
    { key: 'source_session_path', value: session.filePath },
    { key: 'workspace_key', value: session.workspaceKey },
    { key: 'workspace_directory', value: session.workspaceDirectory },
    { key: 'workspace_path', value: session.workspacePath },
    { key: 'selected_model', value: session.selectedModel },
    { key: 'default_model_title', value: session.defaultModelTitle },
    { key: 'selected_profile_id', value: session.selectedProfileId },
    { key: 'autonomy_mode', value: session.autonomyMode },
    { key: 'session_type', value: session.sessionType },
    { key: 'created_at_iso', value: session.createdAtIso },
    { key: 'last_active_at_iso', value: session.lastActiveAtIso },
    { key: 'message_count', value: session.messageCount },
    { key: 'image_count', value: session.imageCount },
    { key: 'prompt_log_count', value: session.promptLogCount },
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

const renderTextPart = (part: KiroTranscriptPart, title: string, options: KiroExportOptions): string => {
    const text = cleanExtractedText(part.text ?? '').trim();
    return text ? renderSection(title, text, options.outputFormat) : '';
};

const renderImagePart = (part: KiroTranscriptPart, options: KiroExportOptions): string => {
    if (!options.includeCommentary) {
        return '';
    }

    const text = cleanExtractedText(part.text ?? 'Image attachment').trim();
    return renderSection('Attachment', text, options.outputFormat);
};

const renderPart = (
    entry: KiroTranscriptEntry,
    part: KiroTranscriptPart,
    options: KiroExportOptions,
    finalAssistantMessageEntryIds: Set<string>,
): string => {
    if (entry.entryType === 'tool_call') {
        return options.includeTools && part.type === 'text' ? renderTextPart(part, 'Tool call', options) : '';
    }

    if (getKiroMessagePhase(entry, finalAssistantMessageEntryIds) === 'commentary' && !options.includeCommentary) {
        return '';
    }

    switch (part.type) {
        case 'text':
            return renderTextPart(part, roleTitle(entry.role), options);
        case 'image':
            return renderImagePart(part, options);
        case 'unknown':
            return '';
    }
};

export const renderKiroTranscript = (transcript: KiroSessionTranscript, options: KiroExportOptions): string | null => {
    const finalAssistantMessageEntryIds = getFinalKiroAssistantMessageEntryIds(transcript.entries);
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
