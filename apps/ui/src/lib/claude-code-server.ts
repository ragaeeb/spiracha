import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireDeletedItems, runDeleteBatch } from './delete-batch';
import { renderSourceSessionDownload, renderSourceSessionsDownload } from './source-session-export-server';

const LARGE_CLAUDE_CODE_SESSION_SIZE_BYTES = 8 * 1024 * 1024;
const CLAUDE_CODE_DETAIL_PREVIEW_ENTRY_LIMIT = 400;
const CLAUDE_CODE_DETAIL_PREVIEW_LEADING_ENTRY_LIMIT = 100;

const workspaceSchema = z.object({
    workspaceKey: z.string().min(1),
});

const sessionSchema = z.object({
    sessionId: z.string().min(1),
});

const exportSessionSchema = z.object({
    includeCommentary: z.boolean().default(true),
    includeMetadata: z.boolean().default(true),
    includeTools: z.boolean().default(true),
    outputFormat: z.enum(['md', 'txt']).default('md'),
    sessionId: z.string().min(1),
    zipArchive: z.boolean().default(false),
});

const exportSessionsSchema = z.object({
    includeCommentary: z.boolean().default(true),
    includeMetadata: z.boolean().default(true),
    includeTools: z.boolean().default(true),
    outputFormat: z.enum(['md', 'txt']).default('md'),
    sessionIds: z.array(z.string().min(1)).min(1),
    zipArchive: z.boolean().default(true),
});

const deleteSessionsSchema = z.object({
    sessionIds: z.array(z.string().min(1)).min(1),
});

export const listClaudeCodeWorkspacesFn = createServerFn({ method: 'GET' }).handler(async () => {
    const { listClaudeCodeWorkspaceGroups } = await import('@spiracha/lib/claude-code-db');
    return listClaudeCodeWorkspaceGroups();
});

export const listClaudeCodeSessionsFn = createServerFn({ method: 'GET' })
    .validator(workspaceSchema)
    .handler(async ({ data }) => {
        const { listClaudeCodeSessionsForGroup } = await import('@spiracha/lib/claude-code-db');
        return listClaudeCodeSessionsForGroup(data.workspaceKey);
    });

const loadClaudeCodeSessionTranscript = async (sessionId: string) => {
    const { runWithTranscriptLoadLimit } = await import('@spiracha/lib/transcript-load-limiter');
    const { readClaudeCodeSessionTranscript, resolveClaudeCodeProjectsDir } = await import(
        '@spiracha/lib/claude-code-db'
    );
    const projectsDir = resolveClaudeCodeProjectsDir();
    return runWithTranscriptLoadLimit(
        async () => {
            const transcript = await readClaudeCodeSessionTranscript(projectsDir, sessionId, {
                includeRawPayloads: false,
            });
            if (!transcript) {
                throw new Error(`Claude Code session not found: ${sessionId}`);
            }

            return transcript;
        },
        {
            id: sessionId,
            integration: 'claude-code',
            operation: 'ui-export',
            path: projectsDir,
        },
    );
};

export const buildClaudeCodeSessionDetailPreview = (
    transcript: Awaited<ReturnType<typeof loadClaudeCodeSessionTranscript>>,
) => {
    if (transcript.entries.length <= CLAUDE_CODE_DETAIL_PREVIEW_ENTRY_LIMIT) {
        return transcript;
    }

    const trailingEntryLimit = CLAUDE_CODE_DETAIL_PREVIEW_ENTRY_LIMIT - CLAUDE_CODE_DETAIL_PREVIEW_LEADING_ENTRY_LIMIT;
    return {
        ...transcript,
        entries: [
            ...transcript.entries.slice(0, CLAUDE_CODE_DETAIL_PREVIEW_LEADING_ENTRY_LIMIT),
            ...transcript.entries.slice(-trailingEntryLimit),
        ].map((entry) => ({
            ...entry,
            parts: entry.parts.map((part) => ({ ...part, raw: {} })),
            raw: {},
        })),
        isPartial: true,
        omittedEntryCount: transcript.entries.length - CLAUDE_CODE_DETAIL_PREVIEW_ENTRY_LIMIT,
        rawEvents: [],
        rawPayloadsOmitted: true,
    };
};

export const loadClaudeCodeSessionDetail = async (sessionId: string) => {
    const { runWithTranscriptLoadLimit } = await import('@spiracha/lib/transcript-load-limiter');
    const { readClaudeCodeSessionTranscript, resolveClaudeCodeProjectsDir } = await import(
        '@spiracha/lib/claude-code-db'
    );
    const projectsDir = resolveClaudeCodeProjectsDir();
    return runWithTranscriptLoadLimit(
        async () => {
            const transcript = await readClaudeCodeSessionTranscript(projectsDir, sessionId, {
                maxRawPayloadFileSizeBytes: LARGE_CLAUDE_CODE_SESSION_SIZE_BYTES,
            });
            if (!transcript) {
                throw new Error(`Claude Code session not found: ${sessionId}`);
            }

            return buildClaudeCodeSessionDetailPreview(transcript);
        },
        {
            id: sessionId,
            integration: 'claude-code',
            operation: 'ui-detail',
            path: projectsDir,
        },
    );
};

