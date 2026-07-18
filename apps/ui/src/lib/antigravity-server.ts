import type { AntigravityConversation } from '@spiracha/lib/antigravity-exporter-types';
import { buildConversationExportBaseName } from '@spiracha/lib/ui-export-archive';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { canExportAntigravityConversation, isAntigravityConversationLocked } from './antigravity-conversation-state';
import { runDeleteBatch } from './delete-batch';

const workspaceSchema = z.object({
    workspaceKey: z.string().min(1),
});

const conversationSchema = z.object({
    conversationId: z.string().min(1),
});

const exportSchema = z.object({
    conversationId: z.string().min(1),
    includeCommentary: z.boolean().default(false),
    includeMetadata: z.boolean().default(true),
    includeTools: z.boolean().default(true),
    outputFormat: z.enum(['md', 'txt']).default('md'),
    zipArchive: z.boolean().default(false),
});

const exportConversationsSchema = z.object({
    conversationIds: z.array(z.string().min(1)).min(1),
    includeCommentary: z.boolean().default(false),
    includeMetadata: z.boolean().default(true),
    includeTools: z.boolean().default(true),
    outputFormat: z.enum(['md', 'txt']).default('md'),
    zipArchive: z.boolean().default(true),
});

const deleteConversationsSchema = z.object({
    conversationIds: z.array(z.string().min(1)).min(1),
});

export const listAntigravityWorkspacesFn = createServerFn({ method: 'GET' }).handler(async () => {
    const { listAntigravityWorkspaceGroups } = await import('@spiracha/lib/antigravity-db');
    return listAntigravityWorkspaceGroups();
});

export const getAntigravityDecryptionStateFn = createServerFn({ method: 'GET' }).handler(async () => {
    const { getAntigravityDecryptionState } = await import('@spiracha/lib/antigravity-keychain');
    return getAntigravityDecryptionState();
});

export const unlockAntigravityDecryptionFn = createServerFn({ method: 'POST' }).handler(async () => {
    const { unlockAntigravityDecryption } = await import('@spiracha/lib/antigravity-keychain');
    return unlockAntigravityDecryption();
});

export const listAntigravityConversationsFn = createServerFn({ method: 'GET' })
    .validator(workspaceSchema)
    .handler(async ({ data }) => {
        const { listAntigravityConversationsForGroup } = await import('@spiracha/lib/antigravity-db');
        return listAntigravityConversationsForGroup(data.workspaceKey);
    });

const findAntigravityConversationById = async (conversationId: string) => {
    const { listAntigravityConversations } = await import('@spiracha/lib/antigravity-db');
    const conversation = (await listAntigravityConversations()).find(
        (candidate) => candidate.conversationId === conversationId,
    );
    if (!conversation) {
        throw new Error(`Antigravity conversation not found: ${conversationId}`);
    }

    return conversation;
};

const resolveAntigravityConversationGroup = async (
    conversation: Awaited<ReturnType<typeof findAntigravityConversationById>>,
) => {
    const fallback = {
        key: conversation.projectId ? `project:${conversation.projectId}` : conversation.workspaceKey,
        label: conversation.workspaceLabel,
    };
    if (!conversation.projectId) {
        return fallback;
    }

    const { listAntigravityWorkspaceGroups } = await import('@spiracha/lib/antigravity-db');
    const group = (await listAntigravityWorkspaceGroups()).find((candidate) => candidate.key === fallback.key);
    return group ? { key: group.key, label: group.label } : fallback;
};

