import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import type { JsonValue } from '@spiracha/lib/shared';

type MarkdownSection = {
    body: string;
    heading: string;
    sequence: number;
};

type ParsedAssistantSection = {
    content: string;
    thinking: string;
    toolCalls: ParsedToolCall[];
};

type ParsedToolCall = {
    argumentsText: string | null;
    name: string;
};

const HEADING_PATTERN = /^##\s+(.+)$/u;
const TIMESTAMP_PATTERN = /^_Timestamp:\s*(.+?)_$/u;
const TOOL_HEADING_PATTERN = /^tool:\s*(.+)$/iu;

const splitMarkdownSections = (markdown: string | null): MarkdownSection[] => {
    if (!markdown?.trim()) {
        return [];
    }

    const sections: MarkdownSection[] = [];
    const lines = markdown.split(/\r?\n/u);
    let currentHeading: string | null = null;
    let currentLines: string[] = [];

    const flush = () => {
        if (!currentHeading) {
            return;
        }

        sections.push({
            body: currentLines.join('\n').trim(),
            heading: currentHeading,
            sequence: sections.length * 10,
        });
    };

    for (const line of lines) {
        const heading = HEADING_PATTERN.exec(line);
        if (heading) {
            flush();
            currentHeading = heading[1]!.trim();
            currentLines = [];
            continue;
        }

        if (currentHeading) {
            currentLines.push(line);
        }
    }

    flush();
    return sections;
};

const extractTimestamp = (body: string): { body: string; timestamp: string | null } => {
    const lines = body.split(/\r?\n/u);
    const timestamp = TIMESTAMP_PATTERN.exec(lines[0]?.trim() ?? '')?.[1]?.trim() ?? null;
    return {
        body: timestamp ? lines.slice(1).join('\n').trim() : body.trim(),
        timestamp,
    };
};

const sectionBodyBeforeSubheading = (body: string): string => {
    return body.split(/^###\s+/mu)[0]?.trim() ?? '';
};

const extractSubheadingBlock = (body: string, title: string): string => {
    const lines = body.split(/\r?\n/u);
    const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === `### ${title.toLowerCase()}`);
    if (startIndex === -1) {
        return '';
    }

    const nextSubheadingIndex = lines.findIndex((line, index) => index > startIndex && line.startsWith('### '));
    return lines
        .slice(startIndex + 1, nextSubheadingIndex === -1 ? undefined : nextSubheadingIndex)
        .join('\n')
        .trim();
};

