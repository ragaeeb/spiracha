import os from 'node:os';
import path from 'node:path';
import type { ExportFormat, JsonValue } from './shared';

export type CodexCliOptions = {
    dbPath: string;
    inputDir: string;
    outputDir: string;
    cwdFilter: string | null;
    projectFilter: string | null;
    threadIds: string[];
    includeMetadata: boolean;
    includeCommentary: boolean;
    includeTools: boolean;
    outputFormat: ExportFormat;
    flat: boolean;
};

export type CodexExportedFile = {
    sourcePath: string;
    outputPath: string;
    threadId: string | null;
};

export type CodexExportRunResult = {
    outputDir: string;
    exportedCount: number;
    files: CodexExportedFile[];
    missingThreadIds: string[];
};

export type SessionMeta = {
    id?: string;
    timestamp?: string;
    cwd?: string;
    source?: string;
    originator?: string;
    cli_version?: string;
    thread_source?: string;
    model_provider?: string;
};

export type MessageRecord = {
    role: string;
    content: JsonValue;
    model?: string | null;
    phase?: string;
};

export type ToolRecord = {
    kind: 'call' | 'output';
    name: string;
    callId: string | null;
    argumentsText?: string;
    outputText?: string;
};

export type ThreadRow = {
    id: string;
    rollout_path: string;
    created_at: number;
    updated_at: number;
    source: string;
    model_provider: string;
    cwd: string;
    title: string;
    sandbox_policy: string;
    approval_mode: string;
    tokens_used: number;
    has_user_event: number;
    archived: number;
    archived_at: number | null;
    git_sha: string | null;
    git_branch: string | null;
    git_origin_url: string | null;
    cli_version: string;
    first_user_message: string;
    agent_nickname: string | null;
    agent_role: string | null;
    memory_mode: string;
    model: string | null;
    reasoning_effort: string | null;
    agent_path: string | null;
    created_at_ms: number | null;
    updated_at_ms: number | null;
    thread_source: string | null;
    preview: string;
};

export type SpawnEdgeRow = {
    parent_thread_id: string;
    child_thread_id: string;
    status: string;
};

export type ThreadRelations = {
    parentThreadId: string | null;
    childEdges: SpawnEdgeRow[];
};

export type ExportTarget = {
    sessionFile: string;
    outputRelativePath: string;
    thread: ThreadRow | null;
    relations: ThreadRelations;
    fallbackReason: string | null;
};

export type ThreadData = {
    threadsById: Map<string, ThreadRow>;
    parentByChildId: Map<string, SpawnEdgeRow>;
    childEdgesByParentId: Map<string, SpawnEdgeRow[]>;
};

export const DEFAULT_CODEX_DIR = path.join(os.homedir(), '.codex');
export const DEFAULT_DB_PATH = path.join(DEFAULT_CODEX_DIR, 'state_5.sqlite');
export const DEFAULT_INPUT_DIR = path.join(DEFAULT_CODEX_DIR, 'sessions');
export const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), 'exports');
