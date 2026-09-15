import type { ConversationCleanupFailure, ConversationMessage } from './conversation-data/types';
import type { ExportFormat } from './shared-text';

export type CommandCodeWorkspaceGroup = {
    assistantMessageCount: number;
    key: string;
    label: string;
    lastActiveAtMs: number | null;
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
    toolOutputCount: number;
    userMessageCount: number;
    worktree: string;
};

export type CommandCodeSessionSummary = {
    assistantMessageCount: number;
    createdAtMs: number | null;
    cwd: string;
    filePath: string;
    lastActiveAtMs: number | null;
    messageCount: number;
    model: string | null;
    modelLabel: string | null;
    recordCount: number;
    renderableMessageCount: number;
    sessionId: string;
    title: string;
    toolCallCount: number;
    toolOutputCount: number;
    userMessageCount: number;
    workspaceKey: string;
    workspaceLabel: string;
    worktree: string;
};

export type CommandCodeSessionTranscript = {
    messages: ConversationMessage[];
    rawRecords: Record<string, unknown>[];
    session: CommandCodeSessionSummary;
};

export type DeleteCommandCodeSessionResult = {
    cleanupFailures?: ConversationCleanupFailure[];
    deletedFiles: string[];
    deletedSessionIds: string[];
    receiptId?: string;
};

export type CommandCodeExportOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: ExportFormat;
};
