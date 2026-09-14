import type { CommandCodeSessionTranscript } from '@spiracha/lib/command-code-exporter-types';
import type { ConversationMessage } from '@spiracha/lib/conversation-data/types';
import type { JsonValue } from '@spiracha/lib/shared-text';
import { createServerFn } from '@tanstack/react-start';
import { minLength, object, pipe, regex, string } from 'valibot';

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
