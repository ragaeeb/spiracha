import os from 'node:os';
import path from 'node:path';
import type { ExportFormat, JsonValue } from './shared';

export const getDefaultGrokHome = (_env: NodeJS.ProcessEnv = process.env, homeDir = os.homedir()): string => {
    return path.join(homeDir, '.grok');
};

export const DEFAULT_GROK_HOME = getDefaultGrokHome();

export const resolveGrokHome = (): string => {
    const configured = process.env.SPIRACHA_GROK_HOME?.trim() || process.env.SPIRACHA_GROK_DIR?.trim();
    return configured ? configured : DEFAULT_GROK_HOME;
};

export const resolveGrokSessionsDir = (): string => {
    const configured = process.env.SPIRACHA_GROK_SESSIONS_DIR?.trim();
    return configured ? configured : path.join(resolveGrokHome(), 'sessions');
};

export type GrokWorkspaceGroup = {
    assistantMessageCount: number;
    chatMessageCount: number;
    directoryName: string;
    key: string;
    label: string;
    lastActiveAtIso: string | null;
    lastActiveAtMs: number | null;
    messageCount: number;
    reasoningCount: number;
    sessionCount: number;
    toolCallCount: number;
    toolResultCount: number;
    uri: string;
    userMessageCount: number;
    worktree: string;
};

export type GrokSessionSummary = {
    agentName: string | null;
    assistantMessageCount: number;
    chatHistoryPath: string;
    chatMessageCount: number;
    createdAtIso: string | null;
    createdAtMs: number | null;
    currentModelId: string | null;
    cwd: string | null;
    gitBranch: string | null;
    gitRemotes: string[];
    gitRootDir: string | null;
    headCommit: string | null;
    lastActiveAtIso: string | null;
    lastActiveAtMs: number | null;
    messageCount: number;
    modelLabel: string | null;
    reasoningCount: number;
    renderablePartCount: number;
    sandboxProfile: string | null;
    sessionDir: string;
    sessionId: string;
    summaryPath: string;
    title: string;
    toolCallCount: number;
    toolResultCount: number;
    updatesPath: string | null;
    userMessageCount: number;
    workspaceKey: string;
    workspaceLabel: string;
    worktree: string;
};

export type GrokPartType = 'reasoning' | 'text' | 'tool_call' | 'tool_result' | 'unknown';

export type GrokTranscriptPart = {
    argumentsText?: string | null;
    outputText?: string | null;
    partId: string;
    raw: Record<string, JsonValue>;
    text?: string;
    toolCallId?: string | null;
    toolName?: string | null;
    type: GrokPartType;
};

export type GrokTranscriptEntry = {
    createdAtMs: number | null;
    entryId: string;
    modelFingerprint?: string | null;
    modelId?: string | null;
    parts: GrokTranscriptPart[];
    raw: Record<string, JsonValue>;
    role: string;
    timestamp: string | null;
    type: string;
};

export type GrokSessionTranscript = {
    entries: GrokTranscriptEntry[];
    rawEvents: Record<string, JsonValue>[];
    renderablePartCount: number;
    session: GrokSessionSummary;
};

export type GrokExportOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: ExportFormat;
};
