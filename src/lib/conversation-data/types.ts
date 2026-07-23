export const CONVERSATION_SOURCES = [
    'codex',
    'claude-code',
    'grok',
    'kiro',
    'qoder',
    'cursor',
    'antigravity',
    'minimax-code',
    'opencode',
] as const;

export type ConversationSource = (typeof CONVERSATION_SOURCES)[number];

export type ConversationMessageRole = 'assistant' | 'system' | 'tool' | 'unknown' | 'user';

export type ConversationMessagePhase =
    | 'commentary'
    | 'final_answer'
    | 'reasoning'
    | 'tool_call'
    | 'tool_output'
    | 'unknown';

export type ConversationMessageSelector = 'all' | 'last_assistant' | 'last_final_answer';

export type ConversationToolEvidence = {
    callId: string | null;
    command: string | null;
    durationMs: number | null;
    exitCode: number | null;
    inputText: string | null;
    name: string;
    namespace: string | null;
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
    label: string;
    source: ConversationSource;
};

export type ConversationDeepLinks = {
    native: string | null;
    spiracha: string;
    ui: string;
};

export type ConversationMessage = {
    createdAtMs: number | null;
    id: string;
    metadata: Record<string, unknown>;
    order: number;
    phase: ConversationMessagePhase;
    role: ConversationMessageRole;
    text: string;
    toolEvidence: ConversationToolEvidence | null;
};

export type ConversationDetail = {
    createdAtMs: number | null;
    deepLinks: ConversationDeepLinks;
    id: string;
    matches: ConversationPathMatch[];
    messageCount: number | null;
    messages: ConversationMessage[];
    metadata: Record<string, unknown>;
    source: ConversationSource;
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
    codexDbPath?: string;
    cursorUserDir?: string;
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

export type ListConversationsForPathOptions = {
    cursor?: string | null;
    cwd: string;
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

export type DeleteConversationOptions = {
    id: string;
    locations?: ConversationDataLocations;
    source: ConversationSource;
};

export type DeleteConversationResult = {
    deletedFiles: string[];
    deletedIds: string[];
};

export type ConversationIdSetOptions = {
    ids: string[];
    locations?: ConversationDataLocations;
    source: ConversationSource;
};

export type DeleteConversationsOptions = ConversationIdSetOptions;

export type DeleteConversationItemResult = DeleteConversationResult & {
    deleted: boolean;
    id: string;
};

export type DeleteConversationsResult = DeleteConversationResult & {
    missingIds: string[];
    results: DeleteConversationItemResult[];
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

export type ResolvedConversationRef = {
    id: string;
    source: ConversationSource;
};

export type ConversationAdapter = {
    deleteConversation?: (options: DeleteConversationOptions) => Promise<DeleteConversationResult>;
    getConversation: (options: GetConversationOptions) => Promise<ConversationDetail | null>;
    listConversationsForPath: (options: ListConversationsForPathOptions) => Promise<ConversationDetail[]>;
    source: ConversationSource;
};
