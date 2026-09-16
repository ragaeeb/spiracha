import { formatModelLabel } from '../model-label';
import { cleanInlineTitle, renderDocumentTitle, renderMetadataBlock } from '../shared-text';
import { type CanonicalInclusionBucket, classifyCanonicalInclusionBucket } from './adapter-helpers';
import {
    type CompactExportFlags,
    expandNormalizedExportOptions,
    type NormalizedExportFormat,
    type NormalizedExportInclude,
    type NormalizedExportOptions,
} from './export-options';
import { selectConversationMessages } from './message-selector';
import { IncompleteTranscriptError } from './operation-types';
import type {
    ContentState,
    ConversationArtifact,
    ConversationBodyAvailability,
    ConversationMessage,
    ConversationMessageSelector,
    SupplementalEvent,
} from './types';

export type ExportableConversation = {
    artifacts?: ConversationArtifact[];
    bodyAvailability?: ConversationBodyAvailability;
    messages: ConversationMessage[];
    metadata?: Record<string, unknown>;
    model?: string;
    supplementalEvents?: SupplementalEvent[];
    title: string | null;
};

const INCLUDE_BY_BUCKET = {
    assistant_commentary: 'commentary',
    assistant_final: 'assistantFinal',
    reasoning: 'reasoning',
    system: 'system',
    tool_call: 'toolCalls',
    tool_output: 'toolOutputs',
    unknown: 'unknown',
    user: 'user',
} as const satisfies Record<CanonicalInclusionBucket, keyof NormalizedExportInclude>;

const isAvailableFull = (state: ContentState | null | undefined) =>
    state == null || (state.state === 'available' && state.representation === 'full');

const messageIsAvailableFull = (message: ConversationMessage) => {
    if (!isAvailableFull(message.contentState)) {
        return false;
    }
    const tool = message.toolEvidence;
    if (!tool) {
        return true;
    }
    return isAvailableFull(tool.inputContentState) && isAvailableFull(tool.outputContentState);
};

export const assertExportCompleteness = (
    conversation: ExportableConversation,
    options: NormalizedExportOptions,
    selected: ConversationMessage[],
) => {
    if (options.completeness !== 'require_available_full') {
        return;
    }
    if (
        conversation.bodyAvailability === 'preview' ||
        conversation.bodyAvailability === 'selected' ||
        conversation.bodyAvailability === 'summary'
    ) {
        throw new IncompleteTranscriptError(
            'Normalized export requires a full transcript read before selection; list or preview bodies cannot be exported.',
        );
    }
    if (selected.some((message) => !messageIsAvailableFull(message))) {
        throw new IncompleteTranscriptError(
            'Normalized export requires available-full message and tool bodies when completeness is require_available_full.',
        );
    }
};

export const selectExportMessages = (
    conversation: ExportableConversation,
    options: NormalizedExportOptions,
): ConversationMessage[] => {
    const visible = conversation.messages.filter((message) => {
        if (message.visibility === 'bootstrap') {
            return options.include.bootstrap;
        }
        if (message.visibility === 'synthetic') {
            return options.include.synthetic;
        }
        return true;
    });
    return selectConversationMessages(visible, options.messageSelector).filter(
        (message) => options.include[INCLUDE_BY_BUCKET[classifyCanonicalInclusionBucket(message)]],
    );
};

const assistantHeading = (kind: 'Commentary' | 'Final answer', model: string, authorName: string) => {
    if (authorName) {
        return kind === 'Commentary' ? `${authorName} · Commentary` : authorName;
    }
    return model === 'Assistant' ? `Assistant · ${kind}` : `Assistant · ${kind} · ${model}`;
};

const headingFor = (message: ConversationMessage, conversationModel?: string) => {
    const bucket = classifyCanonicalInclusionBucket(message);
    const model = formatModelLabel(message.model ?? conversationModel);
    const authorName =
        typeof message.metadata.authorName === 'string' ? cleanInlineTitle(message.metadata.authorName) : '';
    if (bucket === 'user') {
        return authorName || 'User';
    }
    if (bucket === 'system') {
        return 'System';
    }
    if (bucket === 'tool_call') {
        return 'Tool call';
    }
    if (bucket === 'tool_output') {
        return 'Tool output';
    }
    if (bucket === 'reasoning') {
        return 'Reasoning';
    }
    if (bucket === 'assistant_commentary') {
        return assistantHeading('Commentary', model, authorName);
    }
    if (bucket === 'assistant_final') {
        return assistantHeading('Final answer', model, authorName);
    }
    if (message.role === 'assistant' && model !== 'Assistant') {
        return `Unknown · ${model}`;
    }
    return 'Unknown';
};

