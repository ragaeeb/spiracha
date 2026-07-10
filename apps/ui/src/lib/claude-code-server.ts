import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { renderSourceSessionDownload, renderSourceSessionsDownload } from './source-session-export-server';

const LARGE_CLAUDE_CODE_SESSION_SIZE_BYTES = 8 * 1024 * 1024;

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
            const transcript = await readClaudeCodeSessionTranscript(projectsDir, sessionId);
            if (!transcript) {
                throw new Error(`Claude Code session not found: ${sessionId}`);
            }

            return transcript;
        },
        {
            id: sessionId,
            path: projectsDir,
            source: 'claude-code-ui',
        },
    );
};

const loadClaudeCodeSessionDetail = async (sessionId: string) => {
    const { runWithTranscriptLoadLimit } = await import('@spiracha/lib/transcript-load-limiter');
    const { stat } = await import('node:fs/promises');
    const { readClaudeCodeSessionTranscript, resolveClaudeCodeProjectsDir } = await import(
        '@spiracha/lib/claude-code-db'
    );
    const projectsDir = resolveClaudeCodeProjectsDir();
    return runWithTranscriptLoadLimit(
        async () => {
            const fullTranscript = await readClaudeCodeSessionTranscript(projectsDir, sessionId, {
                includeRawPayloads: false,
            });
            if (!fullTranscript) {
                throw new Error(`Claude Code session not found: ${sessionId}`);
            }

            const fileSizeBytes = await stat(fullTranscript.session.filePath)
                .then((stats) => stats.size)
                .catch(() => LARGE_CLAUDE_CODE_SESSION_SIZE_BYTES + 1);

            if (fileSizeBytes > LARGE_CLAUDE_CODE_SESSION_SIZE_BYTES) {
                return fullTranscript;
            }

            return (await readClaudeCodeSessionTranscript(projectsDir, sessionId)) ?? fullTranscript;
        },
        {
            id: sessionId,
            path: projectsDir,
            source: 'claude-code-ui-detail',
        },
    );
};

export const getClaudeCodeSessionDetailFn = createServerFn({ method: 'GET' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        return loadClaudeCodeSessionDetail(data.sessionId);
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
            fallbackBaseName: 'claude-code-session',
            fileBaseName: transcript.session.title || transcript.session.sessionId,
            outputFormat: data.outputFormat,
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
                    fallbackBaseName: 'claude-code-session',
                    fileBaseName: transcript.session.title || transcript.session.sessionId,
                };
            }),
        );

        return renderSourceSessionsDownload({
            entries,
            exportBaseName: `claude-code-sessions-${data.sessionIds.length}`,
            fallbackBaseName: 'claude-code-sessions',
            outputFormat: data.outputFormat,
            zipArchive: data.zipArchive,
        });
    });

export const deleteClaudeCodeSessionFn = createServerFn({ method: 'POST' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        const { deleteClaudeCodeSession, resolveClaudeCodeProjectsDir } = await import('@spiracha/lib/claude-code-db');
        return deleteClaudeCodeSession(resolveClaudeCodeProjectsDir(), data.sessionId);
    });

export const deleteClaudeCodeSessionsFn = createServerFn({ method: 'POST' })
    .validator(deleteSessionsSchema)
    .handler(async ({ data }) => {
        const { deleteClaudeCodeSession, resolveClaudeCodeProjectsDir } = await import('@spiracha/lib/claude-code-db');
        const projectsDir = resolveClaudeCodeProjectsDir();
        return Promise.all(data.sessionIds.map((sessionId) => deleteClaudeCodeSession(projectsDir, sessionId)));
    });
