import { getExportMimeType, sanitizeExportFileName } from '@spiracha/lib/ui-export-archive';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

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
});

const toSafeExportName = (value: string) => {
    return sanitizeExportFileName(value) || 'claude-code-session';
};

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
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
        });

        if (!content) {
            throw new Error(`Claude Code session has no exportable content: ${data.sessionId}`);
        }

        return {
            content,
            fileName: `${toSafeExportName(transcript.session.title || transcript.session.sessionId)}.${data.outputFormat}`,
            mimeType: getExportMimeType(data.outputFormat),
            mode: 'download' as const,
        };
    });
