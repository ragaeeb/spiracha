import { CONVERSATION_SOURCES, type ConversationSource } from './types';

export type SourceWorkspaceRoute = {
    parameterName: string;
    pathTemplate: `/${string}/$${string}`;
};

type SourceDescriptorBase<S extends ConversationSource> = {
    detailRouteSegment: string;
    exportPlatform: string;
    inventoryPath: `/${S}`;
    label: string;
    navigationOrder: number;
    source: S;
};

export type SourceDescriptor<S extends ConversationSource> = S extends 'grok-bot'
    ? SourceDescriptorBase<S> & { scope: 'global' }
    : SourceDescriptorBase<S> & { scope: 'workspace'; workspaceRoute: SourceWorkspaceRoute };

export type SourceCatalog = { readonly [S in ConversationSource]: SourceDescriptor<S> };

const workspaceKeyRoute = (source: Exclude<ConversationSource, 'codex' | 'grok-bot'>): SourceWorkspaceRoute => ({
    parameterName: 'workspaceKey',
    pathTemplate: `/${source}/$workspaceKey`,
});

// Identity only. Capability decisions are introduced operation by operation, not inferred from missing methods.
export const SOURCE_CATALOG = {
    antigravity: {
        detailRouteSegment: 'antigravity-conversations',
        exportPlatform: 'antigravity',
        inventoryPath: '/antigravity',
        label: 'Antigravity',
        navigationOrder: 0,
        scope: 'workspace',
        source: 'antigravity',
        workspaceRoute: workspaceKeyRoute('antigravity'),
    },
    'claude-code': {
        detailRouteSegment: 'claude-code-sessions',
        exportPlatform: 'claude',
        inventoryPath: '/claude-code',
        label: 'Claude Code',
        navigationOrder: 1,
        scope: 'workspace',
        source: 'claude-code',
        workspaceRoute: workspaceKeyRoute('claude-code'),
    },
    cline: {
        detailRouteSegment: 'cline-tasks',
        exportPlatform: 'cline',
        inventoryPath: '/cline',
        label: 'Cline',
        navigationOrder: 3,
        scope: 'workspace',
        source: 'cline',
        workspaceRoute: workspaceKeyRoute('cline'),
    },
    codex: {
        detailRouteSegment: 'threads',
        exportPlatform: 'codex',
        inventoryPath: '/codex',
        label: 'Codex',
        navigationOrder: 4,
        scope: 'workspace',
        source: 'codex',
        workspaceRoute: {
            parameterName: 'project',
            pathTemplate: '/codex/$project',
        },
    },
    'command-code': {
        detailRouteSegment: 'command-code-sessions',
        exportPlatform: 'command-code',
        inventoryPath: '/command-code',
        label: 'Command Code',
        navigationOrder: 2,
        scope: 'workspace',
        source: 'command-code',
        workspaceRoute: workspaceKeyRoute('command-code'),
    },
    cursor: {
        detailRouteSegment: 'cursor-threads',
        exportPlatform: 'cursor',
        inventoryPath: '/cursor',
        label: 'Cursor',
        navigationOrder: 5,
        scope: 'workspace',
        source: 'cursor',
        workspaceRoute: workspaceKeyRoute('cursor'),
    },
    fx: {
        detailRouteSegment: 'fx-sessions',
        exportPlatform: 'fx',
        inventoryPath: '/fx',
        label: 'FX',
        navigationOrder: 6,
        scope: 'workspace',
        source: 'fx',
        workspaceRoute: workspaceKeyRoute('fx'),
    },
    grok: {
        detailRouteSegment: 'grok-sessions',
        exportPlatform: 'grok',
        inventoryPath: '/grok',
        label: 'Grok',
        navigationOrder: 7,
        scope: 'workspace',
        source: 'grok',
        workspaceRoute: workspaceKeyRoute('grok'),
    },
    'grok-bot': {
        detailRouteSegment: 'grok-bot-chats',
        exportPlatform: 'grok-bot',
        inventoryPath: '/grok-bot',
        label: 'Grok Bot',
        navigationOrder: 8,
        scope: 'global',
        source: 'grok-bot',
    },
    kiro: {
        detailRouteSegment: 'kiro-sessions',
        exportPlatform: 'kiro',
        inventoryPath: '/kiro',
        label: 'Kiro',
        navigationOrder: 9,
        scope: 'workspace',
        source: 'kiro',
        workspaceRoute: workspaceKeyRoute('kiro'),
    },
    'minimax-code': {
        detailRouteSegment: 'minimax-code-sessions',
        exportPlatform: 'minimax',
        inventoryPath: '/minimax-code',
        label: 'MiniMax Code',
        navigationOrder: 10,
        scope: 'workspace',
        source: 'minimax-code',
        workspaceRoute: workspaceKeyRoute('minimax-code'),
    },
    opencode: {
        detailRouteSegment: 'opencode-sessions',
        exportPlatform: 'opencode',
        inventoryPath: '/opencode',
        label: 'OpenCode',
        navigationOrder: 11,
        scope: 'workspace',
        source: 'opencode',
        workspaceRoute: workspaceKeyRoute('opencode'),
    },
    qoder: {
        detailRouteSegment: 'qoder-sessions',
        exportPlatform: 'qoder',
        inventoryPath: '/qoder',
        label: 'Qoder',
        navigationOrder: 12,
        scope: 'workspace',
        source: 'qoder',
        workspaceRoute: workspaceKeyRoute('qoder'),
    },
} as const satisfies SourceCatalog;

export const sourceFromDetailRouteSegment = (segment: string): ConversationSource | null =>
    CONVERSATION_SOURCES.find((source) => SOURCE_CATALOG[source].detailRouteSegment === segment) ?? null;
