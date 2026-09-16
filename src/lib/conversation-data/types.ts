import type { OperationId, PublicMutationError, SerializedSourceOperation } from './operation-types';

export const CONVERSATION_SOURCES = [
    'cline',
    'codex',
    'command-code',
    'claude-code',
    'grok',
    'kiro',
    'qoder',
    'cursor',
    'fx',
    'antigravity',
    'grok-bot',
    'minimax-code',
    'opencode',
] as const;

export type ConversationSource = (typeof CONVERSATION_SOURCES)[number];

export type ConversationSourceScope = 'global' | 'workspace';

export type ConversationMessageRole = 'assistant' | 'system' | 'tool' | 'unknown' | 'user';

export type ConversationMessagePhase =
    | 'commentary'
    | 'final_answer'
    | 'reasoning'
    | 'tool_call'
    | 'tool_output'
    | 'unknown';

export type ConversationMessageSelector = 'all' | 'last_assistant' | 'last_final_answer';

export type ContentState =
    | { representation: 'full' | 'summary'; state: 'available' }
    | { availableCharacters: number; reason: string; state: 'partial'; totalCharacters: number | null }
    | { reason: string; state: 'deferred' }
    | { reason: string; state: 'encrypted' }
    | { reason: string; state: 'unavailable' };

export type MessageProvenance = {
    blockIndex: number | null;
    branchId: string | null;
    origin: 'derived' | 'native' | 'synthetic';
    parentMessageId: string | null;
    sourceConversationId: string;
    sourceRecordId: string | null;
};

export type ConversationMessageVisibility = 'bootstrap' | 'normal' | 'synthetic';

export type ConversationToolEvidence = {
    callId: string | null;
    command: string | null;
    durationMs: number | null;
    exitCode: number | null;
    inputContentState?: ContentState | null;
    inputText: string | null;
    name: string;
    namespace: string | null;
    outputContentState?: ContentState | null;
    outputText: string | null;
    status: 'failed' | 'succeeded' | 'unknown';
    workdir: string | null;
};

export type ConversationEvidencePairingConfidence = 'exact' | 'ordered_fallback' | 'unpaired';

export type ConversationEvidenceEvent = {
    artifacts: string[];
    conversationId: string;
    createdAtMs: number | null;
    messageId: string;
    metadata: Record<string, unknown>;
    order: number;
    pairingConfidence: ConversationEvidencePairingConfidence;
    pairedOutputIndex?: number;
    phase: ConversationMessagePhase;
    role: ConversationMessageRole;
    source: ConversationSource;
    text: string;
    tool: ConversationToolEvidence | null;
};

export type EvidenceAnchor =
    | { kind: 'tool'; names?: string[]; namespaces?: string[] }
    | { executables: string[]; kind: 'shell-command'; subcommands?: string[] }
    | { globs: string[]; kind: 'artifact' }
    | { kind: 'schema'; prefixes: string[] }
    | { globs: string[]; kind: 'cwd' }
    | { kind: 'text'; literals: string[] };

export type EvidenceLens = {
    anchors: EvidenceAnchor[];
    budget: {
        commentaryCharactersPerEpisode: number;
        failedOutputCharacters: number;
        successfulOutputCharacters: number;
        totalCharacters: number;
    };
    context: {
        commentaryAfter: number;
        commentaryBefore: number;
        followRetries: boolean;
        followWorkarounds: boolean;
        includeReasoningSummaries: boolean;
        maxOrderGap: number;
    };
    name: string;
};

export type EvidenceOmissionStats = {
    budgetReached: boolean;
    deduplicatedDiagnostics: number;
    inputCharacters: number;
    inputEvents: number;
    omittedBinaryPayloads: number;
    omittedEvents: number;
    selectedEvents: number;
    truncatedArrays: number;
    truncatedFields: number;
};

export type ConversationEvidenceExport = {
    markdown: string;
    meta: {
        approximateTokens: number;
        episodeCount: number;
        generatedAt: string;
        omission: EvidenceOmissionStats;
        projectedCharacters: number;
        rendererVersion: string;
    };
};

