import { CONVERSATION_SOURCES, type ConversationSource } from '@spiracha/lib/conversation-data/types';
import {
    antigravityConversationDetailQueryOptions,
    antigravityConversationDocumentsQueryOptions,
    antigravityConversationsQueryOptions,
    antigravityDecryptionQueryOptions,
    antigravityWorkspacesQueryOptions,
} from './antigravity-queries';
import {
    claudeCodeSessionDetailQueryOptions,
    claudeCodeSessionsQueryOptions,
    claudeCodeSessionTranscriptQueryOptions,
    claudeCodeWorkspacesQueryOptions,
} from './claude-code-queries';
import { clineTaskDetailQueryOptions, clineTasksQueryOptions, clineWorkspacesQueryOptions } from './cline-queries';
import {
    codexCloudProjectQueryOptions,
    codexCloudProjectsQueryOptions,
    codexCloudTaskQueryOptions,
} from './codex-cloud-queries';
import {
    analyticsQueryOptions,
    dashboardQueryOptions,
    projectsQueryOptions,
    projectThreadsQueryOptions,
    threadSnapshotQueryOptions,
    threadTranscriptQueryOptions,
} from './codex-queries';
import {
    commandCodeSessionDetailQueryOptions,
    commandCodeSessionsQueryOptions,
    commandCodeWorkspacesQueryOptions,
} from './command-code-queries';
import {
    cursorThreadDetailQueryOptions,
    cursorThreadsQueryOptions,
    cursorThreadTranscriptQueryOptions,
    cursorWorkspacesQueryOptions,
} from './cursor-queries';
import { fxSessionDetailQueryOptions, fxSessionsQueryOptions, fxWorkspacesQueryOptions } from './fx-queries';
import { grokBotChatQueryOptions, grokBotChatsQueryOptions } from './grok-bot-queries';
import { grokSessionDetailQueryOptions, grokSessionsQueryOptions, grokWorkspacesQueryOptions } from './grok-queries';
import { kiroSessionDetailQueryOptions, kiroSessionsQueryOptions, kiroWorkspacesQueryOptions } from './kiro-queries';
import {
    miniMaxCodeSessionDetailQueryOptions,
    miniMaxCodeSessionsQueryOptions,
    miniMaxCodeWorkspacesQueryOptions,
} from './minimax-code-queries';
import {
    openCodeSessionDetailQueryOptions,
    openCodeSessionsQueryOptions,
    openCodeWorkspacesQueryOptions,
} from './opencode-queries';
import {
    qoderSessionDetailQueryOptions,
    qoderSessionsQueryOptions,
    qoderWorkspacesQueryOptions,
} from './qoder-queries';
import {
    webChatArtifactsQueryOptions,
    webChatEventsQueryOptions,
    webChatQueryOptions,
    webChatsQueryOptions,
} from './web-chat-queries';

export type SourceQuerySurface = ConversationSource | 'codex-cloud' | 'web';

export type SourceQueryInvalidationTarget = {
    ids?: readonly string[];
    removeDetails?: boolean;
    scope?: 'detail' | 'mutation';
    workspaceKey?: string | null;
};

type SourceQueryBinding = {
    deferred?: (id: string) => ReadonlyArray<readonly unknown[]>;
    detail: (id: string) => readonly unknown[];
    inventory: () => readonly unknown[];
    list: (workspaceKey: string | null) => readonly unknown[];
    shared?: (workspaceKey: string | null) => ReadonlyArray<readonly unknown[]>;
};

const GLOBAL_SURFACES = new Set<SourceQuerySurface>(['grok-bot', 'web']);

const workspaceListKey = (
    list: (workspaceKey: string | null) => readonly unknown[],
    workspaceKey: string | null | undefined,
    source: SourceQuerySurface,
) => {
    if (GLOBAL_SURFACES.has(source)) {
        return [list(null)];
    }
    return typeof workspaceKey === 'string' ? [list(workspaceKey)] : [];
};

const uniqueQueryKeys = (keys: ReadonlyArray<readonly unknown[]>) => {
    const seen = new Set<string>();
    return keys.filter((key) => {
        const serialized = JSON.stringify(key);
        if (seen.has(serialized)) {
            return false;
        }
        seen.add(serialized);
        return true;
    });
};

