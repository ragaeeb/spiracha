import os from 'node:os';
import path from 'node:path';
import type { ExportFormat } from './shared';

type CursorPlatform = NodeJS.Platform;

// Cursor keeps chat history in two SQLite stores under the user data dir:
// - per-workspace buckets under workspaceStorage/<bucketId>/state.vscdb
// - a single globalStorage/state.vscdb holding composer headers and message bubbles
export const getDefaultCursorUserDir = (
    platform: CursorPlatform = process.platform,
    env: NodeJS.ProcessEnv = process.env,
    homeDir = os.homedir(),
): string => {
    if (platform === 'win32') {
        return path.win32.join(env.APPDATA || path.win32.join(homeDir, 'AppData', 'Roaming'), 'Cursor', 'User');
    }

    if (platform === 'linux') {
        return path.posix.join(env.XDG_DATA_HOME || path.posix.join(homeDir, '.local', 'share'), 'Cursor', 'User');
    }

    return path.posix.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User');
};

export const DEFAULT_CURSOR_USER_DIR = getDefaultCursorUserDir();

export const resolveCursorUserDir = (): string => {
    const configured = process.env.SPIRACHA_CURSOR_USER_DIR?.trim();
    return configured ? configured : DEFAULT_CURSOR_USER_DIR;
};

export const getCursorWorkspaceStorageDir = (userDir = resolveCursorUserDir()): string =>
    path.join(userDir, 'workspaceStorage');

export const getCursorGlobalDbPath = (userDir = resolveCursorUserDir()): string =>
    path.join(userDir, 'globalStorage', 'state.vscdb');

const inferHomeDirFromCursorUserDir = (userDir: string): string | null => {
    const normalized = userDir.replace(/\\/gu, '/');
    const macSuffix = '/Library/Application Support/Cursor/User';
    const windowsSuffix = '/AppData/Roaming/Cursor/User';
    const linuxSuffix = '/.local/share/Cursor/User';

    for (const suffix of [macSuffix, windowsSuffix, linuxSuffix]) {
        if (normalized.endsWith(suffix)) {
            return userDir.slice(0, userDir.length - suffix.length);
        }
    }

    return null;
};

export const getCursorProjectsDir = (userDir = resolveCursorUserDir()): string => {
    const configured = process.env.SPIRACHA_CURSOR_PROJECTS_DIR?.trim();
    if (configured) {
        return configured;
    }

    const inferredHomeDir = inferHomeDirFromCursorUserDir(userDir);
    return inferredHomeDir ? path.join(inferredHomeDir, '.cursor', 'projects') : path.join(userDir, 'projects');
};

export const COMPOSER_DATA_KEY = 'composer.composerData';
export const COMPOSER_HEADERS_KEY = 'composer.composerHeaders';

export type CursorWorkspaceKind = 'folder' | 'workspace' | 'unknown';

export type CursorWorkspaceBucket = {
    bucketId: string;
    workspaceJsonPath: string;
    dbPath: string;
    mtimeMs: number;
    dbSizeBytes: number;
    kind: CursorWorkspaceKind;
    uri: string;
    label: string;
    folders: string[];
    composerCount: number;
    globalHeaderCount: number;
    // Distinct composer ids attributed to this bucket (bucket composer.composerData plus the global
    // headers that point at it). Used to compute an accurate, de-duplicated workspace thread count.
    threadComposerIds: string[];
};

export type CursorWorkspaceGroup = {
    key: string;
    label: string;
    kind: CursorWorkspaceKind;
    uri: string;
    folders: string[];
    buckets: CursorWorkspaceBucket[];
    threadCount: number;
    lastActiveMs: number;
    needsRecovery: boolean;
};

export type CursorThreadSummary = {
    composerId: string;
    name: string;
    bucketId: string | null;
    workspaceLabel: string;
    workspaceKey: string;
    createdAtMs: number | null;
    lastUpdatedAtMs: number | null;
    bubbleCount: number;
    bubbleBytes: number;
    transcriptDirs: string[];
    mode: string | null;
};

export type CursorBubbleKind = 'user' | 'assistant' | 'unknown';

export type CursorToolCall = {
    name: string;
    callId: string | null;
    status: string | null;
    argumentsText: string | null;
    resultText: string | null;
};

export type CursorBubble = {
    bubbleId: string;
    kind: CursorBubbleKind;
    text: string;
    thinking: string | null;
    toolCall: CursorToolCall | null;
    createdAtMs: number | null;
};

export type CursorThreadHead = {
    composerId: string;
    name: string | null;
    createdAtMs: number | null;
    lastUpdatedAtMs: number | null;
    mode: string | null;
    orderedBubbleIds: string[];
    totalBubbleHeaders: number;
};

export type CursorThreadTranscript = {
    head: CursorThreadHead;
    bubbles: CursorBubble[];
    renderableBubbleCount: number;
    omittedBubbleCount: number;
};

export type CursorExportOptions = {
    includeMetadata: boolean;
    includeCommentary: boolean;
    includeTools: boolean;
    outputFormat: ExportFormat;
};

export type CursorCliOptions = CursorExportOptions & {
    userDir: string;
    workspaceQuery: string | null;
    threadIds: string[];
    outputDir: string | null;
};

export type CursorExportedFile = {
    composerId: string;
    outputPath: string;
};

export type CursorExportRunResult = {
    outputDir: string;
    exportedCount: number;
    files: CursorExportedFile[];
    missingThreadIds: string[];
};

export type CursorRecoverResult = {
    workspaceKey: string;
    activeBucketId: string;
    mergedThreadCount: number;
    relinkedHeaderCount: number;
    addedHeaderCount: number;
    threads: Array<{ composerId: string; name: string; bubbleCount: number }>;
};

export type CursorPruneResult = {
    bubblesDeleted: number;
    composerDataDeleted: number;
    headersRemoved: number;
    workspaceBucketsUpdated: number;
    transcriptDirsRemoved: number;
    composerIds: string[];
};