export type ExportConversationEvidenceOptions = GetConversationOptions & {
    generatedAt?: string;
    lens: EvidenceLens;
};

export type ConversationPathMatch = {
    candidatePath: string | null;
    kind: 'descendant' | 'exact' | 'unknown';
    requestedPath: string;
};

export type ConversationSourceInfo = {
    detailRouteSegment: string;
    exportPlatform: string;
    inventoryPath: string;
    label: string;
    operations: {
        [K in OperationId]?: SerializedSourceOperation;
    } & {
        batch_delete: SerializedSourceOperation;
        delete: SerializedSourceOperation;
        detail: SerializedSourceOperation;
        list: SerializedSourceOperation;
        original_raw: SerializedSourceOperation;
    };
    scope: ConversationSourceScope;
    source: ConversationSource;
};

export type ConversationDeepLinks = {
    native: string | null;
    spiracha: string;
    ui: string;
};

export type ConversationMessage = {
    contentState: ContentState;
    createdAtMs: number | null;
    id: string;
    model?: string;
    metadata: Record<string, unknown>;
    order: number;
    phase: ConversationMessagePhase;
    provenance: MessageProvenance;
    role: ConversationMessageRole;
    text: string;
    toolEvidence: ConversationToolEvidence | null;
    visibility: ConversationMessageVisibility;
};

export type ConversationArtifact = {
    content: string;
    id: string;
    title: string;
};

export type ConversationBodyAvailability = 'full' | 'preview' | 'selected' | 'summary';

export type SupplementalEventKind = 'lifecycle' | 'search' | 'token_usage' | 'unknown';

export type SupplementalEvent = {
    createdAtMs: number | null;
    id: string;
    kind: SupplementalEventKind;
    metadata: Record<string, string | number | boolean | null>;
    order: number;
    provenance: MessageProvenance;
    text: string;
};

export type ConversationDetail = {
    artifacts?: ConversationArtifact[];
    bodyAvailability?: ConversationBodyAvailability;
    createdAtMs: number | null;
    deepLinks: ConversationDeepLinks;
    id: string;
    matches: ConversationPathMatch[];
    model?: string;
    messageCount: number | null;
    messages: ConversationMessage[];
    metadata: Record<string, unknown>;
    source: ConversationSource;
    supplementalEvents?: SupplementalEvent[];
    title: string | null;
    updatedAtMs: number | null;
    workspaceKey: string | null;
    workspacePath: string | null;
};

export type ConversationPage = {
    data: ConversationDetail[];
    meta: {
        hasNext: boolean;
        nextCursor: string | null;
    };
};

export type ConversationDataLocations = {
    antigravityRoots?: string[];
    claudeCodeProjectsDir?: string;
    clineDataDir?: string;
    commandCodeProjectsDir?: string;
    codexDbPath?: string;
    cursorUserDir?: string;
    fxDataDir?: string;
    grokBotPersistenceDir?: string;
    grokSessionsDir?: string;
    kiroWorkspaceSessionsDir?: string;
    minimaxCodeRuntimeDbPath?: string;
    minimaxCodeSessionsDir?: string;
    opencodeDbPath?: string;
    qoderAcpSocketPath?: string;
    qoderCliProjectsDir?: string;
    qoderGlobalStateDb?: string;
    qoderWorkspaceStorageDir?: string;
};

export type ListConversationsOptions = {
    cursor?: string | null;
    cwd?: string;
    includeMessages?: boolean;
    limit?: number;
    locations?: ConversationDataLocations;
    messageSelector?: ConversationMessageSelector;
    sources?: ConversationSource[] | 'all';
    updatedAfterMs?: number;
    updatedBeforeMs?: number;
};

export type GetConversationOptions = {
    id: string;
    locations?: ConversationDataLocations;
    messageSelector?: ConversationMessageSelector;
    source: ConversationSource;
};

export type GetConversationRawOptions = Pick<GetConversationOptions, 'id' | 'locations' | 'source'>;