export const SOURCE_QUERY_BINDINGS = {
    antigravity: {
        deferred: (id) => [antigravityConversationDocumentsQueryOptions(id).queryKey],
        detail: (id) => antigravityConversationDetailQueryOptions(id).queryKey,
        inventory: () => antigravityWorkspacesQueryOptions().queryKey,
        list: (workspaceKey) => antigravityConversationsQueryOptions(workspaceKey).queryKey,
        shared: () => [antigravityDecryptionQueryOptions().queryKey],
    },
    'claude-code': {
        deferred: (id) => [claudeCodeSessionTranscriptQueryOptions(id).queryKey],
        detail: (id) => claudeCodeSessionDetailQueryOptions(id).queryKey,
        inventory: () => claudeCodeWorkspacesQueryOptions().queryKey,
        list: (workspaceKey) => claudeCodeSessionsQueryOptions(workspaceKey).queryKey,
    },
    cline: {
        detail: (id) => clineTaskDetailQueryOptions(id).queryKey,
        inventory: () => clineWorkspacesQueryOptions().queryKey,
        list: (workspaceKey) => clineTasksQueryOptions(workspaceKey).queryKey,
    },
    codex: {
        deferred: (id) => [['thread-transcript-preview', id], threadTranscriptQueryOptions(id).queryKey],
        detail: (id) => threadSnapshotQueryOptions(id).queryKey,
        inventory: () => projectsQueryOptions().queryKey,
        list: (workspaceKey) => projectThreadsQueryOptions(workspaceKey ?? '').queryKey,
        shared: (workspaceKey) => [
            dashboardQueryOptions().queryKey,
            analyticsQueryOptions(workspaceKey).queryKey,
            analyticsQueryOptions(null).queryKey,
        ],
    },
    'codex-cloud': {
        detail: (id) => codexCloudTaskQueryOptions(id).queryKey,
        inventory: () => codexCloudProjectsQueryOptions().queryKey,
        list: (workspaceKey) =>
            workspaceKey ? codexCloudProjectQueryOptions(workspaceKey).queryKey : ['codex-cloud-project'],
    },
    'command-code': {
        detail: (id) => commandCodeSessionDetailQueryOptions(id).queryKey,
        inventory: () => commandCodeWorkspacesQueryOptions().queryKey,
        list: (workspaceKey) => commandCodeSessionsQueryOptions(workspaceKey).queryKey,
    },
    cursor: {
        deferred: (id) => [cursorThreadTranscriptQueryOptions(id).queryKey],
        detail: (id) => cursorThreadDetailQueryOptions(id).queryKey,
        inventory: () => cursorWorkspacesQueryOptions().queryKey,
        list: (workspaceKey) => cursorThreadsQueryOptions(workspaceKey).queryKey,
    },
    fx: {
        detail: (id) => fxSessionDetailQueryOptions(id).queryKey,
        inventory: () => fxWorkspacesQueryOptions().queryKey,
        list: (workspaceKey) => fxSessionsQueryOptions(workspaceKey).queryKey,
    },
    grok: {
        detail: (id) => grokSessionDetailQueryOptions(id).queryKey,
        inventory: () => grokWorkspacesQueryOptions().queryKey,
        list: (workspaceKey) => grokSessionsQueryOptions(workspaceKey).queryKey,
    },
    'grok-bot': {
        detail: (id) => grokBotChatQueryOptions(id).queryKey,
        inventory: () => grokBotChatsQueryOptions().queryKey,
        list: () => grokBotChatsQueryOptions().queryKey,
    },
    kiro: {
        detail: (id) => kiroSessionDetailQueryOptions(id).queryKey,
        inventory: () => kiroWorkspacesQueryOptions().queryKey,
        list: (workspaceKey) => kiroSessionsQueryOptions(workspaceKey).queryKey,
    },
    'minimax-code': {
        detail: (id) => miniMaxCodeSessionDetailQueryOptions(id).queryKey,
        inventory: () => miniMaxCodeWorkspacesQueryOptions().queryKey,
        list: (workspaceKey) => miniMaxCodeSessionsQueryOptions(workspaceKey).queryKey,
    },
    opencode: {
        detail: (id) => openCodeSessionDetailQueryOptions(id).queryKey,
        inventory: () => openCodeWorkspacesQueryOptions().queryKey,
        list: (workspaceKey) => openCodeSessionsQueryOptions(workspaceKey).queryKey,
    },
    qoder: {
        detail: (id) => qoderSessionDetailQueryOptions(id).queryKey,
        inventory: () => qoderWorkspacesQueryOptions().queryKey,
        list: (workspaceKey) => qoderSessionsQueryOptions(workspaceKey).queryKey,
    },
    web: {
        deferred: (id) => [webChatEventsQueryOptions(id).queryKey, webChatArtifactsQueryOptions(id).queryKey],
        detail: (id) => webChatQueryOptions(id).queryKey,
        inventory: () => webChatsQueryOptions().queryKey,
        list: () => webChatsQueryOptions().queryKey,
    },
} as const satisfies Record<SourceQuerySurface, SourceQueryBinding>;

export const SOURCE_QUERY_SURFACES: readonly SourceQuerySurface[] = [...CONVERSATION_SOURCES, 'codex-cloud', 'web'];

export const sourceConversationQueryKeys = (source: SourceQuerySurface, target: SourceQueryInvalidationTarget = {}) => {
    const binding: SourceQueryBinding = SOURCE_QUERY_BINDINGS[source];
    const ids = target.ids ?? [];
    const invalidate: Array<readonly unknown[]> = [];
    if (target.scope !== 'detail') {
        invalidate.push(binding.inventory(), ...workspaceListKey(binding.list, target.workspaceKey, source));
        invalidate.push(...(binding.shared?.(target.workspaceKey ?? null) ?? []));
    }
    for (const id of ids) {
        invalidate.push(binding.detail(id), ...(binding.deferred?.(id) ?? []));
    }
    const remove = ids.flatMap((id) => [binding.detail(id), ...(binding.deferred?.(id) ?? [])]);
    return { invalidate: uniqueQueryKeys(invalidate), remove: uniqueQueryKeys(remove) };
};

type QueryCacheClient = {
    invalidateQueries: (filters: { queryKey: readonly unknown[] }) => Promise<unknown>;
    removeQueries?: (filters: { queryKey: readonly unknown[] }) => void;
};

export const invalidateSourceConversationQueries = async (
    queryClient: QueryCacheClient,
    source: SourceQuerySurface,
    target: SourceQueryInvalidationTarget = {},
) => {
    const { invalidate, remove } = sourceConversationQueryKeys(source, target);
    await Promise.all(invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    if (!target.removeDetails) {
        return;
    }
    for (const queryKey of remove) {
        queryClient.removeQueries?.({ queryKey });
    }
};
