import os from 'node:os';
import path from 'node:path';
import type { ExportFormat, JsonValue } from './shared';

export const getDefaultClineDataDir = (homeDir = os.homedir()): string => path.join(homeDir, '.cline', 'data');

export const DEFAULT_CLINE_DATA_DIR = getDefaultClineDataDir();

export const resolveClineDataDir = (env: NodeJS.ProcessEnv = process.env, homeDir = os.homedir()): string => {
    return env.SPIRACHA_CLINE_DATA_DIR?.trim() || getDefaultClineDataDir(homeDir);
};

export type DeleteClineTaskResult = {
    deletedFiles: string[];
    deletedTaskIds: string[];
};

export type ClineWorkspaceGroup = {
    assistantMessageCount: number;
    key: string;
    label: string;
    lastActiveAtMs: number | null;
    messageCount: number;
    reasoningCount: number;
    taskCount: number;
    toolCallCount: number;
    toolResultCount: number;
    uri: string;
    userMessageCount: number;
    worktree: string;
};

export type ClineToolEvidence = {
    callId: string;
    command: string | null;
    inputText: string | null;
    name: string;
    outputText: string | null;
    raw: Record<string, JsonValue>;
    status: 'failed' | 'succeeded' | 'unknown';
    workdir: string | null;
};

export type ClineTranscriptMessage = {
    createdAtMs: number | null;
    messageId: string;
    phase: 'commentary' | 'final_answer' | 'reasoning' | 'tool_call' | 'tool_output' | 'unknown';
    raw: Record<string, JsonValue>;
    role: 'assistant' | 'system' | 'tool' | 'unknown' | 'user';
    text: string;
    tool: ClineToolEvidence | null;
};

export type ClineTaskSummary = {
    assistantMessageCount: number;
    cacheReads: number | null;
    cacheWrites: number | null;
    createdAtMs: number | null;
    isFavorited: boolean;
    lastActiveAtMs: number | null;
    messagesPath: string;
    messageCount: number;
    modelId: string | null;
    reasoningCount: number;
    renderablePartCount: number;
    sessionDir: string;
    taskId: string;
    title: string;
    tokensIn: number | null;
    tokensOut: number | null;
    toolCallCount: number;
    toolResultCount: number;
    totalCost: number | null;
    ulid: string | null;
    userMessageCount: number;
    workspaceKey: string;
    workspaceLabel: string;
    worktree: string;
};

export type ClineTaskTranscript = {
    messages: ClineTranscriptMessage[];
    rawPayloadsOmitted?: boolean;
    renderablePartCount: number;
    task: ClineTaskSummary;
};

export type ClineExportOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: ExportFormat;
};
