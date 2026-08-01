import os from 'node:os';
import path from 'node:path';
import type { ExportFormat, JsonValue } from './shared';

const getVsCodeGlobalStorageRoot = (homeDir: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv) => {
    if (platform === 'darwin') {
        return path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'globalStorage');
    }
    if (platform === 'win32') {
        return path.join(
            env.APPDATA?.trim() || path.join(homeDir, 'AppData', 'Roaming'),
            'Code',
            'User',
            'globalStorage',
        );
    }
    return path.join(env.XDG_CONFIG_HOME?.trim() || path.join(homeDir, '.config'), 'Code', 'User', 'globalStorage');
};

export const getDefaultClineGlobalStorageDir = (
    env: NodeJS.ProcessEnv = process.env,
    homeDir = os.homedir(),
    platform = process.platform,
): string => {
    return path.join(getVsCodeGlobalStorageRoot(homeDir, platform, env), 'saoudrizwan.claude-dev');
};

export const DEFAULT_CLINE_GLOBAL_STORAGE_DIR = getDefaultClineGlobalStorageDir();

export const resolveClineGlobalStorageDir = (): string => {
    return process.env.SPIRACHA_CLINE_GLOBAL_STORAGE_DIR?.trim() || DEFAULT_CLINE_GLOBAL_STORAGE_DIR;
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
    messageCount: number;
    modelId: string | null;
    reasoningCount: number;
    renderablePartCount: number;
    taskDir: string;
    taskId: string;
    title: string;
    tokensIn: number | null;
    tokensOut: number | null;
    toolCallCount: number;
    toolResultCount: number;
    totalCost: number | null;
    uiMessagesPath: string;
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
