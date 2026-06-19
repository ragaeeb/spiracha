import {
    type ConversationMessageSelector,
    type ConversationSource,
    type GetConversationOptions,
    getConversation,
    isConversationSource,
    type ListConversationsForPathOptions,
    listConversationSources,
    listConversationsForPath,
    renderConversationMarkdown,
    resolveConversationRef,
} from './conversation-data';

type ConversationApiDependencies = {
    getConversation?: typeof getConversation;
    listConversationSources?: typeof listConversationSources;
    listConversationsForPath?: typeof listConversationsForPath;
    renderConversationMarkdown?: typeof renderConversationMarkdown;
    resolveConversationRef?: typeof resolveConversationRef;
};

type ApiErrorCode = 'conversation_not_found' | 'method_not_allowed' | 'not_found' | 'validation_error';
type ParseResult<T> = { error: Response } | { value: T };

const jsonResponse = (body: unknown, status = 200) =>
    Response.json(body, {
        headers: {
            'Cache-Control': 'no-store',
        },
        status,
    });

const errorResponse = (code: ApiErrorCode, message: string, status: number, details?: unknown) =>
    jsonResponse(
        {
            error: {
                code,
                details,
                message,
            },
        },
        status,
    );

const parseBoolean = (value: string | null) => value === 'true' || value === '1';

const isMessageSelector = (value: unknown): value is ConversationMessageSelector => {
    return value === 'all' || value === 'last_assistant' || value === 'last_final_answer';
};

const invalidSourceResponse = (source: unknown) =>
    errorResponse('validation_error', `Unsupported conversation source: ${String(source)}`, 400, {
        field: 'source',
        source,
    });

const invalidMessageSelectorResponse = (messageSelector: unknown) =>
    errorResponse('validation_error', `Unsupported message selector: ${String(messageSelector)}`, 400, {
        field: 'message_selector',
        message_selector: messageSelector,
    });

const parseSources = (value: string | null): ParseResult<ConversationSource[] | 'all'> => {
    if (!value) {
        return { value: 'all' };
    }

    const sources = value
        .split(',')
        .map((source) => source.trim())
        .filter(Boolean);
    const invalidSource = sources.find((source) => !isConversationSource(source));

    return invalidSource ? { error: invalidSourceResponse(invalidSource) } : { value: sources as ConversationSource[] };
};

const parseMessageSelector = (
    value: string | null,
    fallback: ConversationMessageSelector,
): ParseResult<ConversationMessageSelector> => {
    if (!value) {
        return { value: fallback };
    }

    return isMessageSelector(value) ? { value } : { error: invalidMessageSelectorResponse(value) };
};

