import { renderSelectedTranscriptExport } from './conversation-data/conversation-export';
import { cursorBubblesToMessages } from './conversation-data/cursor-message-normalizer';
import type { SupplementalEvent } from './conversation-data/types';
import type { CursorExportOptions, CursorThreadHead, CursorThreadTranscript } from './cursor-exporter-types';

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

const buildMetadata = (transcript: CursorThreadTranscript): Record<string, unknown> => {
    const { head } = transcript;
    return {
        composer_id: head.composerId,
        created_at_iso: formatUnixMillis(head.createdAtMs),
        created_at_unix_ms: head.createdAtMs,
        exported_from: 'cursor_global_storage_bubbles',
        last_updated_at_iso: formatUnixMillis(head.lastUpdatedAtMs),
        last_updated_at_unix_ms: head.lastUpdatedAtMs,
        mode: head.mode,
        omitted_message_count: transcript.omittedBubbleCount > 0 ? transcript.omittedBubbleCount : null,
        rendered_message_count: transcript.renderableBubbleCount,
        title: head.name,
    };
};

const truncationNotice = (transcript: CursorThreadTranscript): SupplementalEvent[] => {
    if (transcript.omittedBubbleCount <= 0) {
        return [];
    }

    const orderedCount = transcript.head.orderedBubbleIds.length;
    return [
        {
            createdAtMs: null,
            id: `${transcript.head.composerId}:omitted`,
            kind: 'lifecycle',
            metadata: { omittedBubbleCount: transcript.omittedBubbleCount },
            order: 0,
            provenance: {
                blockIndex: null,
                branchId: null,
                origin: 'derived',
                parentMessageId: null,
                sourceConversationId: transcript.head.composerId,
                sourceRecordId: null,
            },
            text: [
                `Cursor indexed only the most recent ${orderedCount} of`,
                `${orderedCount + transcript.omittedBubbleCount} stored messages for this thread,`,
                'so earlier messages are not part of its conversation index and are not included here.',
            ].join(' '),
        },
    ];
};

const threadTitle = (head: CursorThreadHead): string => head.name || head.composerId;

export const renderCursorTranscript = (
    transcript: CursorThreadTranscript,
    options: CursorExportOptions,
): string | null =>
    renderSelectedTranscriptExport(
        {
            bodyAvailability: 'full',
            messages: cursorBubblesToMessages(
                transcript.bubbles.filter((bubble) => bubble.kind === 'user' || bubble.kind === 'assistant'),
            ),
            metadata: buildMetadata(transcript),
            ...(transcript.head.model ? { model: transcript.head.model } : {}),
            supplementalEvents: truncationNotice(transcript),
            title: threadTitle(transcript.head),
        },
        options,
    );