export const loadClaudeCodeSessionFullDetail = async (sessionId: string) => {
    const { runWithTranscriptLoadLimit } = await import('@spiracha/lib/transcript-load-limiter');
    const { readClaudeCodeSessionTranscript, resolveClaudeCodeProjectsDir } = await import(
        '@spiracha/lib/claude-code-db'
    );
    const projectsDir = resolveClaudeCodeProjectsDir();
    return runWithTranscriptLoadLimit(
        async () => {
            const transcript = await readClaudeCodeSessionTranscript(projectsDir, sessionId, {
                includeRawPayloads: false,
            });
            if (!transcript) {
                throw new Error(`Claude Code session not found: ${sessionId}`);
            }
            return transcript;
        },
        {
            id: sessionId,
            integration: 'claude-code',
            operation: 'ui-full-detail',
            path: projectsDir,
        },
    );
};

export const getClaudeCodeSessionDetailFn = createServerFn({ method: 'GET' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        return loadClaudeCodeSessionDetail(data.sessionId);
    });

export const getClaudeCodeSessionTranscriptFn = createServerFn({ method: 'GET' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        return loadClaudeCodeSessionFullDetail(data.sessionId);
    });

export const exportClaudeCodeSessionFn = createServerFn({ method: 'POST' })
    .validator(exportSessionSchema)
    .handler(async ({ data }) => {
        const { renderClaudeCodeTranscript } = await import('@spiracha/lib/claude-code-transcript');
        const transcript = await loadClaudeCodeSessionTranscript(data.sessionId);
        const content = renderClaudeCodeTranscript(transcript, {
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
        });

        if (!content) {
            throw new Error(`Claude Code session has no exportable content: ${data.sessionId}`);
        }

        return renderSourceSessionDownload({
            content,
            cwd: transcript.session.cwd ?? transcript.session.worktree,
            fallbackBaseName: 'claude-code-session',
            outputFormat: data.outputFormat,
            sessionId: transcript.session.sessionId,
            updatedAtMs: transcript.session.lastActiveAtMs,
            zipArchive: data.zipArchive,
        });
    });

export const exportClaudeCodeSessionsFn = createServerFn({ method: 'POST' })
    .validator(exportSessionsSchema)
    .handler(async ({ data }) => {
        const { renderClaudeCodeTranscript } = await import('@spiracha/lib/claude-code-transcript');
        const entries = await Promise.all(
            data.sessionIds.map(async (sessionId) => {
                const transcript = await loadClaudeCodeSessionTranscript(sessionId);
                const content = renderClaudeCodeTranscript(transcript, {
                    includeCommentary: data.includeCommentary,
                    includeMetadata: data.includeMetadata,
                    includeTools: data.includeTools,
                    outputFormat: data.outputFormat,
                });

                if (!content) {
                    throw new Error(`Claude Code session has no exportable content: ${sessionId}`);
                }

                return {
                    content,
                    cwd: transcript.session.cwd ?? transcript.session.worktree,
                    fallbackBaseName: 'claude-code-session',
                    fileBaseName: transcript.session.title || transcript.session.sessionId,
                    sessionId: transcript.session.sessionId,
                    updatedAtMs: transcript.session.lastActiveAtMs,
                };
            }),
        );

        return renderSourceSessionsDownload({
            entries,
            fallbackBaseName: 'claude-code-sessions',
            outputFormat: data.outputFormat,
            zipArchive: data.zipArchive,
        });
    });

export const deleteClaudeCodeSessionFn = createServerFn({ method: 'POST' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        const { deleteClaudeCodeSession, resolveClaudeCodeProjectsDir } = await import('@spiracha/lib/claude-code-db');
        const result = await deleteClaudeCodeSession(resolveClaudeCodeProjectsDir(), data.sessionId);
        requireDeletedItems(result.deletedSessionIds, 'Claude Code session', data.sessionId);
        return result;
    });

export const deleteClaudeCodeSessionsFn = createServerFn({ method: 'POST' })
    .validator(deleteSessionsSchema)
    .handler(async ({ data }) => {
        const { deleteClaudeCodeSession, resolveClaudeCodeProjectsDir } = await import('@spiracha/lib/claude-code-db');
        const projectsDir = resolveClaudeCodeProjectsDir();
        const results = await runDeleteBatch(data.sessionIds, (sessionId) =>
            deleteClaudeCodeSession(projectsDir, sessionId),
        );
        requireDeletedItems(
            results.flatMap((result) => result.deletedSessionIds),
            'Claude Code sessions',
            'batch',
        );
        return {
            deletedFiles: [...new Set(results.flatMap((result) => result.deletedFiles))],
            deletedSessionIds: [...new Set(results.flatMap((result) => result.deletedSessionIds))],
        };
    });
