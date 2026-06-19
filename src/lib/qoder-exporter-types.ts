import os from 'node:os';
import path from 'node:path';
import type { ExportFormat, JsonValue } from './shared';

export const getDefaultQoderUserDir = (_env: NodeJS.ProcessEnv = process.env, homeDir = os.homedir()): string => {
    return path.join(homeDir, 'Library', 'Application Support', 'Qoder', 'User');
};

export const DEFAULT_QODER_USER_DIR = getDefaultQoderUserDir();

export const resolveQoderUserDir = (): string => {
    const configured =
        process.env.SPIRACHA_QODER_USER_DIR?.trim() ||
        process.env.SPIRACHA_QODER_DATA_DIR?.trim() ||
        process.env.SPIRACHA_QODER_DIR?.trim();
    return configured ? configured : DEFAULT_QODER_USER_DIR;
};

export const resolveQoderGlobalStateDb = (): string => {
    const configured = process.env.SPIRACHA_QODER_GLOBAL_STATE_DB?.trim();
    return configured ? configured : path.join(resolveQoderUserDir(), 'globalStorage', 'state.vscdb');
};

export const resolveQoderWorkspaceStorageDir = (): string => {
    const configured = process.env.SPIRACHA_QODER_WORKSPACE_STORAGE_DIR?.trim();
    return configured ? configured : path.join(resolveQoderUserDir(), 'workspaceStorage');
};

export const resolveQoderCliProjectsDir = (): string => {
    const configured = process.env.SPIRACHA_QODER_CLI_PROJECTS_DIR?.trim();
    return configured
        ? configured
        : path.join(path.dirname(resolveQoderUserDir()), 'SharedClientCache', 'cli', 'projects');
};

export type QoderWorkspaceGroup = {
    assistantMessageCount: number;
    fileOperationCount: number;
    key: string;
    label: string;
    lastActiveAtIso: string | null;
    lastActiveAtMs: number | null;
    messageCount: number;
    renderablePartCount: number;
    sessionCount: number;
    snapshotFileCount: number;
    uri: string;
    userMessageCount: number;
    workspaceStorageIds: string[];
    worktree: string;
};

export type QoderSessionSummary = {
    agentClass: string | null;
    assistantMessageCount: number;
    createdAtIso: string | null;
    createdAtMs: number | null;
    executionMode: string | null;
    fileOperationCount: number;
    historyIds: string[];
    lastActiveAtIso: string | null;
    lastActiveAtMs: number | null;
    messageCount: number;
    model: string | null;
    query: string | null;
    renderablePartCount: number;
    requestId: string | null;
    sessionId: string;
    snapshotFileCount: number;
    sourceStatePath: string | null;
    status: string | null;
    taskId: string | null;
    title: string;
    userMessageCount: number;
    workspaceKey: string;
    workspaceLabel: string;
    workspacePath: string | null;
    workspaceStorageId: string | null;
    worktree: string;
};

export type QoderPartType = 'text' | 'unknown';

export type QoderTranscriptPart = {
    raw: Record<string, JsonValue>;
    text?: string;
    type: QoderPartType;
};

export type QoderTranscriptEntryType = 'message' | 'tool_call' | 'tool_output';

export type QoderTranscriptEntry = {
    entryId: string;
    entryType: QoderTranscriptEntryType;
    parts: QoderTranscriptPart[];
    raw: Record<string, JsonValue>;
    requestId: string | null;
    role: string;
    timestamp: string | null;
};

export type QoderSessionTranscript = {
    entries: QoderTranscriptEntry[];
    rawSession: Record<string, JsonValue>;
    renderablePartCount: number;
    session: QoderSessionSummary;
};

export type QoderExportOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: ExportFormat;
};
