import type { DELETION_PHASE_MAP } from './deletion-phase-map';
import {
    COMMON_EXPORT_CAPABILITIES,
    DELETE_CAPABILITIES,
    DURABLE_DELETION_RECONCILIATION,
    NATIVE_FILE_RAW_CAPABILITY,
    OPENCODE_ORIGINAL_RAW_EXCEPTION,
    REQUIRED_READ_CAPABILITIES,
    serializeSourceOperations,
} from './operation-types';
import { CONVERSATION_SOURCES, type ConversationSource, type ConversationSourceInfo } from './types';

export type SourceWorkspaceRoute = {
    parameterName: string;
    pathTemplate: `/${string}/$${string}`;
};

const nativeFileCapabilities = {
    ...REQUIRED_READ_CAPABILITIES,
    ...NATIVE_FILE_RAW_CAPABILITY,
    ...DELETE_CAPABILITIES,
    ...COMMON_EXPORT_CAPABILITIES,
} as const;

const durableNativeCapabilities = {
    ...nativeFileCapabilities,
    ...DURABLE_DELETION_RECONCILIATION,
} as const;

const openCodeCapabilities = {
    ...REQUIRED_READ_CAPABILITIES,
    ...OPENCODE_ORIGINAL_RAW_EXCEPTION,
    ...DELETE_CAPABILITIES,
    ...COMMON_EXPORT_CAPABILITIES,
} as const;

const durableOpenCodeCapabilities = {
    ...openCodeCapabilities,
    ...DURABLE_DELETION_RECONCILIATION,
} as const;

type DurableDeletionSource = {
    [S in ConversationSource]: (typeof DELETION_PHASE_MAP)[S]['reconciliation'] extends 'durable_intent' ? S : never;
}[ConversationSource];

type SourceCapabilitiesFor<S extends ConversationSource> = S extends 'opencode'
    ? typeof durableOpenCodeCapabilities
    : S extends DurableDeletionSource
      ? typeof durableNativeCapabilities
      : typeof nativeFileCapabilities;

type SourceDescriptorBase<S extends ConversationSource> = {
    capabilities: SourceCapabilitiesFor<S>;
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

// Identity plus declared operations. Undeclared operations are absent, not unsupported.
export const SOURCE_CATALOG = {
    antigravity: {
        capabilities: nativeFileCapabilities,
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
        capabilities: nativeFileCapabilities,
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
        capabilities: nativeFileCapabilities,
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
        capabilities: durableNativeCapabilities,
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
        capabilities: durableNativeCapabilities,
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
        capabilities: durableNativeCapabilities,
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
        capabilities: nativeFileCapabilities,
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
        capabilities: nativeFileCapabilities,
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
        capabilities: durableNativeCapabilities,
        detailRouteSegment: 'grok-bot-chats',
        exportPlatform: 'grok-bot',
        inventoryPath: '/grok-bot',
        label: 'Grok Bot',
        navigationOrder: 8,
        scope: 'global',
        source: 'grok-bot',
    },
    kiro: {
        capabilities: nativeFileCapabilities,
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
        capabilities: nativeFileCapabilities,
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
        capabilities: durableOpenCodeCapabilities,
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
        capabilities: durableNativeCapabilities,
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

export const isSupportedOriginalRawSource = (source: ConversationSource): boolean =>
    SOURCE_CATALOG[source].capabilities.original_raw.state === 'supported';

export const serializeConversationSourceInfo = (source: ConversationSource): ConversationSourceInfo => {
    const descriptor = SOURCE_CATALOG[source];
    return {
        detailRouteSegment: descriptor.detailRouteSegment,
        exportPlatform: descriptor.exportPlatform,
        inventoryPath: descriptor.inventoryPath,
        label: descriptor.label,
        operations: serializeSourceOperations(descriptor.capabilities),
        scope: descriptor.scope,
        source,
    };
};
