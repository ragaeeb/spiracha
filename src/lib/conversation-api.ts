import {
    type ConversationMessageSelector,
    type ConversationSource,
    type DeleteConversationOptions,
    deleteConversation,
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
    deleteConversation?: typeof deleteConversation;
    getConversation?: typeof getConversation;
    listConversationSources?: typeof listConversationSources;
    listConversationsForPath?: typeof listConversationsForPath;
    renderConversationMarkdown?: typeof renderConversationMarkdown;
    resolveConversationRef?: typeof resolveConversationRef;
};

type ApiErrorCode =
    | 'conversation_not_found'
    | 'method_not_allowed'
    | 'not_found'
    | 'unsupported_operation'
    | 'validation_error';
type ParseResult<T> = { error: Response } | { value: T };

const MAX_CURSOR_OFFSET = 1_000_000;
const MAX_ID_LENGTH = 2048;
const MAX_LIMIT = 200;
const MAX_PATH_LENGTH = 4096;
const MAX_TIMESTAMP_MS = 9_999_999_999_999;

const jsonResponse = (body: unknown, status = 200, headers: HeadersInit = {}) =>
    Response.json(body, {
        headers: {
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            ...headers,
        },
        status,
    });

const errorResponse = (
    code: ApiErrorCode,
    message: string,
    status: number,
    details?: unknown,
    headers: HeadersInit = {},
) =>
    jsonResponse(
        {
            error: {
                code,
                details,
                message,
            },
        },
        status,
        headers,
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

const decodeCursorOffset = (cursor: string) => {
    try {
        const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
        if (!/^\d+$/u.test(decoded)) {
            return null;
        }

        const offset = Number(decoded);
        return Number.isSafeInteger(offset) && offset >= 0 && offset <= MAX_CURSOR_OFFSET ? offset : null;
    } catch {
        return null;
    }
};

const invalidFieldResponse = (field: string, value: unknown, message: string) =>
    errorResponse('validation_error', message, 400, { field, value });

const normalizeLimit = (value: number | undefined): number | undefined => {
    if (value === undefined) {
        return undefined;
    }

    return Math.min(value, MAX_LIMIT);
};

const validateCursor = (cursor: string | null | undefined): Response | null => {
    if (!cursor) {
        return null;
    }

    return decodeCursorOffset(cursor) === null
        ? invalidFieldResponse('cursor', cursor, '`cursor` must be a valid pagination cursor.')
        : null;
};

const validateLimit = (limit: number | undefined): Response | null => {
    if (limit === undefined) {
        return null;
    }

    return Number.isSafeInteger(limit) && limit > 0
        ? null
        : invalidFieldResponse('limit', limit, '`limit` must be a positive integer.');
};

const validatePathLength = (field: string, value: string): Response | null => {
    return value.length <= MAX_PATH_LENGTH
        ? null
        : invalidFieldResponse(field, value.length, `\`${field}\` is too long.`);
};

const validateTimestamp = (field: string, value: number | undefined): Response | null => {
    if (value === undefined) {
        return null;
    }

    return Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIMESTAMP_MS
        ? null
        : invalidFieldResponse(field, value, `\`${field}\` must be a non-negative epoch millisecond timestamp.`);
};

const validateDeleteId = (id: string): Response | null => {
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(id)
        ? null
        : invalidFieldResponse(
              'id',
              id,
              'Conversation id contains characters that are not allowed for destructive requests.',
          );
};

const parseListLimitParam = (value: string | null): ParseResult<number | undefined> => {
    if (!value) {
        return { value: undefined };
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return { error: invalidFieldResponse('limit', value, '`limit` must be a positive integer.') };
    }

    const validationError = validateLimit(parsed);
    return validationError ? { error: validationError } : { value: normalizeLimit(parsed) };
};

const parseTimestampParam = (field: string, value: string | null): ParseResult<number | undefined> => {
    if (!value) {
        return { value: undefined };
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return {
            error: invalidFieldResponse(
                field,
                value,
                `\`${field}\` must be a non-negative epoch millisecond timestamp.`,
            ),
        };
    }

    const validationError = validateTimestamp(field, parsed);
    return validationError ? { error: validationError } : { value: parsed };
};

const buildListOptions = (url: URL): ParseResult<ListConversationsForPathOptions> => {
    const cwd = url.searchParams.get('cwd')?.trim();
    if (!cwd) {
        return { error: errorResponse('validation_error', '`cwd` is required.', 400, { field: 'cwd' }) };
    }
    const cwdLengthError = validatePathLength('cwd', cwd);
    if (cwdLengthError) {
        return { error: cwdLengthError };
    }

    const cursor = url.searchParams.get('cursor');
    const cursorError = validateCursor(cursor);
    if (cursorError) {
        return { error: cursorError };
    }

    const sources = parseSources(url.searchParams.get('source'));
    if ('error' in sources) {
        return sources;
    }

    const messageSelector = parseMessageSelector(url.searchParams.get('message_selector'), 'last_final_answer');
    if ('error' in messageSelector) {
        return messageSelector;
    }

    const limit = parseListLimitParam(url.searchParams.get('limit'));
    if ('error' in limit) {
        return limit;
    }

    const updatedAfterMs = parseTimestampParam('updated_after_ms', url.searchParams.get('updated_after_ms'));
    if ('error' in updatedAfterMs) {
        return updatedAfterMs;
    }

    const updatedBeforeMs = parseTimestampParam('updated_before_ms', url.searchParams.get('updated_before_ms'));
    if ('error' in updatedBeforeMs) {
        return updatedBeforeMs;
    }

    return {
        value: {
            cursor,
            cwd,
            includeMessages: parseBoolean(url.searchParams.get('include_messages')),
            limit: limit.value,
            messageSelector: messageSelector.value,
            sources: sources.value,
            updatedAfterMs: updatedAfterMs.value,
            updatedBeforeMs: updatedBeforeMs.value,
        },
    };
};

const normalizeMeta = (meta: { hasNext: boolean; nextCursor: string | null }) => ({
    hasNext: meta.hasNext,
    next_cursor: meta.nextCursor,
});

const getDeps = (dependencies: ConversationApiDependencies) => ({
    deleteConversation: dependencies.deleteConversation ?? deleteConversation,
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

    let decodedId: string;
    try {
        decodedId = decodeURIComponent(id);
    } catch {
        return { error: invalidFieldResponse('id', id, 'Conversation id must be URL encoded.') };
    }
    if (!decodedId.trim() || decodedId.length > MAX_ID_LENGTH) {
        return { error: invalidFieldResponse('id', decodedId.length, 'Conversation id is invalid.') };
    }

    const messageSelector = parseMessageSelector(url.searchParams.get('message_selector'), 'all');
    if ('error' in messageSelector) {
        return messageSelector;
    }

    return {
        value: {
            id: decodedId,
            messageSelector: messageSelector.value,
            source,
        },
    };
};

const buildDeleteConversationOptions = (
    source: string | undefined,
    id: string | undefined,
): ParseResult<DeleteConversationOptions> => {
    if (!source || !id) {
        return { error: errorResponse('validation_error', 'Conversation source and id are required.', 400) };
    }

    if (!isConversationSource(source)) {
        return { error: invalidSourceResponse(source) };
    }

    let decodedId: string;
    try {
        decodedId = decodeURIComponent(id);
    } catch {
        return { error: invalidFieldResponse('id', id, 'Conversation id must be URL encoded.') };
    }
    if (!decodedId.trim() || decodedId.length > MAX_ID_LENGTH) {
        return { error: invalidFieldResponse('id', decodedId.length, 'Conversation id is invalid.') };
    }
    const deleteIdError = validateDeleteId(decodedId);
    if (deleteIdError) {
        return { error: deleteIdError };
    }

    return {
        value: {
            id: decodedId,
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
            'X-Content-Type-Options': 'nosniff',
        },
    });
};

const handleDeleteConversation = async (
    source: string | undefined,
    id: string | undefined,
    dependencies: ReturnType<typeof getDeps>,
) => {
    const result = buildDeleteConversationOptions(source, id);
    if ('error' in result) {
        return result.error;
    }

    const deleteResult = await dependencies.deleteConversation(result.value);
    if (!deleteResult) {
        return errorResponse(
            'unsupported_operation',
            `Deleting ${result.value.source} conversations is not supported by the stable API.`,
            405,
            {
                source: result.value.source,
            },
        );
    }

    if (deleteResult.deletedIds.length === 0) {
        return errorResponse('conversation_not_found', 'No conversation exists for that source and id.', 404, {
            id: result.value.id,
            source: result.value.source,
        });
    }

    return jsonResponse({ data: deleteResult });
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

    if (sources.length === 0) {
        return invalidFieldResponse('source', sources, '`source` must include at least one source.');
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

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const getOption = (options: Record<string, unknown>, camelKey: string, snakeKey: string) => {
    if (camelKey in options) {
        return options[camelKey];
    }

    return snakeKey in options ? options[snakeKey] : undefined;
};

const getStringOption = (
    options: Record<string, unknown>,
    camelKey: string,
    snakeKey: string,
): ParseResult<string | undefined> => {
    const value = getOption(options, camelKey, snakeKey);
    if (value === undefined) {
        return { value: undefined };
    }

    return typeof value === 'string'
        ? { value }
        : { error: invalidFieldResponse(snakeKey, value, `\`${snakeKey}\` must be a string.`) };
};

const getNumberOption = (
    options: Record<string, unknown>,
    camelKey: string,
    snakeKey: string,
): ParseResult<number | undefined> => {
    const value = getOption(options, camelKey, snakeKey);
    if (value === undefined) {
        return { value: undefined };
    }

    return typeof value === 'number' && Number.isFinite(value)
        ? { value }
        : { error: invalidFieldResponse(snakeKey, value, `\`${snakeKey}\` must be a finite number.`) };
};

const getBooleanOption = (
    options: Record<string, unknown>,
    camelKey: string,
    snakeKey: string,
): ParseResult<boolean | undefined> => {
    const value = getOption(options, camelKey, snakeKey);
    if (value === undefined) {
        return { value: undefined };
    }

    return typeof value === 'boolean'
        ? { value }
        : { error: invalidFieldResponse(snakeKey, value, `\`${snakeKey}\` must be a boolean.`) };
};

const parseJsonSources = (value: unknown): ParseResult<ConversationSource[] | 'all'> => {
    if (value === undefined || value === 'all') {
        return { value: 'all' };
    }

    if (typeof value === 'string') {
        return parseSources(value);
    }

    if (!Array.isArray(value)) {
        return { error: invalidSourceResponse(value) };
    }

    if (value.length === 0) {
        return { error: invalidFieldResponse('source', value, '`source` must include at least one source.') };
    }

    const invalidSource = value.find((source) => !isConversationSource(source));
    return invalidSource ? { error: invalidSourceResponse(invalidSource) } : { value: value as ConversationSource[] };
};

const parseJsonCwd = (body: Record<string, unknown>): ParseResult<string> => {
    const cwdOption = getStringOption(body, 'cwd', 'cwd');
    if ('error' in cwdOption) {
        return cwdOption;
    }

    const cwd = cwdOption.value?.trim();
    if (!cwd) {
        return { error: errorResponse('validation_error', '`cwd` is required.', 400, { field: 'cwd' }) };
    }

    const cwdLengthError = validatePathLength('cwd', cwd);
    return cwdLengthError ? { error: cwdLengthError } : { value: cwd };
};

const parseJsonCursor = (body: Record<string, unknown>): ParseResult<string | null> => {
    const cursorValue = body.cursor;
    const cursor = typeof cursorValue === 'string' ? cursorValue : null;
    if (cursorValue !== undefined && cursorValue !== null && typeof cursorValue !== 'string') {
        return { error: invalidFieldResponse('cursor', cursorValue, '`cursor` must be a string.') };
    }

    const cursorError = validateCursor(cursor);
    return cursorError ? { error: cursorError } : { value: cursor };
};

const parseJsonMessageSelector = (body: Record<string, unknown>): ParseResult<ConversationMessageSelector> => {
    const messageSelectorValue = getStringOption(body, 'messageSelector', 'message_selector');
    if ('error' in messageSelectorValue) {
        return messageSelectorValue;
    }

    return parseMessageSelector(messageSelectorValue.value ?? null, 'last_final_answer');
};

const parseJsonNumberOption = (
    body: Record<string, unknown>,
    camelKey: string,
    snakeKey: string,
    validate: (value: number | undefined) => Response | null,
): ParseResult<number | undefined> => {
    const value = getNumberOption(body, camelKey, snakeKey);
    if ('error' in value) {
        return value;
    }

    const validationError = validate(value.value);
    return validationError ? { error: validationError } : value;
};

const normalizeJsonListOptions = (body: unknown): ParseResult<ListConversationsForPathOptions> => {
    if (!isRecord(body)) {
        return { error: errorResponse('validation_error', 'Request body must be a JSON object.', 400) };
    }

    const cwd = parseJsonCwd(body);
    if ('error' in cwd) {
        return cwd;
    }

    const cursor = parseJsonCursor(body);
    if ('error' in cursor) {
        return cursor;
    }

    const sources = parseJsonSources(getOption(body, 'sources', 'source'));
    if ('error' in sources) {
        return sources;
    }

    const messageSelector = parseJsonMessageSelector(body);
    if ('error' in messageSelector) {
        return messageSelector;
    }

    const limit = parseJsonNumberOption(body, 'limit', 'limit', validateLimit);
    if ('error' in limit) {
        return limit;
    }

    const updatedAfterMs = parseJsonNumberOption(body, 'updatedAfterMs', 'updated_after_ms', (value) =>
        validateTimestamp('updated_after_ms', value),
    );
    if ('error' in updatedAfterMs) {
        return updatedAfterMs;
    }

    const updatedBeforeMs = parseJsonNumberOption(body, 'updatedBeforeMs', 'updated_before_ms', (value) =>
        validateTimestamp('updated_before_ms', value),
    );
    if ('error' in updatedBeforeMs) {
        return updatedBeforeMs;
    }

    const includeMessages = getBooleanOption(body, 'includeMessages', 'include_messages');
    if ('error' in includeMessages) {
        return includeMessages;
    }

    return {
        value: {
            cursor: cursor.value,
            cwd: cwd.value,
            includeMessages: includeMessages.value,
            limit: normalizeLimit(limit.value),
            messageSelector: messageSelector.value,
            sources: sources.value,
            updatedAfterMs: updatedAfterMs.value,
            updatedBeforeMs: updatedBeforeMs.value,
        },
    };
};

const validateListQueryOptions = (options: ListConversationsForPathOptions): Response | null => {
    if (typeof options.cwd !== 'string' || !options.cwd.trim()) {
        return errorResponse('validation_error', '`cwd` is required.', 400, { field: 'cwd' });
    }

    return (
        validatePathLength('cwd', options.cwd) ??
        validateCursor(options.cursor) ??
        validateLimit(options.limit) ??
        validateTimestamp('updated_after_ms', options.updatedAfterMs) ??
        validateTimestamp('updated_before_ms', options.updatedBeforeMs) ??
        validateSourceOption(options.sources) ??
        validateMessageSelectorOption(options.messageSelector)
    );
};

const handleConversationQuery = async (request: Request, dependencies: ReturnType<typeof getDeps>) => {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return errorResponse('validation_error', 'Request body must be JSON.', 400);
    }

    const normalized = normalizeJsonListOptions(body);
    if ('error' in normalized) {
        return normalized.error;
    }

    const options = normalized.value;
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
    segments: string[];
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
        handle: ({ dependencies, id, source }) => handleDeleteConversation(source, id, dependencies),
        matches: ({ action, id, source }) => Boolean(source && id && !action),
        method: 'DELETE',
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

const allowedMethodsForContext = (context: ApiRouteContext) => {
    return [
        ...new Set(
            API_ROUTES.filter((route) => route.resource === context.resource && route.matches(context)).map(
                (route) => route.method,
            ),
        ),
    ].sort();
};

const parseApiSegments = (segments: string[]) => {
    if (segments.length < 3 || segments[0] !== 'api' || segments[1] !== 'v1') {
        return null;
    }

    const resource = segments[2];
    if (!resource) {
        return null;
    }

    if (resource === 'conversations') {
        if (segments.length === 3) {
            return { action: undefined, id: undefined, resource, source: undefined };
        }
        if (segments.length === 5) {
            return { action: undefined, id: segments[4], resource, source: segments[3] };
        }
        if (segments.length === 6 && segments[5] === 'export') {
            return { action: 'export', id: segments[4], resource, source: segments[3] };
        }
        return { action: '__invalid__', id: undefined, resource, source: undefined };
    }

    if (segments.length === 3) {
        return { action: undefined, id: undefined, resource, source: undefined };
    }

    return { action: '__invalid__', id: undefined, resource, source: undefined };
};

export const handleConversationApiRequest = async (
    request: Request,
    dependencies: ConversationApiDependencies = {},
): Promise<Response> => {
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const parsed = parseApiSegments(segments);

    if (!parsed) {
        return errorResponse('not_found', 'API route not found.', 404);
    }

    if (parsed.action === '__invalid__') {
        return errorResponse('not_found', 'API route not found.', 404);
    }

    const context = {
        action: parsed.action,
        dependencies: getDeps(dependencies),
        id: parsed.id,
        method: request.method,
        request,
        resource: parsed.resource,
        segments,
        source: parsed.source,
        url,
    };
    const route = findRoute(context);

    if (route) {
        return route.handle(context);
    }

    if (parsed.resource && API_RESOURCES.has(parsed.resource)) {
        const allowedMethods = allowedMethodsForContext(context);
        if (allowedMethods.length > 0) {
            return errorResponse('method_not_allowed', 'Method not allowed.', 405, undefined, {
                Allow: allowedMethods.join(', '),
            });
        }
    }

    return errorResponse('not_found', 'API route not found.', 404);
};
