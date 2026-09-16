import { renderSelectedTranscriptExport } from './conversation-data/conversation-export';
import { openCodePartsToMessages } from './conversation-data/opencode-message-normalizer';
import type {
    OpenCodeExportOptions,
    OpenCodeSessionSummary,
    OpenCodeSessionTranscript,
} from './opencode-exporter-types';

const MIN_DATE_MS = -8_640_000_000_000_000;
const MAX_DATE_MS = 8_640_000_000_000_000;

const formatUnixMillis = (value: number | null): string | null => {
    if (
        value === null ||
        value === undefined ||
        !Number.isFinite(value) ||
        value < MIN_DATE_MS ||
        value > MAX_DATE_MS
    ) {
        return null;
    }

    return new Date(value).toISOString();
};

const buildMetadata = (session: OpenCodeSessionSummary): Record<string, unknown> => ({
    agent: session.agent,
    cost: session.cost,
    created_at_iso: formatUnixMillis(session.createdAtMs),
    created_at_unix_ms: session.createdAtMs,
    directory: session.directory,
    exported_from: 'opencode_sqlite',
    last_updated_at_iso: formatUnixMillis(session.lastUpdatedAtMs),
    last_updated_at_unix_ms: session.lastUpdatedAtMs,
    message_count: session.messageCount,
    model: session.modelLabel,
    part_count: session.partCount,
    project_id: session.projectId,
    session_id: session.sessionId,
    slug: session.slug,
    title: session.title,
    total_tokens: session.totalTokens,
    worktree: session.worktree,
});

export const renderOpenCodeTranscript = (
    transcript: OpenCodeSessionTranscript,
    options: OpenCodeExportOptions,
): string | null =>
    renderSelectedTranscriptExport(
        {
            bodyAvailability: 'full',
            messages: openCodePartsToMessages(transcript.messages.flatMap((message) => message.parts)),
            metadata: buildMetadata(transcript.session),
            ...(transcript.session.modelLabel ? { model: transcript.session.modelLabel } : {}),
            title: transcript.session.title || transcript.session.sessionId,
        },
        options,
    );
