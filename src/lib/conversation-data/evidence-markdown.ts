import { applyPathTransforms } from '../path-transforms';
import { buildEvidenceEpisodes } from './evidence-episodes';
import { buildEvidenceEvents } from './evidence-events';
import { matchEvidenceEvent } from './evidence-lens';
import { createEvidenceProjectionState, fencedEvidenceText, projectEvidenceText } from './evidence-projector';
import { evidenceRevision } from './evidence-retrieval';
import type { ConversationDetail, ConversationEvidenceEvent, ConversationEvidenceExport, EvidenceLens } from './types';

export const EVIDENCE_RENDERER_VERSION = 'focused-evidence/v5';

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

const eventRange = (events: ConversationEvidenceEvent[]) => {
    const orders = events.map((event) => event.order);
    return orders.length ? `${Math.min(...orders)}-${Math.max(...orders)}` : 'unknown';
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

const eventPriority = (event: ConversationEvidenceEvent, lens: EvidenceLens) => {
    const matched = lens.anchors.some((anchor) => matchEvidenceEvent(event, anchor));
    if (event.phase === 'final_answer') {
        return matched ? 5 : 4;
    }
    if (event.phase === 'tool_output' && event.tool?.status === 'failed') {
        return 3;
    }
    return matched ? 2 : 1;
};

const eventHeading = (event: ConversationEvidenceEvent, conversation: ConversationDetail, lens: EvidenceLens) => {
    const label =
        event.phase === 'tool_call'
            ? 'Invocation'
            : event.phase === 'tool_output'
              ? 'Result'
              : lens.anchors.some((anchor) => matchEvidenceEvent(event, anchor))
                ? 'Matched evidence'
                : 'Context';
    const author = typeof event.metadata.authorName === 'string' ? event.metadata.authorName : event.role;
    const identity = typeof event.metadata.authorId === 'string' ? ` (${event.metadata.authorId})` : '';
    const date =
        event.createdAtMs === null || !Number.isFinite(event.createdAtMs) || Math.abs(event.createdAtMs) > 8.64e15
            ? ''
            : ` · ${new Date(event.createdAtMs).toISOString()}`;
    return `**${label}** · ${inlineMarkdown(author + identity + date, conversation)}`;
};

const eventText = (event: ConversationEvidenceEvent) => {
    if (event.phase === 'tool_call') {
        return event.tool?.shellCommands?.length
            ? event.tool.shellCommands.join('\n')
            : (event.tool?.command ?? event.tool?.inputText ?? event.text);
    }
    return event.phase === 'tool_output' ? (event.tool?.outputText ?? event.text) : event.text;
};

const renderSnippet = (
    event: ConversationEvidenceEvent,
    lens: EvidenceLens,
    conversation: ConversationDetail,
    state: ReturnType<typeof createEvidenceProjectionState>,
    literals: string[],
    remainingBudget: number,
) => {
    const resultBudget =
        event.tool?.status === 'failed' || (event.tool?.exitCode ?? 0) !== 0
            ? lens.budget.failedOutputCharacters
            : lens.budget.successfulOutputCharacters;
    const allowance =
        event.phase === 'tool_output'
            ? resultBudget
            : event.phase === 'tool_call'
              ? Math.max(300, resultBudget)
              : lens.anchors.some((anchor) => matchEvidenceEvent(event, anchor))
                ? Math.max(300, lens.budget.failedOutputCharacters, lens.budget.successfulOutputCharacters)
                : lens.budget.commentaryCharactersPerEpisode;
    const remaining = Math.min(allowance, remainingBudget - 200);
    if (remaining < 80) {
        state.stats.sectionBudgetReached = true;
        return null;
    }
    const text = portable(projectEvidenceText(eventText(event), remaining, state, literals), conversation);
    const call = event.tool?.callId ? `; call ${inlineMarkdown(event.tool.callId, conversation)}` : '';
    const pairing = event.tool ? `; ${event.pairingConfidence}` : '';
    const snippet = `${eventHeading(event, conversation, lens)}\n${fencedEvidenceText(text)}\nMessage: ${inlineMarkdown(event.messageId, conversation)}${call}${pairing}\n\n`;
    const matched =
        !/^\[(?:omitted|deduplicated)/u.test(text) &&
        lens.anchors.some((anchor) =>
            anchor.kind === 'text'
                ? anchor.literals.some((literal) => text.includes(portable(literal, conversation)))
                : matchEvidenceEvent(event, anchor),
        );
    return { bodyCharacters: text.length, matched, text: snippet };
};

const episodeMarkdown = (
    episode: ReturnType<typeof buildEvidenceEpisodes>[number],
    index: number,
    lens: EvidenceLens,
    conversation: ConversationDetail,
    state: ReturnType<typeof createEvidenceProjectionState>,
) => {
    const literals = lens.anchors.flatMap((anchor) => (anchor.kind === 'text' ? anchor.literals : []));
    const anchorName = inlineMarkdown(episode.anchor.tool?.name ?? 'matched messages', conversation);
    const header = `## Episode ${index + 1}: ${anchorName} — ${episode.outcome}\n\n`;
    const maximum = Math.max(300, Math.min(8000, lens.budget.totalCharacters - 1200));
    const snippets: Array<{ event: ConversationEvidenceEvent; text: string; matched: boolean }> = [];
    let used = header.length;
    let contextRemaining = lens.budget.commentaryCharactersPerEpisode;
    const prioritized = [...episode.events].sort(
        (a, b) =>
            eventPriority(b, lens) - eventPriority(a, lens) ||
            (a.phase === 'final_answer' && b.phase === 'final_answer' ? b.order - a.order : a.order - b.order),
    );
    for (const event of prioritized) {
        const isContext =
            event.phase !== 'tool_call' &&
            event.phase !== 'tool_output' &&
            !lens.anchors.some((anchor) => matchEvidenceEvent(event, anchor));
        const available = isContext ? Math.min(maximum - used, contextRemaining + 200) : maximum - used;
        const snippet = renderSnippet(event, lens, conversation, state, literals, available);
        if (snippet === null) {
            continue;
        }
        used += snippet.text.length;
        if (isContext) {
            contextRemaining = Math.max(0, contextRemaining - snippet.bodyCharacters);
        }
        snippets.push({ event, ...snippet });
    }
    snippets.sort((a, b) => a.event.order - b.event.order);
    const rendered = snippets.map((snippet) => snippet.event);
    const trace = `Event order: ${eventRange(rendered)}\n\n`;
    const calls = rendered.filter((event) => event.phase === 'tool_call');
    const retries = calls.filter(
        (event, i) =>
            i > 0 &&
            calls
                .slice(0, i)
                .some(
                    (previous) => previous.tool?.name === event.tool?.name && eventText(previous) === eventText(event),
                ),
    ).length;
    const retryText = retries ? `Retries: ${retries}\n\n` : '';
    state.stats.renderedEvents = (state.stats.renderedEvents ?? 0) + rendered.length;
    state.stats.renderedMatchedEvents =
        (state.stats.renderedMatchedEvents ?? 0) +
        rendered.filter((event) => lens.anchors.some((anchor) => matchEvidenceEvent(event, anchor))).length;
    return {
        markdown: header + snippets.map((snippet) => snippet.text).join('') + retryText + trace,
        matched: snippets.filter((snippet) => snippet.matched).map((snippet) => snippet.event.messageId),
        rendered,
    };
};

const omissionMarkdown = (state: ReturnType<typeof createEvidenceProjectionState>, retainedRanges: string[]) => {
    const { stats } = state;
    return [
        '## Omitted evidence',
        '',
        `- Input events / characters inspected: ${stats.inputEvents} / ${stats.inputCharacters}`,
        `- Selected / omitted events: ${stats.selectedEvents} / ${stats.omittedEvents}`,
        `- Rendered event bodies: ${stats.renderedEvents ?? 0}`,
        `- Matched / rendered matched events: ${stats.matchedEvents ?? 0} / ${stats.renderedMatchedEvents ?? 0}`,
        `- Candidate limit reached: ${stats.candidateLimitReached ? 'yes' : 'no'}`,
        `- Section budget reached: ${stats.sectionBudgetReached ? 'yes' : 'no'}`,
        `- Truncated fields / arrays: ${stats.truncatedFields} / ${stats.truncatedArrays}`,
        `- Deduplicated diagnostics: ${stats.deduplicatedDiagnostics}`,
        `- Omitted binary or opaque payloads: ${stats.omittedBinaryPayloads}`,
        `- Budget reached: ${stats.budgetReached ? 'yes' : 'no'}`,
        `- Retained source event-order ranges: ${retainedRanges.join(', ') || 'none'}`,
        '',
    ].join('\n');
};

/**
 * Builds lossy focused Markdown plus structured omission metadata from a normalized
 * conversation and a validated lens. Determinism requires the same conversation,
 * lens, renderer version, and generatedAt; omission of generatedAt uses current time.
 * Enforces the total budget including headings and the omission ledger, removing
 * whole sections that do not fit. Throws if even the remaining framing cannot fit.
 * Approximate tokens are ceil(Markdown characters / 4), not tokenizer accounting.
 */
export const buildEvidenceExport = (
    conversation: ConversationDetail,
    lens: EvidenceLens,
    options: BuildEvidenceExportOptions = {},
): ConversationEvidenceExport => {
    const generatedAt = options.generatedAt ?? new Date().toISOString();
    const events = buildEvidenceEvents(conversation);
    const inputCharacters = events.reduce((total, event) => total + inputCharacterCount(event), 0);
    let state = createEvidenceProjectionState(events.length, inputCharacters);
    const episodes = buildEvidenceEpisodes(events, lens, state.stats);
    state.stats.matchedEvents = events.filter((event) =>
        lens.anchors.some((anchor) => matchEvidenceEvent(event, anchor)),
    ).length;
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
        `- Original reference: ${inlineMarkdown(conversation.deepLinks.spiracha, conversation)}`,
        `- Retrieve: \`spiracha retrieve "<original-reference>" --request request.json\`; JSON: \`{"revision":"${evidenceRevision(conversation)}","startOrder":0,"endOrder":${events.reduce((max, event) => Math.max(max, event.order), 0)}}\``,
        ...(!events.some((event) => event.tool)
            ? ['- Tool evidence: not exposed by this conversation. Use text anchors.']
            : []),
        ...(events.some((event) => event.tool?.shellCommands?.length === 0)
            ? ['- Shell extraction: some executor calls have no supported literal shell arguments.']
            : []),
        '',
    ].join('\n');
    const sections: Array<{
        index: number;
        markdown: string;
        range: string;
        rendered: ConversationEvidenceEvent[];
        matched: string[];
    }> = [];
    let used = header.length;
    const emitted = new Set<string>();
    const ranked = episodes
        .map((episode, index) => ({ episode, index }))
        .sort(
            (a, b) =>
                Math.max(...b.episode.events.map((event) => eventPriority(event, lens))) -
                    Math.max(...a.episode.events.map((event) => eventPriority(event, lens))) || b.index - a.index,
        );
    for (const { episode, index } of ranked) {
        const candidate = { diagnostics: new Set(state.diagnostics), stats: { ...state.stats } };
        const section = episodeMarkdown(
            { ...episode, events: episode.events.filter((event) => !emitted.has(event.messageId)) },
            index,
            lens,
            conversation,
            candidate,
        );
        const range = eventRange(section.rendered);
        if (!section.rendered.length) {
            continue;
        }
        if (
            used +
                section.markdown.length +
                omissionMarkdown(candidate, [...sections.map((item) => item.range), range]).length +
                100 >
            lens.budget.totalCharacters
        ) {
            state.stats.budgetReached = true;
            continue;
        }
        state = candidate;
        for (const event of section.rendered) {
            emitted.add(event.messageId);
        }
        state.stats.selectedEvents += episode.events.length;
        sections.push({
            index,
            markdown: section.markdown,
            matched: section.matched,
            range,
            rendered: section.rendered,
        });
        used += section.markdown.length;
    }
    sections.sort((a, b) => a.index - b.index);
    // Context can occur in separate episodes; counts describe unique source events.
    const selected = new Set(
        sections.flatMap((section) => episodes[section.index]!.events.map((event) => event.messageId)),
    );
    const rendered = new Map(
        sections.flatMap((section) => section.rendered.map((event) => [event.messageId, event] as const)),
    );
    state.stats.selectedEvents = selected.size;
    state.stats.renderedEvents = rendered.size;
    state.stats.renderedMatchedEvents = new Set(sections.flatMap((section) => section.matched)).size;
    state.stats.omittedEvents = Math.max(0, events.length - selected.size);
    const markdown =
        header +
        sections
            .map((section, index) => section.markdown.replace(/^## Episode \d+:/u, `## Episode ${index + 1}:`))
            .join('') +
        omissionMarkdown(
            state,
            sections.map((section) => section.range),
        );
    if (markdown.length > lens.budget.totalCharacters) {
        throw new Error('Focused evidence export cannot fit within the configured character budget.');
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
