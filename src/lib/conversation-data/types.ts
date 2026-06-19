export const CONVERSATION_SOURCES = [
    'codex',
    'claude-code',
    'kiro',
    'qoder',
    'cursor',
    'antigravity',
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
    kiroWorkspaceSessionsDir?: string;
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

export type ResolvedConversationRef = {
    id: string;
    source: ConversationSource;
};

export type ConversationAdapter = {
    getConversation: (options: GetConversationOptions) => Promise<ConversationDetail | null>;
    listConversationsForPath: (options: ListConversationsForPathOptions) => Promise<ConversationDetail[]>;
    source: ConversationSource;
};
