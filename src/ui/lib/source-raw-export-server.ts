import { createServerFn } from '@tanstack/react-start';
import { array, minLength, object, picklist, pipe, string } from 'valibot';

const rawSourceValues = [
    'antigravity',
    'claude-code',
    'cline',
    'codex',
    'grok',
    'grok-bot',
    'kiro',
    'minimax-code',
    'qoder',
] as const;

const exportRawConversationsSchema = object({
    ids: pipe(array(pipe(string(), minLength(1))), minLength(1)),
    source: picklist(rawSourceValues),
});

export const exportRawConversationsFn = createServerFn({ method: 'POST' })
    .validator(exportRawConversationsSchema)
    .handler(async ({ data }) => {
        const [{ getConversationRaw }, { mapWithConcurrency }, { renderRawConversationDownloads }] = await Promise.all([
            import('@spiracha/lib/conversation-data'),
            import('@spiracha/lib/concurrency'),
            import('./source-session-export-server'),
        ]);
        const downloads = await mapWithConcurrency(data.ids, 4, async (id) => {
            const download = await getConversationRaw({ id, source: data.source });
            if (!download) {
                throw new Error(`No raw transcript exists for ${data.source} conversation ${id}.`);
            }

            return { download, id };
        });

        return renderRawConversationDownloads({ downloads, source: data.source });
    });