const parseNumberParam = (value: string | null): number | undefined => {
    if (!value) {
        return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const buildListOptions = (url: URL): ParseResult<ListConversationsForPathOptions> => {
    const cwd = url.searchParams.get('cwd')?.trim();
    if (!cwd) {
        return { error: errorResponse('validation_error', '`cwd` is required.', 400, { field: 'cwd' }) };
    }

    const sources = parseSources(url.searchParams.get('source'));
    if ('error' in sources) {
        return sources;
    }

    const messageSelector = parseMessageSelector(url.searchParams.get('message_selector'), 'last_final_answer');
    if ('error' in messageSelector) {
        return messageSelector;
    }

    return {
        value: {
            cursor: url.searchParams.get('cursor'),
            cwd,
            includeMessages: parseBoolean(url.searchParams.get('include_messages')),
            limit: parseNumberParam(url.searchParams.get('limit')),
            messageSelector: messageSelector.value,
            sources: sources.value,
            updatedAfterMs: parseNumberParam(url.searchParams.get('updated_after_ms')),
            updatedBeforeMs: parseNumberParam(url.searchParams.get('updated_before_ms')),
        },
    };
};

const normalizeMeta = (meta: { hasNext: boolean; nextCursor: string | null }) => ({
    hasNext: meta.hasNext,
    next_cursor: meta.nextCursor,
});

const getDeps = (dependencies: ConversationApiDependencies) => ({
    getConversation: dependencies.getConversation ?? getConversation,
    listConversationSources: dependencies.listConversationSources ?? listConversationSources,
    listConversationsForPath: dependencies.listConversationsForPath ?? listConversationsForPath,
    renderConversationMarkdown: dependencies.renderConversationMarkdown ?? renderConversationMarkdown,
    resolveConversationRef: dependencies.resolveConversationRef ?? resolveConversationRef,
});

const handleSources = async (dependencies: ReturnType<typeof getDeps>) => {
    return jsonResponse({
        data: await dependencies.listConversationSources(),
    });
};

const handleListConversations = async (url: URL, dependencies: ReturnType<typeof getDeps>) => {
    const result = buildListOptions(url);
    if ('error' in result) {
        return result.error;
    }

    const page = await dependencies.listConversationsForPath(result.value);
    return jsonResponse({
        data: page.data,
        meta: normalizeMeta(page.meta),
    });
};

const buildGetConversationOptions = (
    source: string | undefined,
    id: string | undefined,
    url: URL,
): ParseResult<GetConversationOptions> => {
    if (!source || !id) {
        return { error: errorResponse('validation_error', 'Conversation source and id are required.', 400) };
    }

    if (!isConversationSource(source)) {
        return { error: invalidSourceResponse(source) };
    }

    const messageSelector = parseMessageSelector(url.searchParams.get('message_selector'), 'all');
    if ('error' in messageSelector) {
        return messageSelector;
    }

    return {
        value: {
            id: decodeURIComponent(id),
            messageSelector: messageSelector.value,
            source,
        },
    };
};

const handleGetConversation = async (
    source: string | undefined,
    id: string | undefined,
    url: URL,
    dependencies: ReturnType<typeof getDeps>,
) => {
    const result = buildGetConversationOptions(source, id, url);
    if ('error' in result) {
        return result.error;
    }

    const conversation = await dependencies.getConversation(result.value);
    if (!conversation) {
        return errorResponse('conversation_not_found', 'No conversation exists for that source and id.', 404, {
            id: result.value.id,
            source: result.value.source,
        });
    }

    return jsonResponse({ data: conversation });
};

const handleExportConversation = async (
    source: string | undefined,
    id: string | undefined,
    url: URL,
    dependencies: ReturnType<typeof getDeps>,
) => {
    const result = buildGetConversationOptions(source, id, url);
    if ('error' in result) {
        return result.error;
    }

    const conversation = await dependencies.getConversation(result.value);
    if (!conversation) {
        return errorResponse('conversation_not_found', 'No conversation exists for that source and id.', 404, {
            id: result.value.id,
            source: result.value.source,
        });
    }

    return new Response(dependencies.renderConversationMarkdown(conversation), {
        headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'text/markdown; charset=utf-8',
        },
    });
};

const handleResolve = async (url: URL, dependencies: ReturnType<typeof getDeps>) => {
    const ref = url.searchParams.get('ref')?.trim();
    if (!ref) {
        return errorResponse('validation_error', '`ref` is required.', 400, { field: 'ref' });
    }

    const resolved = await dependencies.resolveConversationRef(ref);
    if (!resolved) {
        return errorResponse('conversation_not_found', 'Unable to resolve conversation reference.', 404, { ref });
    }

    return jsonResponse({ data: resolved });
};

const validateSourceOption = (sources: unknown): Response | null => {
    if (sources === undefined || sources === 'all') {
        return null;
    }

    if (!Array.isArray(sources)) {
        return invalidSourceResponse(sources);
    }

    const invalidSource = sources.find((source) => !isConversationSource(source));
    return invalidSource ? invalidSourceResponse(invalidSource) : null;
};

const validateMessageSelectorOption = (messageSelector: unknown): Response | null => {
    if (messageSelector === undefined || isMessageSelector(messageSelector)) {
        return null;
    }

    return invalidMessageSelectorResponse(messageSelector);
};

const validateListQueryOptions = (options: ListConversationsForPathOptions): Response | null => {
    if (!options.cwd?.trim()) {
        return errorResponse('validation_error', '`cwd` is required.', 400, { field: 'cwd' });
    }

    return validateSourceOption(options.sources) ?? validateMessageSelectorOption(options.messageSelector);
};

const handleConversationQuery = async (request: Request, dependencies: ReturnType<typeof getDeps>) => {
    let options: ListConversationsForPathOptions;
    try {
        options = (await request.json()) as ListConversationsForPathOptions;
    } catch {
        return errorResponse('validation_error', 'Request body must be JSON.', 400);
    }

    const validationError = validateListQueryOptions(options);
    if (validationError) {
        return validationError;
    }

    const page = await dependencies.listConversationsForPath(options);
    return jsonResponse({
        data: page.data,
        meta: normalizeMeta(page.meta),
    });
};

type ApiRouteContext = {
    action: string | undefined;
    dependencies: ReturnType<typeof getDeps>;
    id: string | undefined;
    method: string;
    request: Request;
    resource: string | undefined;
    source: string | undefined;
    url: URL;
};

type ApiRoute = {
    handle: (context: ApiRouteContext) => Promise<Response> | Response;
    matches: (context: ApiRouteContext) => boolean;
    method: string;
    resource: string;
};

const API_ROUTES: ApiRoute[] = [
    {
        handle: ({ dependencies }) => handleSources(dependencies),
        matches: ({ source }) => !source,
        method: 'GET',
        resource: 'sources',
    },
    {
        handle: ({ dependencies, url }) => handleListConversations(url, dependencies),
        matches: ({ source }) => !source,
        method: 'GET',
        resource: 'conversations',
    },
    {
        handle: ({ dependencies, id, source, url }) => handleGetConversation(source, id, url, dependencies),
        matches: ({ action, id, source }) => Boolean(source && id && !action),
        method: 'GET',
        resource: 'conversations',
    },
    {
        handle: ({ dependencies, id, source, url }) => handleExportConversation(source, id, url, dependencies),
        matches: ({ action, id, source }) => Boolean(source && id && action === 'export'),
        method: 'GET',
        resource: 'conversations',
    },
    {
        handle: ({ dependencies, url }) => handleResolve(url, dependencies),
        matches: ({ source }) => !source,
        method: 'GET',
        resource: 'resolve',
    },
    {
        handle: ({ dependencies, request }) => handleConversationQuery(request, dependencies),
        matches: ({ source }) => !source,
        method: 'POST',
        resource: 'conversation-query',
    },
];

const API_RESOURCES = new Set(API_ROUTES.map((route) => route.resource));

const findRoute = (context: ApiRouteContext) =>
    API_ROUTES.find(
        (route) => route.resource === context.resource && route.method === context.method && route.matches(context),
    ) ?? null;

export const handleConversationApiRequest = async (
    request: Request,
    dependencies: ConversationApiDependencies = {},
): Promise<Response> => {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const [, version, resource, source, id, action] = parts;

    if (parts[0] !== 'api' || version !== 'v1') {
        return errorResponse('not_found', 'API route not found.', 404);
    }

    const context = {
        action,
        dependencies: getDeps(dependencies),
        id,
        method: request.method,
        request,
        resource,
        source,
        url,
    };
    const route = findRoute(context);

    if (route) {
        return route.handle(context);
    }

    if (resource && API_RESOURCES.has(resource)) {
        return errorResponse('method_not_allowed', 'Method not allowed.', 405);
    }

    return errorResponse('not_found', 'API route not found.', 404);
};