export type DeleteConversationOptions = {
    deleteSessionFiles?: boolean;
    id: string;
    locations?: ConversationDataLocations;
    source: ConversationSource;
};

export type DeleteConversationResult = {
    cleanupFailures?: ConversationCleanupFailure[];
    deletedFiles: string[];
    deletedIds: string[];
    receiptId?: string;
};

export type ConversationCleanupFailure = {
    error: string;
    path?: string;
    phase: string;
};

export type ConversationIdSetOptions = {
    ids: string[];
    locations?: ConversationDataLocations;
    source: ConversationSource;
};

export type DeleteConversationsOptions = ConversationIdSetOptions & {
    deleteSessionFiles?: boolean;
    signal?: AbortSignal;
};

export type DeleteConversationItemResult = DeleteConversationResult & {
    deleted: boolean;
    id: string;
};

export type DeleteOutcome =
    | { affectedIds: string[]; coveredBy: string | null; deletedFiles: string[]; id: string; status: 'deleted' }
    | { affectedIds: []; deletedFiles: []; id: string; status: 'missing' }
    | {
          affectedIds: string[];
          deletedFiles: string[];
          failures: ConversationCleanupFailure[];
          id: string;
          receiptId: string;
          status: 'cleanup_pending';
      }
    | {
          affectedIds: string[];
          deletedFiles: string[];
          effect: 'none' | 'partial' | 'unknown';
          error: PublicMutationError;
          id: string;
          receiptId: string | null;
          status: 'failed';
      }
    | { affectedIds: []; deletedFiles: []; id: string; status: 'cancelled' };

export type DeleteBatchRequestMetadata = {
    duplicateCount: number;
    ids: string[];
    uniqueIds: string[];
};

export type DeleteBatchSummary = {
    cancelled: number;
    cleanupPending: number;
    deleted: number;
    failed: number;
    missing: number;
};

export type DeleteConversationsResult = DeleteConversationResult & {
    affectedIds: string[];
    missingIds: string[];
    outcomes: DeleteOutcome[];
    request: DeleteBatchRequestMetadata;
    results: DeleteConversationItemResult[];
    summary: DeleteBatchSummary;
};

export type ExportConversationsZipOptions = ConversationIdSetOptions & {
    messageSelector?: ConversationMessageSelector;
    outputFormat?: 'md';
};

export type ConversationZipDownload = {
    blob: Blob;
    fileName: string;
    mimeType: 'application/zip';
};

export type ConversationRawDownload = {
    blob: Blob;
    fileName: string;
    mimeType: 'application/json' | 'application/octet-stream' | 'application/x-ndjson' | 'application/zip';
};

export type ResolvedConversationRef = {
    id: string;
    source: ConversationSource;
};

type ConversationAdapterCore<S extends ConversationSource> = {
    deleteConversation: (options: DeleteConversationOptions) => Promise<DeleteConversationResult>;
    getConversation: (options: GetConversationOptions) => Promise<ConversationDetail | null>;
    listConversations: (options: ListConversationsOptions) => Promise<ConversationDetail[]>;
    source: S;
};

type ConversationAdapterRaw<S extends ConversationSource> = S extends 'opencode'
    ? { getConversationRaw?: never }
    : {
          getConversationRaw: (options: GetConversationRawOptions) => Promise<ConversationRawDownload | null>;
      };

/**
 * Internal source-owned adapter contract, not a filesystem-driver plugin API.
 * list/get must return normalized DTOs with explicit nullable fields, stable source
 * identity, deterministic message order, and source-derived tool evidence.
 * Delete is required on every source. Original raw is required except OpenCode,
 * whose catalog exception forbids a handler. Absence must not be replaced with
 * synthesized raw data or a generic file delete. The collector may suppress list
 * errors in all-source mode; explicit calls retain source failures.
 */
export type ConversationAdapter<S extends ConversationSource = ConversationSource> = ConversationAdapterCore<S> &
    ConversationAdapterRaw<S>;

export type ConversationAdapterRegistry = { [S in ConversationSource]: ConversationAdapter<S> };
