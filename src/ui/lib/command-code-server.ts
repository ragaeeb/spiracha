import type { CommandCodeSessionTranscript } from '@spiracha/lib/command-code-exporter-types';
import type { ConversationMessage } from '@spiracha/lib/conversation-data/types';
import type { JsonValue } from '@spiracha/lib/shared-text';
import { createServerFn } from '@tanstack/react-start';
import { array, boolean, minLength, object, optional, picklist, pipe, regex, string } from 'valibot';
import { requireDeletedItems, runDeleteBatch } from './delete-batch';

type SerializableCommandCodeTranscript = Omit<CommandCodeSessionTranscript, 'messages' | 'rawRecords'> & {
    messages: Array<Omit<ConversationMessage, 'metadata'> & { metadata: Record<string, JsonValue> }>;
    rawRecords: Array<Record<string, JsonValue>>;
};

const toSerializableTranscript = (transcript: CommandCodeSessionTranscript): SerializableCommandCodeTranscript =>
    JSON.parse(
        JSON.stringify({
            messages: transcript.messages,
            rawRecords: transcript.rawRecords,
            session: transcript.session,
        }),
    ) as SerializableCommandCodeTranscript;

const workspaceSchema = object({
    workspaceKey: pipe(string(), minLength(1)),
});

const sessionSchema = object({
    sessionId: pipe(string(), minLength(1), regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u)),
});

const exportSessionSchema = object({
    includeCommentary: optional(boolean(), true),
    includeMetadata: optional(boolean(), true),
    includeTools: optional(boolean(), true),
    outputFormat: optional(picklist(['md', 'txt']), 'md'),
    sessionId: pipe(string(), minLength(1), regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u)),
    zipArchive: optional(boolean(), false),
});

const exportSessionsSchema = object({
    includeCommentary: optional(boolean(), true),
    includeMetadata: optional(boolean(), true),
    includeTools: optional(boolean(), true),
    outputFormat: optional(picklist(['md', 'txt']), 'md'),
    sessionIds: pipe(array(pipe(string(), minLength(1))), minLength(1)),
    zipArchive: optional(boolean(), true),
});

const deleteSessionsSchema = object({
    sessionIds: pipe(array(pipe(string(), minLength(1))), minLength(1)),
});

export const listCommandCodeWorkspacesFn = createServerFn({ method: 'GET' }).handler(async () => {
    const { listCommandCodeWorkspaceGroups } = await import('@spiracha/lib/command-code-db');
    return listCommandCodeWorkspaceGroups();
});

export const listCommandCodeSessionsFn = createServerFn({ method: 'GET' })
    .validator(workspaceSchema)
    .handler(async ({ data }) => {
        const { listCommandCodeSessionSummariesForWorkspace, resolveCommandCodeProjectsDir } = await import(
            '@spiracha/lib/command-code-db'
        );
        return listCommandCodeSessionSummariesForWorkspace(resolveCommandCodeProjectsDir(), data.workspaceKey);
    });

const loadCommandCodeSessionTranscript = async (sessionId: string) => {
    const { runWithTranscriptLoadLimit } = await import('@spiracha/lib/transcript-load-limiter');
    const { readCommandCodeSessionTranscript, resolveCommandCodeProjectsDir } = await import(
        '@spiracha/lib/command-code-db'
    );
    const projectsDir = resolveCommandCodeProjectsDir();
    return runWithTranscriptLoadLimit(
        async () => {
            const transcript = await readCommandCodeSessionTranscript(projectsDir, sessionId);
            if (!transcript) {
                throw new Error(`Command Code session not found: ${sessionId}`);
            }
            return toSerializableTranscript(transcript);
        },
        {
            id: sessionId,
            integration: 'command-code',
            operation: 'ui-detail',
            path: projectsDir,
        },
    );
};

export const getCommandCodeSessionDetailFn = createServerFn({ method: 'GET' })
    .validator(sessionSchema)
    .handler(async ({ data }) => loadCommandCodeSessionTranscript(data.sessionId));

export const exportCommandCodeSessionFn = createServerFn({ method: 'POST' })
    .validator(exportSessionSchema)
    .handler(async ({ data }) => {
        const { renderCommandCodeTranscript } = await import('@spiracha/lib/command-code-transcript');
        const { renderSourceSessionDownload } = await import('./source-session-export-server');
        const transcript = await loadCommandCodeSessionTranscript(data.sessionId);
        const content = renderCommandCodeTranscript(transcript, {
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
        });
        if (!content) {
            throw new Error(`Command Code session has no exportable content: ${data.sessionId}`);
        }

        return renderSourceSessionDownload({
            content,
            cwd: transcript.session.worktree,
            fallbackBaseName: 'command-code-session',
            outputFormat: data.outputFormat,
            platform: 'command-code',
            sessionId: transcript.session.sessionId,
            updatedAtMs: transcript.session.lastActiveAtMs,
            zipArchive: data.zipArchive,
        });
    });

export const exportCommandCodeSessionsFn = createServerFn({ method: 'POST' })
    .validator(exportSessionsSchema)
    .handler(async ({ data }) => {
        const { renderCommandCodeTranscript } = await import('@spiracha/lib/command-code-transcript');
        const { renderSourceSessionsDownload } = await import('./source-session-export-server');
        const entries = await Promise.all(
            data.sessionIds.map(async (sessionId) => {
                const transcript = await loadCommandCodeSessionTranscript(sessionId);
                const content = renderCommandCodeTranscript(transcript, {
                    includeCommentary: data.includeCommentary,
                    includeMetadata: data.includeMetadata,
                    includeTools: data.includeTools,
                    outputFormat: data.outputFormat,
                });
                if (!content) {
                    throw new Error(`Command Code session has no exportable content: ${sessionId}`);
                }

                return {
                    content,
                    cwd: transcript.session.worktree,
                    fallbackBaseName: 'command-code-session',
                    fileBaseName: transcript.session.title || transcript.session.sessionId,
                    sessionId: transcript.session.sessionId,
                    updatedAtMs: transcript.session.lastActiveAtMs,
                };
            }),
        );

        return renderSourceSessionsDownload({
            entries,
            fallbackBaseName: 'command-code-sessions',
            outputFormat: data.outputFormat,
            platform: 'command-code',
            zipArchive: data.zipArchive,
        });
    });

export const deleteCommandCodeSessionFn = createServerFn({ method: 'POST' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        const { deleteCommandCodeSession, resolveCommandCodeProjectsDir } = await import(
            '@spiracha/lib/command-code-db'
        );
        const result = await deleteCommandCodeSession(resolveCommandCodeProjectsDir(), data.sessionId);
        requireDeletedItems(result.deletedSessionIds, 'Command Code session', data.sessionId);
        return result;
    });

export const deleteCommandCodeSessionsFn = createServerFn({ method: 'POST' })
    .validator(deleteSessionsSchema)
    .handler(async ({ data }) => {
        const { deleteCommandCodeSession, resolveCommandCodeProjectsDir } = await import(
            '@spiracha/lib/command-code-db'
        );
        const projectsDir = resolveCommandCodeProjectsDir();
        const results = await runDeleteBatch(data.sessionIds, (sessionId) =>
            deleteCommandCodeSession(projectsDir, sessionId),
        );
        requireDeletedItems(
            results.flatMap((result) => result.deletedSessionIds),
            'Command Code sessions',
            'batch',
        );
        return {
            deletedFiles: [...new Set(results.flatMap((result) => result.deletedFiles))],
            deletedSessionIds: [...new Set(results.flatMap((result) => result.deletedSessionIds))],
        };
    });
