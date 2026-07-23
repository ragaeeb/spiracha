import os from 'node:os';
import path from 'node:path';
import type { ExportFormat, JsonValue } from './shared';

export const getDefaultMiniMaxCodeDataDir = (_env: NodeJS.ProcessEnv = process.env, homeDir = os.homedir()): string => {
    return path.join(homeDir, '.minimax');
};

export const DEFAULT_MINIMAX_CODE_DATA_DIR = getDefaultMiniMaxCodeDataDir();

export const resolveMiniMaxCodeDataDir = (): string => {
    const configured =
        process.env.SPIRACHA_MINIMAX_CODE_DATA_DIR?.trim() ||
        process.env.SPIRACHA_MINIMAX_DATA_DIR?.trim() ||
        process.env.MINIMAX_DATA_DIR?.trim();
    return configured ? configured : DEFAULT_MINIMAX_CODE_DATA_DIR;
};

export const resolveMiniMaxCodeSessionsDir = (): string => {
    const configured = process.env.SPIRACHA_MINIMAX_CODE_SESSIONS_DIR?.trim();
    return configured ? configured : path.join(resolveMiniMaxCodeDataDir(), 'v2', 'sessions');
};

export const resolveMiniMaxCodeRuntimeDbPath = (sessionsDir = resolveMiniMaxCodeSessionsDir()): string => {
    const configured = process.env.SPIRACHA_MINIMAX_CODE_RUNTIME_DB_PATH?.trim();
    return configured ? configured : path.join(path.dirname(sessionsDir), 'sqlite', 'runtime-state.sqlite');
};

export type DeleteMiniMaxCodeSessionResult = {
    deletedFiles: string[];
    deletedSessionIds: string[];
};

export type MiniMaxCodeWorkspaceGroup = {
    assistantMessageCount: number;
    key: string;
    label: string;
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

export type MiniMaxCodeToolStatus = 'failed' | 'succeeded' | 'unknown';

export type MiniMaxCodeToolCall = {
    argumentsText: string | null;
    callId: string | null;
    command: string | null;
    outputText: string | null;
    raw: Record<string, JsonValue>;
    status: MiniMaxCodeToolStatus;
    toolName: string;
};

export type MiniMaxCodeTranscriptMessage = {
    content: string | null;
    createdAtMs: number | null;
    finishReason: string | null;
    messageId: string;
    messageType: number;
    raw: Record<string, JsonValue>;
    reasoning: string | null;
    role: string;
    thinkingDurationMs: number | null;
    toolCalls: MiniMaxCodeToolCall[];
};

export type MiniMaxCodeSessionSummary = {
    agentName: string | null;
    appMode: string | null;
    archived: boolean;
    assistantMessageCount: number;
    createdAtMs: number | null;
    currentModelId: string | null;
    currentModelVariant: string | null;
    lastActiveAtMs: number | null;
    messageCount: number;
    reasoningCount: number;
    renderablePartCount: number;
    runtime: string | null;
    sessionDir: string;
    sessionId: string;
    sessionType: string | null;
    snapshotPath: string;
    status: string | null;
    title: string;
    toolCallCount: number;
    toolResultCount: number;
    userMessageCount: number;
    workspaceKey: string;
    workspaceLabel: string;
    worktree: string;
};

export type MiniMaxCodeSessionTranscript = {
    messages: MiniMaxCodeTranscriptMessage[];
    rawPayloadsOmitted?: boolean;
    renderablePartCount: number;
    session: MiniMaxCodeSessionSummary;
};

export type MiniMaxCodeExportOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: ExportFormat;
};
