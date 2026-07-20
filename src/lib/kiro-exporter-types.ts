import os from 'node:os';
import path from 'node:path';
import type { ExportFormat, JsonValue } from './shared';

export const getDefaultKiroDataDir = (_env: NodeJS.ProcessEnv = process.env, homeDir = os.homedir()): string => {
    return path.join(homeDir, 'Library', 'Application Support', 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent');
};

export const DEFAULT_KIRO_DATA_DIR = getDefaultKiroDataDir();

export const resolveKiroDataDir = (): string => {
    const configured =
        process.env.SPIRACHA_KIRO_DATA_DIR?.trim() ||
        process.env.SPIRACHA_KIRO_AGENT_DIR?.trim() ||
        process.env.SPIRACHA_KIRO_DIR?.trim();
    return configured ? configured : DEFAULT_KIRO_DATA_DIR;
};

export const resolveKiroWorkspaceSessionsDir = (): string => {
    const configured = process.env.SPIRACHA_KIRO_WORKSPACE_SESSIONS_DIR?.trim();
    return configured ? configured : path.join(resolveKiroDataDir(), 'workspace-sessions');
};

export type KiroWorkspaceGroup = {
    assistantMessageCount: number;
    directoryName: string;
    imageCount: number;
    key: string;
    label: string;
    lastActiveAtIso: string | null;
    lastActiveAtMs: number | null;
    messageCount: number;
    promptLogCount: number;
    sessionCount: number;
    uri: string;
    userMessageCount: number;
    worktree: string;
};

export type KiroSessionSummary = {
    assistantMessageCount: number;
    autonomyMode: string | null;
    createdAtIso: string | null;
    createdAtMs: number | null;
    defaultModelTitle: string | null;
    filePath: string;
    imageCount: number;
    lastActiveAtIso: string | null;
    lastActiveAtMs: number | null;
    messageCount: number;
    promptLogCount: number;
    renderablePartCount: number;
    selectedModel: string | null;
    selectedProfileId: string | null;
    sessionId: string;
    sessionType: string | null;
    title: string;
    userMessageCount: number;
    workspaceDirectory: string | null;
    workspaceKey: string;
    workspaceLabel: string;
    workspacePath: string | null;
    worktree: string;
};

export type KiroPartType = 'image' | 'text' | 'unknown';

export type KiroTranscriptPart = {
    imageUrl?: string | null;
    raw: Record<string, JsonValue>;
    text?: string;
    type: KiroPartType;
};

export type KiroTranscriptEntryType = 'message' | 'tool_call';

export type KiroTranscriptEntry = {
    entryType: KiroTranscriptEntryType;
    entryId: string;
    executionId: string | null;
    parts: KiroTranscriptPart[];
    promptLogCount: number;
    raw: Record<string, JsonValue>;
    role: string;
    timestamp: string | null;
};

export type KiroRawExecution = {
    filePath: string;
    raw: Record<string, JsonValue>;
};

export type KiroSessionTranscript = {
    entries: KiroTranscriptEntry[];
    executionEntries: KiroTranscriptEntry[];
    historyEntries: KiroTranscriptEntry[];
    rawExecutions: KiroRawExecution[];
    rawHistory: JsonValue[];
    rawSession: Record<string, JsonValue>;
    renderablePartCount: number;
    session: KiroSessionSummary;
};

export type KiroExportOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: ExportFormat;
};
