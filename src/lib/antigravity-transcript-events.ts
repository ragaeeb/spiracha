import {
    ANTIGRAVITY_TOOL_OUTPUT_PREVIEW_MAX_CHARACTERS,
    isAntigravityTranscriptControlSubheading,
    matchAntigravityTranscriptSectionHeading,
} from './antigravity-transcript-contract';
import { getFinalAntigravityAssistantSequences } from './antigravity-transcript-phase';
import type { ThreadEvent } from './codex-browser-types';
import type { JsonValue } from './shared';

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

const TIMESTAMP_PATTERN = /^_Timestamp:\s*(.+?)_$/u;
const TOOL_HEADING_PATTERN = /^tool:\s*(.+)$/iu;

type MarkdownFence = { character: string; length: number };

const updateMarkdownFence = (fence: MarkdownFence | null, token: string | null): MarkdownFence | null => {
    if (!token) {
        return fence;
    }
    if (!fence) {
        return { character: token[0]!, length: token.length };
    }
    return token[0] === fence.character && token.length >= fence.length ? null : fence;
};

const splitMarkdownSections = (markdown: string | null): MarkdownSection[] => {
    if (!markdown?.trim()) {
        return [];
    }

    const sections: MarkdownSection[] = [];
    const lines = markdown.split(/\r?\n/u);
    let currentHeading: string | null = null;
    let currentLines: string[] = [];
    let fence: MarkdownFence | null = null;

    const flush = () => {
        if (!currentHeading) {
            return;
        }

        sections.push({
            body: currentLines.join('\n').trim(),
            heading: currentHeading,
            sequence: sections.length * 1000,
        });
    };

    for (const line of lines) {
        const fenceToken = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1] ?? null;
        const heading = fence === null && fenceToken === null ? matchAntigravityTranscriptSectionHeading(line) : null;
        if (heading) {
            flush();
            currentHeading = heading;
            currentLines = [];
            continue;
        }

        if (currentHeading) {
            currentLines.push(line);
        }

        fence = updateMarkdownFence(fence, fenceToken);
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
    const lines = body.split(/\r?\n/u);
    const controlIndex = lines.findIndex((line) => isAntigravityTranscriptControlSubheading(line));
    return lines
        .slice(0, controlIndex === -1 ? undefined : controlIndex)
        .join('\n')
        .trim();
};

const extractSubheadingBlock = (body: string, title: string): string => {
    const lines = body.split(/\r?\n/u);
    const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === `### ${title.toLowerCase()}`);
    if (startIndex === -1) {
        return '';
    }

    const nextSubheadingIndex = lines.findIndex(
        (line, index) => index > startIndex && isAntigravityTranscriptControlSubheading(line),
    );
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
    const callPattern = /-\s+`([^`]+)`([\s\S]*?)(?=\n-\s+`|$)/gu;
    for (const match of toolCallsBlock.matchAll(callPattern)) {
        const argumentsText = /(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\1/u.exec(match[2] ?? '')?.[2]?.trim() ?? null;
        calls.push({
            argumentsText,
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
): ThreadEvent => {
    const truncated = outputText.length > ANTIGRAVITY_TOOL_OUTPUT_PREVIEW_MAX_CHARACTERS;
    const truncationNotice = `\n\n[Preview truncated. The full ${outputText.length}-character output remains in the transcript export.]`;
    const previewLength = Math.max(0, ANTIGRAVITY_TOOL_OUTPUT_PREVIEW_MAX_CHARACTERS - truncationNotice.length);
    const summary = truncated ? `${outputText.slice(0, previewLength)}${truncationNotice}` : outputText;
    return {
        callId: null,
        exitCode: null,
        kind: 'tool_output',
        outputText,
        raw: buildRaw(section, {
            name: toolName,
            outputCharacterCount: outputText.length,
            outputPreviewTruncated: truncated,
        }),
        sequence: section.sequence,
        summary,
        timestamp,
        wallTime: null,
    };
};

const getFinalAssistantSectionSequences = (sections: MarkdownSection[]): Set<number> => {
    const items = sections.map((section) => {
        const heading = section.heading.toLowerCase();
        if (heading === 'user') {
            return {
                hasContent: Boolean(section.body),
                hasToolCalls: false,
                role: 'user' as const,
                sequence: section.sequence,
            };
        }

        if (heading === 'assistant') {
            const { body } = extractTimestamp(section.body);
            const parsed = parseAssistantSection(body);
            return {
                hasContent: Boolean(parsed.content),
                hasToolCalls: parsed.toolCalls.length > 0,
                role: 'assistant' as const,
                sequence: section.sequence,
            };
        }

        return {
            hasContent: Boolean(section.body),
            hasToolCalls: false,
            role: 'other' as const,
            sequence: section.sequence,
        };
    });

    return getFinalAntigravityAssistantSequences(items);
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
