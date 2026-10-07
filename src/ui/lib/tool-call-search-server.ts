import { SOURCE_CATALOG } from '@spiracha/lib/conversation-data/source-catalog';
import { CONVERSATION_SOURCES } from '@spiracha/lib/conversation-data/types';
import { createServerFn } from '@tanstack/react-start';
import { array, minLength, object, picklist, pipe, string, trim } from 'valibot';

export const WORKSPACE_SEARCH_SOURCES = CONVERSATION_SOURCES.filter(
    (source) => SOURCE_CATALOG[source].scope === 'workspace',
);

// Antigravity and Cursor workspaces identify their folders by file URI rather than path.
export const toSearchCwd = (value: string): string =>
    value.startsWith('file://') ? decodeURIComponent(new URL(value).pathname) : value;

const searchToolCallsSchema = object({
    cwds: pipe(array(pipe(string(), minLength(1))), minLength(1)),
    query: pipe(string(), trim(), minLength(2)),
    source: picklist(WORKSPACE_SEARCH_SOURCES),
});

export const searchToolCallsFn = createServerFn({ method: 'POST' })
    .validator(searchToolCallsSchema)
    .handler(async ({ data }) => {
        const { searchConversationToolCalls } = await import('@spiracha/lib/conversation-data/tool-call-search');
        return searchConversationToolCalls({
            cwds: data.cwds.map(toSearchCwd),
            query: data.query,
            source: data.source,
        });
    });
