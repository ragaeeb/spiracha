import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { renderSourceSessionDownload } from './source-session-export-server';

const workspaceSchema = z.object({
    workspaceKey: z.string().min(1),
});

const sessionSchema = z.object({
    sessionId: z.string().min(1),
});

const exportSessionSchema = z.object({
    headroomArchiveDir: z.string().optional(),
    includeCommentary: z.boolean().default(true),
    includeMetadata: z.boolean().default(true),
    includeTools: z.boolean().default(true),
    outputFormat: z.enum(['md', 'txt']).default('md'),
    rehydrateHeadroom: z.boolean().optional(),
    sessionId: z.string().min(1),
    zipArchive: z.boolean().default(false),
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
    const { readClaudeCodeSessionTranscript, resolveClaudeCodeProjectsDir } = await import(
        '@spiracha/lib/claude-code-db'
    );
    const transcript = await readClaudeCodeSessionTranscript(resolveClaudeCodeProjectsDir(), sessionId);
    if (!transcript) {
        throw new Error(`Claude Code session not found: ${sessionId}`);
    }

    return transcript;
};

export const getClaudeCodeSessionDetailFn = createServerFn({ method: 'GET' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        return loadClaudeCodeSessionTranscript(data.sessionId);
    });

export const exportClaudeCodeSessionFn = createServerFn({ method: 'POST' })
    .validator(exportSessionSchema)
    .handler(async ({ data }) => {
        const { renderClaudeCodeTranscript } = await import('@spiracha/lib/claude-code-transcript');
        const transcript = await loadClaudeCodeSessionTranscript(data.sessionId);
        const content = renderClaudeCodeTranscript(transcript, {
            archiveDir: data.headroomArchiveDir,
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
            rehydrateHeadroom: data.rehydrateHeadroom,
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

export const deleteClaudeCodeSessionFn = createServerFn({ method: 'POST' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        const { deleteClaudeCodeSession, resolveClaudeCodeProjectsDir } = await import('@spiracha/lib/claude-code-db');
        return deleteClaudeCodeSession(resolveClaudeCodeProjectsDir(), data.sessionId);
    });
