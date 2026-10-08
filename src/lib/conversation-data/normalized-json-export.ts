import { readOpenCodeSessionTables } from '../opencode-db';
import { resolveOpenCodeDbPath } from '../opencode-exporter-types';
import { getConversation } from './index';
import type { ConversationDataLocations, ConversationSource } from './types';

export const NORMALIZED_CONVERSATION_FORMAT = 'spiracha/normalized-conversation';

type NormalizedJsonOptions = {
    id: string;
    locations?: ConversationDataLocations;
    source: ConversationSource;
};

type SourceTableReader = (options: NormalizedJsonOptions) => Promise<Record<string, unknown> | null>;

// Sources with no standalone native file keep their data in shared tables; their export carries the complete rows too.
const SOURCE_TABLE_READERS: Partial<Record<ConversationSource, SourceTableReader>> = {
    opencode: ({ id, locations }) =>
        readOpenCodeSessionTables(locations?.opencodeDbPath ?? resolveOpenCodeDbPath(), id),
};

/**
 * Serializes one conversation as Spiracha's normalized JSON (every message, no selector filtering). For sources
 * without an original raw file it also embeds the complete stored rows with their timestamps under `sourceTables`.
 * Returns null when the conversation does not exist.
 */
export const buildNormalizedConversationJson = async (options: NormalizedJsonOptions): Promise<string | null> => {
    const conversation = await getConversation({
        id: options.id,
        locations: options.locations,
        messageSelector: 'all',
        source: options.source,
    });
    if (!conversation) {
        return null;
    }

    const sourceTables = (await SOURCE_TABLE_READERS[options.source]?.(options)) ?? undefined;
    return JSON.stringify(
        {
            conversation,
            format: NORMALIZED_CONVERSATION_FORMAT,
            formatVersion: 1,
            source: options.source,
            ...(sourceTables ? { sourceTables } : {}),
        },
        null,
        2,
    );
};
