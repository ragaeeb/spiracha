import os from 'node:os';
import path from 'node:path';
import type { ExportFormat, JsonValue } from './shared';

export const getDefaultOpenCodeDataDir = (env: NodeJS.ProcessEnv = process.env, homeDir = os.homedir()): string => {
    return path.join(env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share'), 'opencode');
};

export const DEFAULT_OPENCODE_DATA_DIR = getDefaultOpenCodeDataDir();

export const resolveOpenCodeDataDir = (): string => {
    const configured = process.env.SPIRACHA_OPENCODE_DATA_DIR?.trim() || process.env.SPIRACHA_OPENCODE_DIR?.trim();
    return configured ? configured : DEFAULT_OPENCODE_DATA_DIR;
};

export const resolveOpenCodeDbPath = (): string => {
    const configured = process.env.SPIRACHA_OPENCODE_DB?.trim();
    return configured ? configured : path.join(resolveOpenCodeDataDir(), 'opencode.db');
};

export type OpenCodeWorkspaceGroup = {
    archivedSessionCount: number;
    key: string;
    label: string;
    lastActiveMs: number;
    messageCount: number;
    partCount: number;
    projectId: string;
    sessionCount: number;
    uri: string;
    worktree: string;
};

export type OpenCodeModelInfo = {
    id: string | null;
    providerID: string | null;
    raw: JsonValue | string | null;
    variant: string | null;
};

export type OpenCodeSessionSummary = {
    agent: string | null;
    archivedAtMs: number | null;
    cost: number;
    createdAtMs: number;
    directory: string;
    lastUpdatedAtMs: number;
    messageCount: number;
    model: OpenCodeModelInfo;
    modelLabel: string | null;
    partCount: number;
    path: string | null;
    permission: string | null;
    projectId: string;
    renderablePartCount: number;
    sessionId: string;
    slug: string;
    summaryAdditions: number | null;
    summaryDeletions: number | null;
    summaryFiles: number | null;
    textPartCount: number;
    title: string;
    tokensCacheRead: number;
    tokensCacheWrite: number;
    tokensInput: number;
    tokensOutput: number;
    tokensReasoning: number;
    toolPartCount: number;
    totalTokens: number;
    worktree: string;
    workspaceKey: string;
    workspaceLabel: string;
};

export type OpenCodePartType = 'reasoning' | 'step-finish' | 'step-start' | 'text' | 'tool' | 'unknown';

export type OpenCodeStepTokens = {
    cacheRead: number;
    cacheWrite: number;
    input: number;
    output: number;
    reasoning: number;
    total: number;
};

export type OpenCodeTranscriptPart = {
    argumentsText?: string | null;
    callId?: string | null;
    createdAtMs: number;
    endTimeMs?: number | null;
    messageId: string;
    outputText?: string | null;
    partId: string;
    raw: Record<string, JsonValue>;
    reason?: string | null;
    role: string;
    snapshot?: string | null;
    startTimeMs?: number | null;
    status?: string | null;
    text?: string;
    title?: string | null;
    tokens?: OpenCodeStepTokens | null;
    toolName?: string | null;
    type: OpenCodePartType;
    updatedAtMs: number;
};

export type OpenCodeTranscriptMessage = {
    createdAtMs: number;
    messageId: string;
    parts: OpenCodeTranscriptPart[];
    raw: Record<string, JsonValue>;
    role: string;
    updatedAtMs: number;
};

export type OpenCodeSessionTranscript = {
    messages: OpenCodeTranscriptMessage[];
    partCount: number;
    renderablePartCount: number;
    session: OpenCodeSessionSummary;
};

export type OpenCodeExportOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: ExportFormat;
};
