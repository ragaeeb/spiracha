import type { AgentDxAnalytics } from './agent-dx-analytics';
import type { SessionMeta, ThreadRelations, ThreadRow } from './codex-thread-types';
import type { ThreadEvent, ThreadTranscriptStats } from './conversation-data/conversation-events';
import type { JsonValue } from './shared-text';

export type {
    AgentDxAnalytics,
    AgentDxDistributionItem,
    AgentDxEventClass,
    AgentDxGoalSpan,
    AgentDxIncrementalTokens,
    AgentDxRetainedBytes,
    AgentDxTerminalOutcome,
    AgentDxUsage,
    AgentDxUsageSemantics,
    AgentDxWarning,
} from './agent-dx-analytics';

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

export type ThreadGoal = {
    createdAtMs: number;
    goalId: string;
    objective: string;
    status: string;
    timeUsedSeconds: number;
    tokenBudget: number | null;
    tokensUsed: number;
    updatedAtMs: number;
};

export type SessionMetaExtended = SessionMeta & {
    baseInstructions: JsonValue | null;
    dynamicTools: DynamicToolDefinition[];
    forkedFromId: string | null;
    forkedFromOrdinalExclusive: number | null;
    git: Record<string, JsonValue> | null;
    modelProvider: string | null;
    threadSource: string | null;
};

export type TurnContextRecord = {
    payload: Record<string, JsonValue>;
    timestamp: string | null;
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
    hierarchy: {
        childThreadCount: number;
        parentThreadId: string | null;
    };
    modelNames: string[];
    project: string;
    rolloutSizeBytes: number | null;
    stats: Pick<ThreadTranscriptStats, 'execCommandCount' | 'toolCallCount' | 'webSearchEventCount'> & {
        deferred: boolean;
    };
    thread: ThreadRow;
};

export type ThreadBrowseData = {
    dynamicTools: DynamicToolRow[];
    goals: ThreadGoal[];
    project: string;
    relations: ThreadRelations;
    thread: ThreadRow;
};

export type CodexDbSchemaProfile = {
    name: string;
    requiredColumns: Readonly<Record<string, readonly string[]>>;
    requiredTables: readonly string[];
};

export type CodexThreadBrowseBatchResult =
    | {
          data: ThreadBrowseData;
          source: 'database' | 'fallback';
          status: 'found';
          threadId: string;
      }
    | {
          data: null;
          source: 'missing';
          status: 'missing';
          threadId: string;
      };

export type DashboardThreadSummary = Pick<
    ThreadRow,
    'cwd' | 'id' | 'model' | 'preview' | 'title' | 'tokens_used' | 'updated_at' | 'updated_at_ms'
>;

export type DashboardRecentThread = {
    project: string;
    thread: DashboardThreadSummary;
};

export type DashboardSummary = {
    activeThreads: number;
    archivedThreads: number;
    recentThreads: DashboardRecentThread[];
    threadsWithRelations: number;
    topProjectsByThreadCount: ProjectSummary[];
    topProjectsByTokens: ProjectSummary[];
    totalProjects: number;
    totalThreads: number;
    totalTokens: number;
};

export type CodexSessionIndexEntry = {
    id: string;
    thread_name?: string;
    updated_at?: string;
};

export type CodexSessionIndexReconciliation = {
    dryRun: true;
    staleEntries: CodexSessionIndexEntry[];
};

export type DeleteThreadsResult = {
    cleanup: {
        globalStateReferencesRemoved: string[];
        globalStateWritingBlocksSet: string[];
        localThreadCatalogEntriesRemoved: string[];
        requested: boolean;
        sessionIndexEntriesRemoved: string[];
    };
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
    medianTokensPerThread: number;
    threadsWithWebSearch: number;
    totalProjects: number;
    totalThreads: number;
    totalTokens: number;
};

export type CodexOptimizationSeverity = 'high' | 'medium' | 'low';

export type CodexOptimizationFinding = {
    affectedThreads: number;
    id: string;
    impactBytes: number | null;
    observedCount: number;
    recommendation: string;
    severity: CodexOptimizationSeverity;
    title: string;
};

export type CodexOptimizationSummary = {
    broadReadCalls: number;
    externalAgentStreamBlocks: number;
    externalAgentStreamBytes: number;
    fullContextSpawns: number;
    genericSubagentSpawns: number;
    parentVisibleReasoningEvents: number;
    parentVisibleSubagentToolEvents: number;
    repeatedCheckCalls: number;
    repeatedCommandCalls: number;
    repeatedReadCalls: number;
    timedOutWaits: number;
    toolOutputBytes: number;
    truncationBlocks: number;
    truncatedOutputBytes: number;
};

export type CodexOptimizationAnalytics = {
    findings: CodexOptimizationFinding[];
    personaCandidates: DistributionItem[];
    summary: CodexOptimizationSummary;
};

export type CodexAnalytics = {
    agentDx: AgentDxAnalytics;
    modelsByTokens: ModelTokenSummary[];
    optimization: CodexOptimizationAnalytics;
    reasoningEfforts: DistributionItem[];
    sources: DistributionItem[];
    summary: CodexAnalyticsSummary;
    toolUsage: ToolUsageSummary[];
};
