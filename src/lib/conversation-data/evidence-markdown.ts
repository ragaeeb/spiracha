import { applyPathTransforms } from '../path-transforms';
import { buildEvidenceEpisodes } from './evidence-episodes';
import { buildEvidenceEvents } from './evidence-events';
import { createEvidenceProjectionState, fencedEvidenceText, projectEvidenceText } from './evidence-projector';
import type { ConversationDetail, ConversationEvidenceEvent, ConversationEvidenceExport, EvidenceLens } from './types';

export const EVIDENCE_RENDERER_VERSION = 'focused-evidence/v2';

type BuildEvidenceExportOptions = { generatedAt?: string };

const portable = (text: string, conversation: ConversationDetail) =>
    applyPathTransforms(text, {
        convertToProjectRoot: true,
        projectPath: conversation.workspacePath,
        redactUsername: true,
    });

const inlineMarkdown = (text: string, conversation: ConversationDetail) =>
    portable(text, conversation)
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .replace(/[!\\`*_[\]<>]/gu, '\\$&');

const unique = (values: Array<string | null>) => [
    ...new Set(values.filter((value): value is string => Boolean(value))),
];

const eventRange = (events: ConversationEvidenceEvent[]) => {
    const orders = events.map((event) => event.order);
    return orders.length ? `${Math.min(...orders)}-${Math.max(...orders)}` : 'unknown';
};

const projectEventTexts = (
    events: ConversationEvidenceEvent[],
    maximum: number,
    getText: (event: ConversationEvidenceEvent) => string,
    separator: string,
    conversation: ConversationDetail,
    state: ReturnType<typeof createEvidenceProjectionState>,
) => {
    const projected: string[] = [];
    let used = 0;
    for (const event of events) {
        const separatorLength = projected.length > 0 ? separator.length : 0;
        const remaining = maximum - used - separatorLength;
        if (remaining <= 0) {
            state.stats.truncatedFields += 1;
            break;
        }
        const text = projectEvidenceText(getText(event), remaining, state);
        projected.push(portable(text, conversation));
        used += separatorLength + text.length;
    }
    return projected.join(separator);
};

const inputCharacterCount = (event: ConversationEvidenceEvent) => {
    let count = event.text.length;
    for (const value of [event.tool?.command, event.tool?.inputText, event.tool?.outputText]) {
        if (value && value !== event.text) {
            count += value.length;
        }
    }
    return count;
};

const episodeMarkdown = (
    episode: ReturnType<typeof buildEvidenceEpisodes>[number],
    index: number,
    lens: EvidenceLens,
    conversation: ConversationDetail,
    state: ReturnType<typeof createEvidenceProjectionState>,
) => {
    const calls = episode.events.filter((event) => event.phase === 'tool_call');
    const outputs = episode.events.filter((event) => event.phase === 'tool_output');
    const context = episode.events.filter(
        (event) =>
            event.phase === 'commentary' || (lens.context.includeReasoningSummaries && event.phase === 'reasoning'),
    );
    const anchorName = inlineMarkdown(
        episode.anchor.tool?.name ?? (episode.anchor.text.slice(0, 80) || 'matched evidence'),
        conversation,
    );
    const resultBudget =
        episode.outcome === 'failed' ? lens.budget.failedOutputCharacters : lens.budget.successfulOutputCharacters;
    const projectedInvocation = projectEventTexts(
        calls,
        Math.max(300, resultBudget),
        (event) => event.tool?.command ?? event.tool?.inputText ?? event.text,
        '\n\nRetry:\n',
        conversation,
        state,
    );
    const projectedContext = projectEventTexts(
        context,
        lens.budget.commentaryCharactersPerEpisode,
        (event) => event.text,
        '\n\n',
        conversation,
        state,
    );
    const projectedResult = projectEventTexts(
        outputs,
        resultBudget,
        (event) => event.tool?.outputText ?? event.text,
        '\n\n',
        conversation,
        state,
    );
    const anchorNeedsDirectProjection = !['commentary', 'reasoning', 'tool_call', 'tool_output'].includes(
        episode.anchor.phase,
    );
    const projectedMatchedEvidence = anchorNeedsDirectProjection
        ? projectEventTexts(
              [episode.anchor],
              Math.max(300, resultBudget),
              (event) => event.text,
              '\n\n',
              conversation,
              state,
          )
        : '';
    const callIds = unique(episode.events.map((event) => event.tool?.callId ?? null));
    const messageIds = unique(episode.events.map((event) => event.messageId));
    const pairing = unique(episode.events.map((event) => event.pairingConfidence));
    return [
        `## Episode ${index + 1}: ${anchorName} — ${episode.outcome}`,
        '',
        '**Invocation**',
        projectedInvocation ? fencedEvidenceText(projectedInvocation) : '_No invocation text available._',
        '',
        '**Context**',
        projectedContext ? fencedEvidenceText(projectedContext) : '_No nearby commentary selected._',
        '',
        '**Result**',
        projectedResult ? fencedEvidenceText(projectedResult) : '_No paired result available._',
        '',
        ...(projectedMatchedEvidence ? ['**Matched evidence**', fencedEvidenceText(projectedMatchedEvidence), ''] : []),
        '**Retry / workaround**',
        calls.length > 1 ? `${calls.length - 1} bounded retry event(s) retained.` : '_None retained._',
        '',
        '**Trace**',
        `- Message IDs: ${inlineMarkdown(messageIds.join(', ') || 'none', conversation)}`,
        `- Call IDs: ${inlineMarkdown(callIds.join(', ') || 'none', conversation)}`,
        `- Pairing: ${pairing.join(', ')}`,
        `- Event order: ${eventRange(episode.events)}`,
        `- Original reference: ${inlineMarkdown(conversation.deepLinks.spiracha, conversation)}`,
        '',
    ].join('\n');
};

