import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { canExportAntigravityConversation, isAntigravityConversationLocked } from './antigravity-conversation-state';

const workspaceSchema = z.object({
    workspaceKey: z.string().min(1),
});

const conversationSchema = z.object({
    conversationId: z.string().min(1),
});

const exportSchema = z.object({
    conversationId: z.string().min(1),
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
    .inputValidator(workspaceSchema)
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
    const { renderAntigravityArtifactsMarkdown, renderAntigravityConversationMarkdown } = await import(
        '@spiracha/lib/antigravity-db'
    );
    const { getCachedAntigravityKeychainSecret } = await import('@spiracha/lib/antigravity-keychain');
    const conversation = await findAntigravityConversationById(conversationId);
    const keychainSecret = getCachedAntigravityKeychainSecret();
    const hasKeychainSecret = Boolean(keychainSecret);
    const transcriptLocked = isAntigravityConversationLocked(conversation, hasKeychainSecret);
    const conversationMarkdown = transcriptLocked
        ? null
        : await renderAntigravityConversationMarkdown(conversation, { keychainSecret });
    const artifactsMarkdown =
        conversation.artifactCount > 0 ? await renderAntigravityArtifactsMarkdown(conversation) : null;

    return {
        artifactsMarkdown,
        conversation,
        // Suppress the duplicate panel when artifactsMarkdown and conversationMarkdown are identical.
        conversationMarkdown: conversationMarkdown === artifactsMarkdown ? null : conversationMarkdown,
        transcriptLocked,
    };
};

export const loadAntigravityConversationExport = async (conversationId: string) => {
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

    const content = await renderAntigravityConversationMarkdown(conversation, { keychainSecret });
    if (!content) {
        throw new Error(`No exportable Antigravity transcript found for conversation: ${conversationId}`);
    }

    return {
        content,
        filename: `${conversationId}.md`,
    };
};

export const getAntigravityConversationDetailFn = createServerFn({ method: 'GET' })
    .inputValidator(conversationSchema)
    .handler(async ({ data }) => {
        return loadAntigravityConversationDetail(data.conversationId);
    });

export const exportAntigravityArtifactsFn = createServerFn({ method: 'POST' })
    .inputValidator(exportSchema)
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
    .inputValidator(exportSchema)
    .handler(async ({ data }) => {
        return loadAntigravityConversationExport(data.conversationId);
    });