const parseToolCalls = (body: string): ParsedToolCall[] => {
    const toolCallsBlock = extractSubheadingBlock(body, 'Tool Calls');
    if (!toolCallsBlock) {
        return [];
    }

    const calls: ParsedToolCall[] = [];
    const callPattern = /-\s+`([^`]+)`(?:\s*\n+```json\s*\n([\s\S]*?)\n```)?/gu;
    for (const match of toolCallsBlock.matchAll(callPattern)) {
        calls.push({
            argumentsText: match[2]?.trim() ?? null,
            name: match[1]?.trim() || 'unknown',
        });
    }

    return calls;
};

const parseAssistantSection = (body: string): ParsedAssistantSection => {
    const content = sectionBodyBeforeSubheading(body);
    const thinkingBlock = extractSubheadingBlock(body, 'Thinking');
    const [thinking, ...remainingThinkingBlock] = thinkingBlock.split(/\n{2,}/u).map((entry) => entry.trim());

    return {
        content: content || remainingThinkingBlock.join('\n\n').trim(),
        thinking: thinking ?? '',
        toolCalls: parseToolCalls(body),
    };
};

const buildRaw = (section: MarkdownSection, extra: Record<string, JsonValue> = {}): Record<string, JsonValue> => ({
    heading: section.heading,
    source: 'antigravity_markdown',
    ...extra,
});

const buildMessageEvent = (
    section: MarkdownSection,
    role: string,
    text: string,
    timestamp: string | null,
    phase: string | null,
    sequenceOffset = 0,
): ThreadEvent => ({
    isHiddenByDefault: role !== 'assistant' && role !== 'user',
    kind: 'message',
    memoryCitation: null,
    model: null,
    phase,
    raw: buildRaw(section, { role }),
    role,
    sequence: section.sequence + sequenceOffset,
    text,
    timestamp,
    variant: role === 'user' ? 'user_message' : role === 'assistant' ? 'agent_message' : 'message',
});

const buildToolCallEvent = (
    section: MarkdownSection,
    toolCall: ParsedToolCall,
    timestamp: string | null,
    sequenceOffset: number,
): ThreadEvent => ({
    argumentsParseFailed: false,
    argumentsText: toolCall.argumentsText,
    callId: null,
    command: [toolCall.name, toolCall.argumentsText].filter(Boolean).join('\n'),
    kind: 'tool_call',
    name: toolCall.name,
    raw: buildRaw(section, {
        argumentsText: toolCall.argumentsText,
        name: toolCall.name,
    }),
    sequence: section.sequence + sequenceOffset,
    timestamp,
    workdir: null,
});

const buildToolOutputEvent = (
    section: MarkdownSection,
    toolName: string,
    outputText: string,
    timestamp: string | null,
): ThreadEvent => ({
    callId: null,
    exitCode: null,
    kind: 'tool_output',
    outputText,
    raw: buildRaw(section, {
        name: toolName,
    }),
    sequence: section.sequence,
    summary: outputText,
    timestamp,
    wallTime: null,
});

const getFinalAssistantSectionSequences = (sections: MarkdownSection[]): Set<number> => {
    const finalAssistantSectionSequences = new Set<number>();
    let currentAssistantContentSequence: number | null = null;
    let currentAssistantFallbackSequence: number | null = null;

    const flushAssistantRun = () => {
        if (currentAssistantContentSequence !== null) {
            finalAssistantSectionSequences.add(currentAssistantContentSequence);
        } else if (currentAssistantFallbackSequence !== null) {
            finalAssistantSectionSequences.add(currentAssistantFallbackSequence);
        }
        currentAssistantContentSequence = null;
        currentAssistantFallbackSequence = null;
    };

    for (const section of sections) {
        const heading = section.heading.toLowerCase();
        if (heading === 'user') {
            flushAssistantRun();
            continue;
        }

        if (heading !== 'assistant') {
            continue;
        }

        const { body } = extractTimestamp(section.body);
        const parsed = parseAssistantSection(body);
        if (parsed.content && parsed.toolCalls.length === 0) {
            currentAssistantContentSequence = section.sequence;
            continue;
        }

        if (parsed.content) {
            currentAssistantFallbackSequence = section.sequence;
        }
    }

    flushAssistantRun();
    return finalAssistantSectionSequences;
};

const textSectionToEvents = (
    section: MarkdownSection,
    role: string,
    body: string,
    timestamp: string | null,
): ThreadEvent[] => {
    return body ? [buildMessageEvent(section, role, body, timestamp, null)] : [];
};

const toolOutputSectionToEvents = (
    section: MarkdownSection,
    toolName: string,
    body: string,
    timestamp: string | null,
): ThreadEvent[] => {
    return body ? [buildToolOutputEvent(section, toolName, body, timestamp)] : [];
};

const assistantSectionToEvents = (
    section: MarkdownSection,
    body: string,
    timestamp: string | null,
    finalAssistantSectionSequences: Set<number>,
): ThreadEvent[] => {
    const parsed = parseAssistantSection(body);
    const events: ThreadEvent[] = [];
    if (parsed.thinking) {
        events.push(buildMessageEvent(section, 'assistant', parsed.thinking, timestamp, 'commentary'));
    }
    if (parsed.content) {
        const phase = finalAssistantSectionSequences.has(section.sequence) ? 'final_answer' : 'commentary';
        events.push(buildMessageEvent(section, 'assistant', parsed.content, timestamp, phase, 1));
    }
    parsed.toolCalls.forEach((toolCall, index) => {
        events.push(buildToolCallEvent(section, toolCall, timestamp, 2 + index));
    });
    return events;
};

const sectionToEvents = (section: MarkdownSection, finalAssistantSectionSequences: Set<number>): ThreadEvent[] => {
    const { body, timestamp } = extractTimestamp(section.body);
    const heading = section.heading.toLowerCase();
    const toolHeading = TOOL_HEADING_PATTERN.exec(section.heading);

    if (heading === 'user') {
        return textSectionToEvents(section, 'user', body, timestamp);
    }

    if (toolHeading) {
        return toolOutputSectionToEvents(section, toolHeading[1]?.trim() || 'unknown', body, timestamp);
    }

    if (heading === 'assistant') {
        return assistantSectionToEvents(section, body, timestamp, finalAssistantSectionSequences);
    }

    if (heading === 'system') {
        return textSectionToEvents(section, 'system', body, timestamp);
    }

    return textSectionToEvents(section, 'event', body, timestamp);
};

export const antigravityMarkdownToThreadEvents = (markdown: string | null): ThreadEvent[] => {
    const sections = splitMarkdownSections(markdown);
    const finalAssistantSectionSequences = getFinalAssistantSectionSequences(sections);
    return sections.flatMap((section) => sectionToEvents(section, finalAssistantSectionSequences));
};

const updateMessageStats = (stats: ThreadTranscriptStats, event: Extract<ThreadEvent, { kind: 'message' }>) => {
    stats.messageCount += 1;
    if (event.role === 'assistant') {
        stats.assistantMessageCount += 1;
    }
    if (event.role === 'user') {
        stats.userMessageCount += 1;
    }
    if (event.phase === 'commentary') {
        stats.commentaryCount += 1;
    }
    if (event.phase === 'final_answer') {
        stats.finalAnswerCount += 1;
    }
};

export const getAntigravityThreadTranscriptStats = (events: ThreadEvent[]): ThreadTranscriptStats => {
    const stats: ThreadTranscriptStats = {
        assistantMessageCount: 0,
        commentaryCount: 0,
        execCommandCount: 0,
        finalAnswerCount: 0,
        messageCount: 0,
        toolCallCount: 0,
        toolOutputCount: 0,
        userMessageCount: 0,
        webSearchEventCount: 0,
    };

    for (const event of events) {
        if (event.kind === 'message') {
            updateMessageStats(stats, event);
        }
        if (event.kind === 'tool_call') {
            stats.toolCallCount += 1;
        }
        if (event.kind === 'tool_output') {
            stats.toolOutputCount += 1;
        }
    }

    return stats;
};
