import os from 'node:os';
import path from 'node:path';

export const DEFAULT_ANTIGRAVITY_IDE_DIR = path.join(os.homedir(), '.gemini', 'antigravity-ide');
export const DEFAULT_ANTIGRAVITY_DIR = path.join(os.homedir(), '.gemini', 'antigravity');

export const resolveAntigravityRoots = (): string[] => {
    const configured = process.env.SPIRACHA_ANTIGRAVITY_DIRS?.trim() || process.env.SPIRACHA_ANTIGRAVITY_DIR?.trim();
    if (configured) {
        return configured
            .split(path.delimiter)
            .map((entry) => entry.trim())
            .filter(Boolean);
    }

    return [DEFAULT_ANTIGRAVITY_IDE_DIR, DEFAULT_ANTIGRAVITY_DIR];
};

export const getAntigravityConversationDir = (root: string): string => path.join(root, 'conversations');

export const getAntigravityBrainDir = (root: string): string => path.join(root, 'brain');

export const getAntigravitySummaryIndexPath = (root: string): string => path.join(root, 'agyhub_summaries_proto.pb');

export type AntigravityArtifact = {
    artifactType: string | null;
    bytes: number;
    name: string;
    path: string;
    sourceRoot: string;
    summary: string | null;
    updatedAtMs: number | null;
};

export type AntigravityTranscriptSource = 'overview' | 'safe-storage' | 'trajectory' | 'transcript';

export type AntigravityConversation = {
    artifactBytes: number;
    artifactCount: number;
    artifacts: AntigravityArtifact[];
    conversationBytes: number;
    conversationId: string;
    conversationMtimeMs: number | null;
    conversationPath: string | null;
    createdAtMs: number | null;
    indexedItemCount: number | null;
    lastUpdatedAtMs: number | null;
    model: string | null;
    projectId: string | null;
    sourceRoot: string | null;
    summaryPath: string | null;
    title: string;
    totalBytes: number;
    transcriptBytes: number;
    transcriptEntryCount: number;
    transcriptPath: string | null;
    transcriptSource: AntigravityTranscriptSource | null;
    workspaceFolder: string | null;
    workspaceKey: string;
    workspaceLabel: string;
    workspaceUri: string | null;
};

export type AntigravityWorkspaceGroup = {
    artifactCount: number;
    conversationBytes: number;
    conversationCount: number;
    key: string;
    label: string;
    lastActiveMs: number;
    transcriptCount: number;
    totalBytes: number;
    uri: string | null;
};