const renderExportSection = (title: string, body: string, format: NormalizedExportFormat) => {
    if (format === 'md') {
        return body.length > 0 ? `## ${title}\n\n${body}` : `## ${title}`;
    }
    const underline = '-'.repeat(Math.max(title.length, 3));
    return body.length > 0 ? `${title}\n${underline}\n${body}` : `${title}\n${underline}`;
};

const renderMessageBody = (message: ConversationMessage) => {
    if (classifyCanonicalInclusionBucket(message) !== 'tool_call') {
        return message.toolEvidence?.outputText ?? message.text;
    }
    const tool = message.toolEvidence;
    if (!tool) {
        return message.text;
    }
    const lines = [`Tool: ${tool.name}`];
    if (tool.callId) {
        lines.push(`Call ID: ${tool.callId}`);
    }
    if (tool.command) {
        lines.push(`Command: ${tool.command}`);
    }
    if (tool.inputText != null) {
        lines.push('', 'Input:', tool.inputText);
    }
    return lines.join('\n');
};

const renderMetadata = (metadata: Record<string, unknown> | undefined, format: NormalizedExportFormat) => {
    if (!metadata) {
        return '';
    }
    return renderMetadataBlock(
        Object.entries(metadata).map(([key, value]) => ({ key, value })),
        format,
    );
};

const renderArtifacts = (artifacts: ConversationArtifact[] | undefined, format: NormalizedExportFormat) => {
    if (!artifacts?.length) {
        return [];
    }
    return artifacts.map((artifact) =>
        renderExportSection(`Artifact · ${cleanInlineTitle(artifact.title)}`, artifact.content, format),
    );
};

const renderSupplemental = (events: SupplementalEvent[] | undefined, format: NormalizedExportFormat) => {
    if (!events?.length) {
        return [];
    }
    return events.map((event) => renderExportSection(`Supplemental · ${event.kind}`, event.text, format));
};

const joinExportSections = (sections: string[]) => {
    let document = sections[0] ?? '';
    for (const section of sections.slice(1)) {
        document = document.endsWith('\n') ? `${document}\n${section}` : `${document}\n\n${section}`;
    }
    return document.endsWith('\n') ? document : `${document}\n`;
};

export const renderNormalizedExport = (
    conversation: ExportableConversation,
    options: Partial<NormalizedExportOptions> & CompactExportFlags = {},
) => {
    const resolved = expandNormalizedExportOptions(options);
    const selected = selectExportMessages(conversation, resolved);
    assertExportCompleteness(conversation, resolved, selected);
    const title = conversation.title?.trim() || 'Conversation';
    const sections = [
        renderDocumentTitle(title, resolved.format),
        resolved.include.metadata ? renderMetadata(conversation.metadata, resolved.format) : '',
        ...selected.map((message) =>
            renderExportSection(headingFor(message, conversation.model), renderMessageBody(message), resolved.format),
        ),
        ...(resolved.include.artifacts ? renderArtifacts(conversation.artifacts, resolved.format) : []),
        ...(resolved.include.supplemental ? renderSupplemental(conversation.supplementalEvents, resolved.format) : []),
    ].filter((section) => section.length > 0);
    if (selected.length === 0 && !conversation.artifacts?.length) {
        sections.push(resolved.format === 'md' ? '_No messages selected._' : 'No messages selected.');
    }
    return joinExportSections(sections);
};

export const renderSelectedTranscriptExport = (
    conversation: ExportableConversation,
    options: Partial<NormalizedExportOptions> & CompactExportFlags = {},
) => {
    const resolved = expandNormalizedExportOptions({
        completeness: 'allow_partial',
        ...options,
    });
    if (selectExportMessages(conversation, resolved).length === 0) {
        return null;
    }
    return renderNormalizedExport(conversation, resolved);
};

export const renderConversationMarkdownOptions = (messageSelector?: ConversationMessageSelector) =>
    expandNormalizedExportOptions({
        completeness: 'allow_partial',
        include: {
            artifacts: true,
            assistantFinal: true,
            bootstrap: false,
            commentary: true,
            metadata: false,
            reasoning: true,
            supplemental: true,
            synthetic: false,
            system: true,
            toolCalls: true,
            toolOutputs: true,
            unknown: true,
            user: true,
        },
        messageSelector: messageSelector ?? 'all',
    });
