import os from 'node:os';
import path from 'node:path';
import type { ExportFormat, JsonValue } from './shared';

export type { ClaudeCodeAssistantMessagePhase } from './claude-code-transcript-phase';
export { getClaudeCodeAssistantMessagePhase } from './claude-code-transcript-phase';

export const getDefaultClaudeCodeDataDir = (_env: NodeJS.ProcessEnv = process.env, homeDir = os.homedir()): string => {
    return path.join(homeDir, '.claude');
};

export const DEFAULT_CLAUDE_CODE_DATA_DIR = getDefaultClaudeCodeDataDir();

export const resolveClaudeCodeDataDir = (): string => {
    const configured =
        process.env.SPIRACHA_CLAUDE_CODE_DATA_DIR?.trim() ||
        process.env.SPIRACHA_CLAUDE_CODE_DIR?.trim() ||
        process.env.SPIRACHA_CLAUDE_HOME?.trim();
    return configured ? configured : DEFAULT_CLAUDE_CODE_DATA_DIR;
};

export const resolveClaudeCodeProjectsDir = (): string => {
    const configured = process.env.SPIRACHA_CLAUDE_CODE_PROJECTS_DIR?.trim();
    return configured ? configured : path.join(resolveClaudeCodeDataDir(), 'projects');
};

export type ClaudeCodeWorkspaceGroup = {
    assistantMessageCount: number;
    directoryName: string;
    key: string;
    label: string;
    lastActiveAtIso: string | null;
    lastActiveAtMs: number | null;
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
    toolResultCount: number;
    uri: string;
    userMessageCount: number;
    worktree: string;
};

export type ClaudeCodeSessionSummary = {
    assistantMessageCount: number;
    attachmentCount: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    createdAtIso: string | null;
    createdAtMs: number | null;
    cwd: string | null;
    filePath: string;
    gitBranch: string | null;
    inputTokens: number;
    lastActiveAtIso: string | null;
    lastActiveAtMs: number | null;
    messageCount: number;
    model: string | null;
    outputTokens: number;
    renderablePartCount: number;
    sessionId: string;
    title: string;
    toolCallCount: number;
    toolResultCount: number;
    totalTokens: number;
    userMessageCount: number;
    version: string | null;
    workspaceKey: string;
    workspaceLabel: string;
    worktree: string;
};

export type ClaudeCodePartType = 'attachment' | 'text' | 'thinking' | 'tool_result' | 'tool_use' | 'unknown';

export type ClaudeCodeTranscriptPart = {
    argumentsText?: string | null;
    attachmentType?: string | null;
    isError?: boolean | null;
    outputText?: string | null;
    raw: Record<string, JsonValue>;
    text?: string;
    toolName?: string | null;
    toolUseId?: string | null;
    type: ClaudeCodePartType;
};

export type ClaudeCodeTranscriptEntry = {
    cwd: string | null;
    entryId: string;
    model?: string | null;
    parentEntryId?: string | null;
    parts: ClaudeCodeTranscriptPart[];
    raw: Record<string, JsonValue>;
    role: string;
    timestamp: string | null;
    type: string;
};

export type ClaudeCodeSessionTranscript = {
    entries: ClaudeCodeTranscriptEntry[];
    rawPayloadsOmitted?: boolean;
    rawEvents: Record<string, JsonValue>[];
    renderablePartCount: number;
    session: ClaudeCodeSessionSummary;
};

export type ClaudeCodeExportOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: ExportFormat;
};
