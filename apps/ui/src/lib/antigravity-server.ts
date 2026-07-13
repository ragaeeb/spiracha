import { buildConversationExportBaseName } from '@spiracha/lib/ui-export-archive';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { canExportAntigravityConversation, isAntigravityConversationLocked } from './antigravity-conversation-state';
import { renderSourceSessionsDownload } from './source-session-export-server';

const workspaceSchema = z.object({
    workspaceKey: z.string().min(1),
});

const conversationSchema = z.object({
    conversationId: z.string().min(1),
});

const exportSchema = z.object({
    conversationId: z.string().min(1),
});

const exportConversationsSchema = z.object({
    conversationIds: z.array(z.string().min(1)).min(1),
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
    const [conversationMarkdown, artifactsMarkdown] = await runWithTranscriptLoadLimit(
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
    );

    return {
        artifactsMarkdown,
        conversation,
        // Suppress the duplicate panel when artifactsMarkdown and conversationMarkdown are identical.
        conversationMarkdown: conversationMarkdown === artifactsMarkdown ? null : conversationMarkdown,
        transcriptLocked,
    };
};

export const loadAntigravityConversationExport = async (conversationId: string) => {
    const { runWithTranscriptLoadLimit } = await import('@spiracha/lib/transcript-load-limiter');
    const { renderAntigravityConversationMarkdown } = await import('@spiracha/lib/antigravity-db');
    const { getCachedAntigravityKeychainSecret } = await import('@spiracha/lib/antigravity-keychain');
    const conversation = await findAntigravityConversationById(conversationId);
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
                keychainSecret,
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
        )}.md`,
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
    const results = await Promise.all(
        conversationIds.map((conversationId) => deleteAntigravityConversation(roots, conversationId)),
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
    .validator(exportSchema)
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
        return loadAntigravityConversationExport(data.conversationId);
    });

export const exportAntigravityConversationsFn = createServerFn({ method: 'POST' })
    .validator(exportConversationsSchema)
    .handler(async ({ data }) => {
        const entries = await Promise.all(
            data.conversationIds.map(async (conversationId) => {
                const result = await loadAntigravityConversationExport(conversationId);
                return {
                    content: result.content,
                    cwd: result.conversation.workspaceFolder,
                    fallbackBaseName: 'antigravity-conversation',
                    fileBaseName: result.filename.replace(/\.(?:md|txt)$/u, ''),
                    sessionId: result.conversation.conversationId,
                    updatedAtMs: result.conversation.lastUpdatedAtMs ?? result.conversation.conversationMtimeMs,
                };
            }),
        );

        return renderSourceSessionsDownload({
            entries,
            fallbackBaseName: 'antigravity-conversations',
            outputFormat: data.outputFormat,
            zipArchive: data.zipArchive,
        });
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
