import type { SessionMeta, ThreadRelations, ThreadRow } from './codex-exporter-types';
import type { JsonValue } from './shared';

export type DynamicToolDefinition = {
    deferLoading: boolean;
    description: string;
    inputSchema: JsonValue | null;
    name: string;
    namespace: string | null;
};

export type DynamicToolRow = DynamicToolDefinition & {
    position: number;
    threadId: string;
};

export type SessionMetaExtended = SessionMeta & {
    baseInstructions: JsonValue | null;
    dynamicTools: DynamicToolDefinition[];
    git: Record<string, JsonValue> | null;
    modelProvider: string | null;
    threadSource: string | null;
};

export type TurnContextRecord = {
    payload: Record<string, JsonValue>;
    timestamp: string | null;
};

type BaseThreadEvent = {
    kind:
        | 'message'
        | 'reasoning'
        | 'task_complete'
        | 'task_started'
        | 'token_count'
        | 'tool_call'
        | 'tool_output'
        | 'web_search';
    raw: Record<string, JsonValue>;
    sequence: number;
    timestamp: string | null;
};

export type MessageEvent = BaseThreadEvent & {
    kind: 'message';
    isHiddenByDefault: boolean;
    memoryCitation: JsonValue | null;
    model: string | null;
    phase: string | null;
    role: string;
    text: string;
    variant: 'agent_message' | 'message' | 'user_message';
};

export type ToolCallEvent = BaseThreadEvent & {
    argumentsText: string | null;
    argumentsParseFailed: boolean;
    callId: string | null;
    command: string | null;
    kind: 'tool_call';
    name: string;
    workdir: string | null;
};

export type ToolOutputEvent = BaseThreadEvent & {
    callId: string | null;
    exitCode: number | null;
    kind: 'tool_output';
    outputText: string;
    summary: string;
    wallTime: string | null;
};

export type ReasoningEvent = BaseThreadEvent & {
    content: JsonValue | null;
    hasEncryptedContent: boolean;
    kind: 'reasoning';
    summary: string[];
};

export type TokenCountEvent = BaseThreadEvent & {
    info: JsonValue | null;
    kind: 'token_count';
    rateLimits: JsonValue | null;
};

export type TaskStartedEvent = BaseThreadEvent & {
    collaborationModeKind: string | null;
    kind: 'task_started';
    modelContextWindow: number | null;
    startedAt: number | null;
    turnId: string | null;
};

export type TaskCompleteEvent = BaseThreadEvent & {
    completedAt: number | null;
    durationMs: number | null;
    kind: 'task_complete';
    lastAgentMessage: string | null;
    timeToFirstTokenMs: number | null;
    turnId: string | null;
};

export type WebSearchEvent = BaseThreadEvent & {
    action: JsonValue | null;
    callId: string | null;
    kind: 'web_search';
    phase: 'call' | 'end';
    query: string | null;
    status: string | null;
};

export type ThreadEvent =
    | MessageEvent
    | ReasoningEvent
    | TaskCompleteEvent
    | TaskStartedEvent
    | TokenCountEvent
    | ToolCallEvent
    | ToolOutputEvent
    | WebSearchEvent;

export type ThreadTranscriptStats = {
    assistantMessageCount: number;
    commentaryCount: number;
    execCommandCount: number;
    finalAnswerCount: number;
    messageCount: number;
    toolCallCount: number;
    toolOutputCount: number;
    userMessageCount: number;
    webSearchEventCount: number;
};

export type ParsedCodexTranscript = {
    events: ThreadEvent[];
    isPartial: boolean;
    rawIncluded: boolean;
    sessionMeta: SessionMetaExtended;
    sourceFileSizeBytes: number | null;
    stats: ThreadTranscriptStats;
    statsArePartial: boolean;
    turnContexts: TurnContextRecord[];
};

export type ProjectSummary = {
    archivedThreadCount: number;
    cwdPaths: string[];
    lastUpdatedAtMs: number | null;
    modelNames: string[];
    name: string;
    threadCount: number;
    totalTokens: number;
};

export type ThreadListEntry = {
    project: string;
    rolloutSizeBytes: number | null;
    stats: Pick<ThreadTranscriptStats, 'execCommandCount' | 'toolCallCount' | 'webSearchEventCount'> & {
        deferred: boolean;
    };
    thread: ThreadRow;
};

export type ThreadBrowseData = {
    dynamicTools: DynamicToolRow[];
    project: string;
    relations: ThreadRelations;
    thread: ThreadRow;
};

export type DashboardSummary = {
    activeThreads: number;
    archivedThreads: number;
    recentThreads: ThreadRow[];
    threadsWithRelations: number;
    topProjectsByThreadCount: ProjectSummary[];
    topProjectsByTokens: ProjectSummary[];
    totalProjects: number;
    totalThreads: number;
    totalTokens: number;
};

export type DeleteThreadsResult = {
    deletedSessionFiles: string[];
    deletedThreadIds: string[];
};

export type DeleteProjectResult = DeleteThreadsResult & {
    projectName: string;
};

export type RecoverProjectThreadsResult = {
    backups: {
        globalState: string;
        sessionIndex: string;
        stateDb: string;
    };
    projectName: string;
    projectRootsAdded: number;
    resolvedCwds: string[];
    rolloutFilesTouched: number;
    savedRootsAdded: number;
    sessionIndexRowsUpdated: number;
    threadDbRowsUpdated: number;
    topLevelThreadsFound: number;
};

export type ToolUsageSummary = {
    count: number;
    name: string;
};

export type ModelTokenSummary = {
    model: string;
    threadCount: number;
    totalTokens: number;
};

export type DistributionItem = {
    count: number;
    label: string;
};

export type CodexAnalyticsSummary = {
    archivedThreads: number;
    averageTokensPerThread: number;
    distinctToolNames: number;
    threadsWithWebSearch: number;
    totalProjects: number;
    totalThreads: number;
    totalTokens: number;
};

export type CodexAnalytics = {
    modelsByTokens: ModelTokenSummary[];
    summary: CodexAnalyticsSummary;
    toolUsage: ToolUsageSummary[];
};
