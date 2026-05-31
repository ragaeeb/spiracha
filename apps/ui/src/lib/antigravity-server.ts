import {
    listAntigravityConversations,
    listAntigravityConversationsForGroup,
    listAntigravityWorkspaceGroups,
    renderAntigravityArtifactsMarkdown,
    renderAntigravityConversationMarkdown,
} from '@spiracha/lib/antigravity-db';
import {
    getAntigravityDecryptionState,
    getCachedAntigravityKeychainSecret,
    unlockAntigravityDecryption,
} from '@spiracha/lib/antigravity-keychain';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

const workspaceSchema = z.object({
    workspaceKey: z.string().min(1),
});

const exportSchema = z.object({
    conversationId: z.string().min(1),
});

export const listAntigravityWorkspacesFn = createServerFn({ method: 'GET' }).handler(async () => {
    return listAntigravityWorkspaceGroups();
});

export const getAntigravityDecryptionStateFn = createServerFn({ method: 'GET' }).handler(async () => {
    return getAntigravityDecryptionState();
});

export const unlockAntigravityDecryptionFn = createServerFn({ method: 'POST' }).handler(async () => {
    return unlockAntigravityDecryption();
});

export const listAntigravityConversationsFn = createServerFn({ method: 'GET' })
    .inputValidator(workspaceSchema)
    .handler(async ({ data }) => {
        return listAntigravityConversationsForGroup(data.workspaceKey);
    });

export const exportAntigravityArtifactsFn = createServerFn({ method: 'POST' })
    .inputValidator(exportSchema)
    .handler(async ({ data }) => {
        const conversation = (await listAntigravityConversations()).find(
            (candidate) => candidate.conversationId === data.conversationId,
        );
        if (!conversation) {
            throw new Error(`Antigravity conversation not found: ${data.conversationId}`);
        }

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
        const conversation = (await listAntigravityConversations()).find(
            (candidate) => candidate.conversationId === data.conversationId,
        );
        if (!conversation) {
            throw new Error(`Antigravity conversation not found: ${data.conversationId}`);
        }

        const keychainSecret = getCachedAntigravityKeychainSecret();
        if (conversation.transcriptEntryCount > 0 && !keychainSecret) {
            throw new Error('Unlock Antigravity Keychain access before exporting transcript logs.');
        }

        const content = await renderAntigravityConversationMarkdown(conversation, { keychainSecret });
        if (!content) {
            throw new Error(`No exportable Antigravity transcript found for conversation: ${data.conversationId}`);
        }

        return {
            content,
            filename: `${data.conversationId}.md`,
        };
    });
