import type { ClineExportOptions, ClineTaskTranscript } from './cline-exporter-types';
import { formatModelLabel } from './model-label';
import {
    cleanInlineTitle,
    type MetadataEntry,
    renderDocumentTitle,
    renderMetadataBlock,
    renderSection,
} from './shared';

const phaseLabel = (phase: ClineTaskTranscript['messages'][number]['phase'], assistantLabel: string) => {
    const labels = {
        commentary: assistantLabel,
        final_answer: `${assistantLabel} (Final)`,
        reasoning: 'Reasoning',
        tool_call: 'Tool Call',
        tool_output: 'Tool Output',
        unknown: 'User',
    } as const;
    return labels[phase];
};

export const renderClineTranscript = (transcript: ClineTaskTranscript, options: ClineExportOptions): string => {
    const { task } = transcript;
    const assistantLabel = formatModelLabel(task.modelId);
    const lines = [renderDocumentTitle(cleanInlineTitle(task.title), options.outputFormat), ''];
    if (options.includeMetadata) {
        const metadata: MetadataEntry[] = [
            { key: 'exported_from', value: 'cline_session_messages' },
            { key: 'session_id', value: task.taskId },
            { key: 'workspace', value: task.worktree },
            { key: 'model', value: task.modelId },
            { key: 'created_at_unix_ms', value: task.createdAtMs },
            { key: 'last_updated_at_unix_ms', value: task.lastActiveAtMs },
        ];
        lines.push(renderMetadataBlock(metadata, options.outputFormat), '');
    }
    for (const message of transcript.messages) {
        if (!options.includeCommentary && ['commentary', 'reasoning'].includes(message.phase)) {
            continue;
        }
        if (!options.includeTools && ['tool_call', 'tool_output'].includes(message.phase)) {
            continue;
        }
        lines.push(renderSection(phaseLabel(message.phase, assistantLabel), message.text, options.outputFormat), '');
    }
    return `${lines.join('\n').trimEnd()}\n`;
};