export const loadAntigravityConversationDetail = async (conversationId: string) => {
    const { runWithTranscriptLoadLimit } = await import('@spiracha/lib/transcript-load-limiter');
    const { renderAntigravityArtifactsMarkdown, renderAntigravityConversationMarkdown } = await import(
        '@spiracha/lib/antigravity-db'
    );
    const { getCachedAntigravityKeychainSecret } = await import('@spiracha/lib/antigravity-keychain');
    const conversation = await findAntigravityConversationById(conversationId);
    const keychainSecret = getCachedAntigravityKeychainSecret();
    const hasKeychainSecret = Boolean(keychainSecret);
    const transcriptLocked = isAntigravityConversationLocked(conversation, hasKeychainSecret);
    const [[conversationMarkdown, artifactsMarkdown], conversationGroup] = await Promise.all([
        runWithTranscriptLoadLimit(
            async () =>
                Promise.all([
                    transcriptLocked ? null : renderAntigravityConversationMarkdown(conversation, { keychainSecret }),
                    conversation.artifactCount > 0 ? renderAntigravityArtifactsMarkdown(conversation) : null,
                ]),
            {
                id: conversation.conversationId,
                path: conversation.transcriptPath ?? conversation.conversationPath ?? undefined,
                source: 'antigravity-ui-detail',
            },
        ),
        resolveAntigravityConversationGroup(conversation),
    ]);

    return {
        artifactsMarkdown,
        conversation,
        conversationGroup,
        // Suppress the duplicate panel when artifactsMarkdown and conversationMarkdown are identical.
        conversationMarkdown: conversationMarkdown === artifactsMarkdown ? null : conversationMarkdown,
        transcriptLocked,
    };
};

type AntigravityConversationExportOptions = {
    includeCommentary?: boolean;
    includeMetadata?: boolean;
    includeTools?: boolean;
    outputFormat?: 'md' | 'txt';
};

export const loadAntigravityConversationExport = async (
    conversationId: string,
    options: AntigravityConversationExportOptions = {},
    loadedConversation?: AntigravityConversation,
) => {
    const { runWithTranscriptLoadLimit } = await import('@spiracha/lib/transcript-load-limiter');
    const { renderAntigravityConversationMarkdown } = await import('@spiracha/lib/antigravity-db');
    const { getCachedAntigravityKeychainSecret } = await import('@spiracha/lib/antigravity-keychain');
    const conversation = loadedConversation ?? (await findAntigravityConversationById(conversationId));
    const keychainSecret = getCachedAntigravityKeychainSecret();
    const hasKeychainSecret = Boolean(keychainSecret);

    if (!canExportAntigravityConversation(conversation, hasKeychainSecret)) {
        if (isAntigravityConversationLocked(conversation, hasKeychainSecret)) {
            throw new Error('Unlock Antigravity Keychain access before exporting transcript logs.');
        }

        throw new Error(`No exportable Antigravity transcript found for conversation: ${conversationId}`);
    }

    const content = await runWithTranscriptLoadLimit(
        () =>
            renderAntigravityConversationMarkdown(conversation, {
                includeCommentary: options.includeCommentary,
                includeMetadata: options.includeMetadata,
                includeTools: options.includeTools,
                keychainSecret,
                outputFormat: options.outputFormat,
            }),
        {
            id: conversation.conversationId,
            path: conversation.transcriptPath ?? conversation.conversationPath ?? undefined,
            source: 'antigravity-ui-export',
        },
    );
    if (!content) {
        throw new Error(`No exportable Antigravity transcript found for conversation: ${conversationId}`);
    }

    return {
        content,
        conversation,
        filename: `${buildConversationExportBaseName(
            {
                cwd: conversation.workspaceFolder,
                id: conversation.conversationId,
                updatedAtMs: conversation.lastUpdatedAtMs ?? conversation.conversationMtimeMs,
            },
            'antigravity-conversation',
        )}.${options.outputFormat ?? 'md'}`,
    };
};

export const deleteAntigravityConversationById = async (conversationId: string) => {
    const { deleteAntigravityConversation } = await import('@spiracha/lib/antigravity-db');
    const { resolveAntigravityRoots } = await import('@spiracha/lib/antigravity-exporter-types');
    const result = await deleteAntigravityConversation(resolveAntigravityRoots(), conversationId);
    if (result.deletedConversationIds.length === 0) {
        throw new Error(`Antigravity conversation not found: ${conversationId}`);
    }

    return result;
};

export const deleteAntigravityConversationsById = async (conversationIds: string[]) => {
    const { deleteAntigravityConversation } = await import('@spiracha/lib/antigravity-db');
    const { resolveAntigravityRoots } = await import('@spiracha/lib/antigravity-exporter-types');
    const roots = resolveAntigravityRoots();
    const results = await runDeleteBatch(conversationIds, (conversationId) =>
        deleteAntigravityConversation(roots, conversationId),
    );
    const deletedConversationIds = results.flatMap((result) => result.deletedConversationIds);
    if (deletedConversationIds.length === 0) {
        throw new Error('No Antigravity conversations were deleted');
    }

    return {
        deletedConversationIds,
        deletedPaths: results.flatMap((result) => result.deletedPaths),
    };
};

