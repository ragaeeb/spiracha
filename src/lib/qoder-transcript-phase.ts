import type { QoderTranscriptEntry } from './qoder-exporter-types';

export type QoderMessagePhase = 'commentary' | 'final_answer' | null;

const getMessageChunkType = (entry: QoderTranscriptEntry): string | null => {
    if (entry.entryType !== 'message' || (entry.role !== 'assistant' && entry.role !== 'user')) {
        return null;
    }

    const sessionUpdate = entry.parts[0]?.raw.sessionUpdate;
    return typeof sessionUpdate === 'string' && sessionUpdate.endsWith('_message_chunk') ? sessionUpdate : null;
};

const mergeMessageChunks = (first: QoderTranscriptEntry, second: QoderTranscriptEntry): QoderTranscriptEntry => {
    const firstPart = first.parts[0]!;
    const secondPart = second.parts[0]!;
    return {
        ...first,
        parts: [
            {
                ...firstPart,
                raw: {
                    ...firstPart.raw,
                    coalescedChunkCount:
                        (typeof firstPart.raw.coalescedChunkCount === 'number'
                            ? firstPart.raw.coalescedChunkCount
                            : 1) + 1,
                },
                text: `${firstPart.text ?? ''}${secondPart.text ?? ''}`,
            },
        ],
        raw: second.raw,
        timestamp: second.timestamp ?? first.timestamp,
    };
};

export const coalesceQoderMessageChunks = (entries: QoderTranscriptEntry[]): QoderTranscriptEntry[] => {
    const coalesced: QoderTranscriptEntry[] = [];
    for (const entry of entries) {
        const previous = coalesced.at(-1);
        const chunkType = getMessageChunkType(entry);
        if (
            previous &&
            chunkType &&
            chunkType === getMessageChunkType(previous) &&
            previous.requestId === entry.requestId &&
            previous.parts.length === 1 &&
            entry.parts.length === 1
        ) {
            coalesced[coalesced.length - 1] = mergeMessageChunks(previous, entry);
        } else {
            coalesced.push(entry);
        }
    }
    return coalesced;
};

export const getFinalQoderAssistantMessageEntryIds = (entries: QoderTranscriptEntry[]): Set<string> => {
    const finalEntryIds = new Set<string>();
    let latestAssistantMessageEntryId: string | null = null;

    const flushAssistantRun = () => {
        if (latestAssistantMessageEntryId) {
            finalEntryIds.add(latestAssistantMessageEntryId);
            latestAssistantMessageEntryId = null;
        }
    };

    for (const entry of entries) {
        if (entry.role === 'tool') {
            continue;
        }

        if (entry.role === 'user') {
            flushAssistantRun();
            continue;
        }

        if (entry.role === 'assistant') {
            latestAssistantMessageEntryId = entry.entryId;
        }
    }

    flushAssistantRun();
    return finalEntryIds;
};

export const getQoderMessagePhase = (entry: QoderTranscriptEntry, finalAssistantMessageEntryIds: Set<string>) => {
    if (entry.role !== 'assistant') {
        return null;
    }

    const isExplicitReasoning = entry.parts.some((part) => {
        return (
            part.raw.sourceType === 'reasoning' ||
            part.raw.sourceType === 'thinking' ||
            part.raw.sessionUpdate === 'agent_thought_chunk'
        );
    });
    if (isExplicitReasoning) {
        return 'commentary';
    }

    return finalAssistantMessageEntryIds.has(entry.entryId) ? 'final_answer' : 'commentary';
};
