import os from 'node:os';
import path from 'node:path';
import type { ExportFormat, JsonValue } from './shared';

export const getDefaultFxDataDir = (_env: NodeJS.ProcessEnv = process.env, homeDir = os.homedir()): string => {
    return path.join(homeDir, '.fx');
};

export const DEFAULT_FX_DATA_DIR = getDefaultFxDataDir();

export const resolveFxDataDir = (): string => {
    const configured = process.env.SPIRACHA_FX_DATA_DIR?.trim() || process.env.FX_DATA_DIR?.trim();
    return configured ? configured : DEFAULT_FX_DATA_DIR;
};

export type DeleteFxSessionResult = {
    deletedFiles: string[];
    deletedSessionIds: string[];
};

export type FxWorkspaceGroup = {
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

export type FxToolStatus = 'failed' | 'succeeded' | 'unknown';

export type FxToolCall = {
    argumentsText: string | null;
    callId: string | null;
    command: string | null;
    outputText: string | null;
    raw: Record<string, JsonValue>;
    status: FxToolStatus;
    toolName: string;
};

export type FxTranscriptMessage = {
    content: string | null;
    createdAtMs: number | null;
    finishReason: string | null;
    messageId: string;
    messageType: number;
    raw: Record<string, JsonValue>;
    reasoning: string | null;
    role: string;
    thinkingDurationMs: number | null;
    toolCalls: FxToolCall[];
};

export type FxSessionSummary = {
    conversationLanguage: string | null;
    createdAtMs: number | null;
    currentModelId: string | null;
    currentModelVariant: string | null;
    lastActiveAtMs: number | null;
    messageCount: number;
    reasoningCount: number;
    renderablePartCount: number;
    sessionDir: string;
    sessionId: string;
    status: string | null;
    title: string;
    toolCallCount: number;
    toolResultCount: number;
    totalInputTokens: number | null;
    totalOutputTokens: number | null;
    userMessageCount: number;
    assistantMessageCount: number;
    workspaceKey: string;
    workspaceLabel: string;
    worktree: string;
};

export type FxSessionTranscript = {
    messages: FxTranscriptMessage[];
    rawPayloadsOmitted?: boolean;
    renderablePartCount: number;
    session: FxSessionSummary;
};

export type FxExportOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: ExportFormat;
};
