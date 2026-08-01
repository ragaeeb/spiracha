export const ANTIGRAVITY_TRANSCRIPT_MARKDOWN_VERSION = 'antigravity-transcript/v2';
export const ANTIGRAVITY_TRANSCRIPT_VERSION_METADATA_KEY = 'transcript_schema';
export const ANTIGRAVITY_TOOL_OUTPUT_PREVIEW_MAX_CHARACTERS = 20_000;

export const ANTIGRAVITY_TRANSCRIPT_HEADINGS = {
    assistant: 'Assistant',
    event: 'Event',
    system: 'System',
    thinking: 'Thinking',
    toolCalls: 'Tool Calls',
    toolPrefix: 'Tool: ',
    user: 'User',
} as const;

const SECTION_HEADING_PATTERN = /^##\s+((?:User|Assistant|System|Event)|Tool:\s*.+)$/iu;
const CONTROL_SUBHEADING_PATTERN = /^###\s+(Thinking|Tool Calls)\s*$/iu;

export const matchAntigravityTranscriptSectionHeading = (line: string): string | null =>
    SECTION_HEADING_PATTERN.exec(line)?.[1]?.trim() ?? null;

export const isAntigravityTranscriptControlSubheading = (line: string): boolean =>
    CONTROL_SUBHEADING_PATTERN.test(line.trim());
