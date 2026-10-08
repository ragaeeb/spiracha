import { CONVERSATION_SOURCES } from '@spiracha/lib/conversation-data/types';
import { createServerFn } from '@tanstack/react-start';
import { array, boolean, minLength, object, optional, picklist, pipe, string } from 'valibot';

const exportNormalizedConversationsSchema = object({
    ids: pipe(array(pipe(string(), minLength(1))), minLength(1)),
    source: picklist(CONVERSATION_SOURCES),
    zipArchive: optional(boolean(), false),
    zipPassword: optional(string(), ''),
});

/** JSON export for sources that have no original raw file (for example OpenCode). */
export const exportNormalizedConversationsFn = createServerFn({ method: 'POST' })
    .validator(exportNormalizedConversationsSchema)
    .handler(async ({ data }) => {
        const [{ buildNormalizedConversationJson }, { mapWithConcurrency }, { renderRawConversationDownloads }] =
            await Promise.all([
                import('@spiracha/lib/conversation-data/normalized-json-export'),
                import('@spiracha/lib/concurrency'),
                import('./source-session-export-server'),
            ]);
        const downloads = await mapWithConcurrency(data.ids, 4, async (id) => {
            const json = await buildNormalizedConversationJson({ id, source: data.source });
            if (json === null) {
                throw new Error(`No conversation exists for ${data.source} ${id}.`);
            }

            return {
                download: {
                    blob: new Blob([json], { type: 'application/json' }),
                    fileName: `${data.source}-${id}.json`,
                    mimeType: 'application/json' as const,
                },
                id,
            };
        });

        return renderRawConversationDownloads({
            downloads,
            source: data.source,
            variant: 'normalized',
            zipArchive: data.zipArchive ?? false,
            zipPassword: data.zipPassword ?? '',
        });
    });