const omissionMarkdown = (state: ReturnType<typeof createEvidenceProjectionState>, retainedRanges: string[]) => {
    const { stats } = state;
    return [
        '## Omitted evidence',
        '',
        `- Input events / characters inspected: ${stats.inputEvents} / ${stats.inputCharacters}`,
        `- Selected / omitted events: ${stats.selectedEvents} / ${stats.omittedEvents}`,
        `- Truncated fields / arrays: ${stats.truncatedFields} / ${stats.truncatedArrays}`,
        `- Deduplicated diagnostics: ${stats.deduplicatedDiagnostics}`,
        `- Omitted binary or opaque payloads: ${stats.omittedBinaryPayloads}`,
        `- Budget reached: ${stats.budgetReached ? 'yes' : 'no'}`,
        `- Retained source event-order ranges: ${retainedRanges.join(', ') || 'none'}`,
        '',
    ].join('\n');
};

export const buildEvidenceExport = (
    conversation: ConversationDetail,
    lens: EvidenceLens,
    options: BuildEvidenceExportOptions = {},
): ConversationEvidenceExport => {
    const generatedAt = options.generatedAt ?? new Date().toISOString();
    const events = buildEvidenceEvents(conversation);
    const inputCharacters = events.reduce((total, event) => total + inputCharacterCount(event), 0);
    const state = createEvidenceProjectionState(events.length, inputCharacters);
    const episodes = buildEvidenceEpisodes(events, lens);
    const title = inlineMarkdown(conversation.title?.trim() || 'Conversation', conversation);
    const header = [
        `# Focused evidence: ${title}`,
        '',
        `- Source: ${conversation.source}`,
        `- Conversation: ${inlineMarkdown(conversation.id, conversation)}`,
        `- Lens: ${inlineMarkdown(lens.name, conversation)}`,
        `- Generated: ${inlineMarkdown(generatedAt, conversation)}`,
        `- Renderer: ${EVIDENCE_RENDERER_VERSION}`,
        `- Budget: ${lens.budget.totalCharacters} characters`,
        `- Retained / inspected: pending / ${events.length}`,
        `- Approximate token reduction: pending`,
        '',
    ].join('\n');
    const retainedRanges: string[] = [];
    const sections: Array<{ eventCount: number; markdown: string; range: string }> = [];
    let used = header.length;
    for (const [index, episode] of episodes.entries()) {
        const section = episodeMarkdown(episode, index, lens, conversation, state);
        const range = eventRange(episode.events);
        const prospectiveLedger = omissionMarkdown(state, [...retainedRanges, range]);
        if (used + section.length + prospectiveLedger.length > lens.budget.totalCharacters) {
            state.stats.budgetReached = true;
            break;
        }
        sections.push({ eventCount: episode.events.length, markdown: section, range });
        used += section.length;
        retainedRanges.push(range);
        state.stats.selectedEvents += episode.events.length;
    }
    state.stats.omittedEvents = Math.max(0, events.length - state.stats.selectedEvents);
    const renderMarkdown = () => {
        const ledger = omissionMarkdown(state, retainedRanges);
        const retained = state.stats.selectedEvents;
        const estimatedInputTokens = Math.ceil(inputCharacters / 4);
        const estimatedOutputTokens = Math.ceil((used + ledger.length) / 4);
        const reduction =
            estimatedInputTokens > 0
                ? Math.max(0, Math.round((1 - estimatedOutputTokens / estimatedInputTokens) * 100))
                : 0;
        const finalHeader = header
            .replace(
                `Retained / inspected: pending / ${events.length}`,
                `Retained / inspected: ${retained} / ${events.length}`,
            )
            .replace('Approximate token reduction: pending', `Approximate token reduction: ${reduction}%`);
        return `${finalHeader}${sections.map((section) => section.markdown).join('')}${ledger}`;
    };
    let markdown = renderMarkdown();
    while (markdown.length > lens.budget.totalCharacters && sections.length > 0) {
        const removed = sections.pop()!;
        retainedRanges.pop();
        state.stats.budgetReached = true;
        state.stats.selectedEvents -= removed.eventCount;
        state.stats.omittedEvents = Math.max(0, events.length - state.stats.selectedEvents);
        used -= removed.markdown.length;
        markdown = renderMarkdown();
    }
    return {
        markdown,
        meta: {
            approximateTokens: Math.ceil(markdown.length / 4),
            episodeCount: sections.length,
            generatedAt,
            omission: state.stats,
            projectedCharacters: markdown.length,
            rendererVersion: EVIDENCE_RENDERER_VERSION,
        },
    };
};