export const getAntigravityConversationDetailFn = createServerFn({ method: 'GET' })
    .validator(conversationSchema)
    .handler(async ({ data }) => {
        return loadAntigravityConversationDetail(data.conversationId);
    });

export const exportAntigravityArtifactsFn = createServerFn({ method: 'POST' })
    .validator(conversationSchema)
    .handler(async ({ data }) => {
        const { renderAntigravityArtifactsMarkdown } = await import('@spiracha/lib/antigravity-db');
        const conversation = await findAntigravityConversationById(data.conversationId);

        const content = await renderAntigravityArtifactsMarkdown(conversation);
        if (!content) {
            throw new Error(`No Markdown artifacts found for conversation: ${data.conversationId}`);
        }

        return {
            content,
            filename: `${data.conversationId}-artifacts.md`,
        };
    });

export const exportAntigravityConversationFn = createServerFn({ method: 'POST' })
    .validator(exportSchema)
    .handler(async ({ data }) => {
        return exportAntigravityConversations({
            conversationIds: [data.conversationId],
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
            zipArchive: data.zipArchive,
        });
    });

export const exportAntigravityConversations = async (input: z.input<typeof exportConversationsSchema>) => {
    const data = exportConversationsSchema.parse(input);
    const { renderSourceSessionsDownload } = await import('./source-session-export-server');
    const { listAntigravityConversations, listAntigravityWorkspaceGroups } = await import(
        '@spiracha/lib/antigravity-db'
    );
    const [groups, conversations] = await Promise.all([
        listAntigravityWorkspaceGroups(),
        listAntigravityConversations(),
    ]);
    const groupsByKey = new Map(groups.map((group) => [group.key, group]));
    const conversationsById = new Map(conversations.map((conversation) => [conversation.conversationId, conversation]));
    const entries = await Promise.all(
        data.conversationIds.map(async (conversationId) => {
            const loadedConversation = conversationsById.get(conversationId);
            if (!loadedConversation) {
                throw new Error(`Antigravity conversation not found: ${conversationId}`);
            }
            const result = await loadAntigravityConversationExport(
                conversationId,
                {
                    includeCommentary: data.includeCommentary,
                    includeMetadata: data.includeMetadata,
                    includeTools: data.includeTools,
                    outputFormat: data.outputFormat,
                },
                loadedConversation,
            );
            const conversation = result.conversation;
            const projectGroup = conversation.projectId
                ? groupsByKey.get(`project:${conversation.projectId}`)
                : undefined;
            const exportCwd = projectGroup?.label ?? conversation.workspaceFolder;
            const updatedAtMs = conversation.lastUpdatedAtMs ?? conversation.conversationMtimeMs;
            return {
                content: result.content,
                cwd: exportCwd,
                fallbackBaseName: 'antigravity-conversation',
                fileBaseName: buildConversationExportBaseName(
                    {
                        cwd: exportCwd,
                        id: conversation.conversationId,
                        updatedAtMs,
                    },
                    'antigravity-conversation',
                ),
                sessionId: conversation.conversationId,
                updatedAtMs,
            };
        }),
    );

    return renderSourceSessionsDownload({
        entries,
        fallbackBaseName: 'antigravity-conversations',
        outputFormat: data.outputFormat,
        zipArchive: data.zipArchive,
    });
};

export const exportAntigravityConversationsFn = createServerFn({ method: 'POST' })
    .validator(exportConversationsSchema)
    .handler(async ({ data }) => {
        return exportAntigravityConversations(data);
    });

export const deleteAntigravityConversationFn = createServerFn({ method: 'POST' })
    .validator(conversationSchema)
    .handler(async ({ data }) => {
        return deleteAntigravityConversationById(data.conversationId);
    });

export const deleteAntigravityConversationsFn = createServerFn({ method: 'POST' })
    .validator(deleteConversationsSchema)
    .handler(async ({ data }) => {
        return deleteAntigravityConversationsById(data.conversationIds);
    });
