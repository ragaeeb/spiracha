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
    includeCommentary: z.boolean().default(true),
    includeMetadata: z.boolean().default(true),
    includeTools: z.boolean().default(true),
    outputFormat: z.enum(['md', 'txt']).default('md'),
    sessionId: z.string().min(1),
    zipArchive: z.boolean().default(false),
});

export const listQoderWorkspacesFn = createServerFn({ method: 'GET' }).handler(async () => {
    const { listQoderWorkspaceGroups } = await import('@spiracha/lib/qoder-db');
    return listQoderWorkspaceGroups();
});

export const listQoderSessionsFn = createServerFn({ method: 'GET' })
    .validator(workspaceSchema)
    .handler(async ({ data }) => {
        const { listQoderSessionsForGroup } = await import('@spiracha/lib/qoder-db');
        return listQoderSessionsForGroup(data.workspaceKey);
    });

const loadQoderSessionTranscript = async (sessionId: string) => {
    const { readQoderSessionTranscript, resolveQoderGlobalStateDb, resolveQoderWorkspaceStorageDir } = await import(
        '@spiracha/lib/qoder-db'
    );
    const transcript = await readQoderSessionTranscript(
        resolveQoderGlobalStateDb(),
        resolveQoderWorkspaceStorageDir(),
        sessionId,
    );
    if (!transcript) {
        throw new Error(`Qoder session not found: ${sessionId}`);
    }

    return transcript;
};

export const getQoderSessionDetailFn = createServerFn({ method: 'GET' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        return loadQoderSessionTranscript(data.sessionId);
    });

export const exportQoderSessionFn = createServerFn({ method: 'POST' })
    .validator(exportSessionSchema)
    .handler(async ({ data }) => {
        const { renderQoderTranscript } = await import('@spiracha/lib/qoder-transcript');
        const transcript = await loadQoderSessionTranscript(data.sessionId);
        const content = renderQoderTranscript(transcript, {
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
        });

        if (!content) {
            throw new Error(`Qoder session has no exportable content: ${data.sessionId}`);
        }

        return renderSourceSessionDownload({
            content,
            fallbackBaseName: 'qoder-session',
            fileBaseName: transcript.session.title || transcript.session.sessionId,
            outputFormat: data.outputFormat,
            zipArchive: data.zipArchive,
        });
    });
