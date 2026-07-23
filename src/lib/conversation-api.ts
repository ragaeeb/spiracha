import path from 'node:path';
import { mapWithConcurrency } from './concurrency';
import {
    type ConversationDetail,
    type ConversationMessageSelector,
    type ConversationSource,
    type DeleteConversationOptions,
    type DeleteConversationsOptions,
    deleteConversation,
    deleteConversations,
    type ExportConversationsZipOptions,
    type GetConversationOptions,
    getConversation,
    isConversationSource,
    type ListConversationsForPathOptions,
    listConversationSources,
    listConversationsForPath,
    renderConversationMarkdown,
    resolveConversationRef,
} from './conversation-data';
import { validateEvidenceLens } from './conversation-data/evidence-lens';
import { buildEvidenceExport } from './conversation-data/evidence-markdown';
import { decodeConversationCursor } from './conversation-data/pagination';
import { createConversationMarkdownZip } from './conversation-zip-export';

type ConversationApiDependencies = {
    buildEvidenceExport?: typeof buildEvidenceExport;
    deleteConversation?: typeof deleteConversation;
    deleteConversations?: typeof deleteConversations;
    getConversation?: typeof getConversation;
    listConversationSources?: typeof listConversationSources;
    listConversationsForPath?: typeof listConversationsForPath;
    renderConversationMarkdown?: typeof renderConversationMarkdown;
    resolveConversationRef?: typeof resolveConversationRef;
};

type ApiErrorCode =
    | 'conversation_not_found'
    | 'internal_error'
    | 'method_not_allowed'
    | 'not_found'
    | 'unsupported_operation'
    | 'validation_error';
type ParseResult<T> = { error: Response } | { value: T };

const BATCH_LOAD_CONCURRENCY = 4;
const MAX_ID_BATCH_SIZE = 200;
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

    const sources = [
        ...new Set(
            value
                .split(',')
                .map((source) => source.trim())
                .filter(Boolean),
        ),
    ];
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

    try {
        if (!decodeConversationCursor(cursor)) {
            throw new Error('Invalid cursor');
        }
        return null;
    } catch {
        return invalidFieldResponse('cursor', cursor, '`cursor` must be a valid pagination cursor.');
    }
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

const validateAbsoluteCwd = (cwd: string): Response | null =>
    path.isAbsolute(cwd) ? null : invalidFieldResponse('cwd', cwd, '`cwd` must be an absolute path.');

const validateTimestamp = (field: string, value: number | undefined): Response | null => {
    if (value === undefined) {
        return null;
    }

    return Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIMESTAMP_MS
        ? null
        : invalidFieldResponse(field, value, `\`${field}\` must be a non-negative epoch millisecond timestamp.`);
};

const validateConversationId = (id: string): Response | null => {
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(id) && !id.includes('..')
        ? null
        : invalidFieldResponse('id', id, 'Conversation id contains characters that are not allowed by the stable API.');
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
    const cwdAbsoluteError = validateAbsoluteCwd(cwd);
    if (cwdAbsoluteError) {
        return { error: cwdAbsoluteError };
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
    has_next: meta.hasNext,
    next_cursor: meta.nextCursor,
});

const getDeps = (dependencies: ConversationApiDependencies) => ({
    buildEvidenceExport: dependencies.buildEvidenceExport ?? buildEvidenceExport,
    deleteConversation: dependencies.deleteConversation ?? deleteConversation,
    deleteConversations: dependencies.deleteConversations ?? deleteConversations,
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
    const idError = validateConversationId(decodedId);
    if (idError) {
        return { error: idError };
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

    return new Response(
        dependencies.renderConversationMarkdown(conversation, {
            messageSelector: result.value.messageSelector,
        }),
        {
            headers: {
                'Cache-Control': 'no-store',
                'Content-Type': 'text/markdown; charset=utf-8',
                'X-Content-Type-Options': 'nosniff',
            },
        },
    );
};

const handleExportEvidence = async (
    source: string | undefined,
    id: string | undefined,
    request: Request,
    dependencies: ReturnType<typeof getDeps>,
) => {
    const getOptions = buildGetConversationOptions(source, id, new URL(request.url));
    if ('error' in getOptions) {
        return getOptions.error;
    }
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return errorResponse('validation_error', 'Request body must be JSON.', 400);
    }
    if (!isRecord(body)) {
        return errorResponse('validation_error', 'Request body must be a JSON object.', 400);
    }
    const unknownField = Object.keys(body).find((field) => field !== 'lens' && field !== 'generated_at');
    if (unknownField) {
        return invalidFieldResponse(unknownField, body[unknownField], 'Unknown request field.');
    }
    const validated = validateEvidenceLens(body.lens);
    if (!validated.ok) {
        const field = validated.error.path ? `lens.${validated.error.path}` : 'lens';
        return invalidFieldResponse(field, undefined, validated.error.message);
    }
    const generatedAt = body.generated_at;
    const canonicalGeneratedAt = (() => {
        if (generatedAt === undefined) {
            return undefined;
        }
        if (typeof generatedAt !== 'string' || generatedAt.length > 64) {
            return null;
        }
        try {
            return new Date(generatedAt).toISOString() === generatedAt ? generatedAt : null;
        } catch {
            return null;
        }
    })();
    if (canonicalGeneratedAt === null) {
        return invalidFieldResponse('generated_at', generatedAt, '`generated_at` must be an ISO-8601 timestamp.');
    }
    const conversation = await dependencies.getConversation({ ...getOptions.value, messageSelector: 'all' });
    if (!conversation) {
        return errorResponse('conversation_not_found', 'No conversation exists for that source and id.', 404, {
            id: getOptions.value.id,
            source: getOptions.value.source,
        });
    }
    return jsonResponse({
        data: dependencies.buildEvidenceExport(conversation, validated.value, {
            generatedAt: canonicalGeneratedAt,
        }),
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

const parseJsonBody = async (request: Request): Promise<ParseResult<Record<string, unknown>>> => {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return { error: errorResponse('validation_error', 'Request body must be JSON.', 400) };
    }

    return isRecord(body)
        ? { value: body }
        : { error: errorResponse('validation_error', 'Request body must be a JSON object.', 400) };
};

const parseJsonSourceOption = (body: Record<string, unknown>): ParseResult<ConversationSource> => {
    const sourceOption = getStringOption(body, 'source', 'source');
    if ('error' in sourceOption) {
        return sourceOption;
    }

    const source = sourceOption.value?.trim();
    if (!source) {
        return { error: errorResponse('validation_error', '`source` is required.', 400, { field: 'source' }) };
    }

    return isConversationSource(source) ? { value: source } : { error: invalidSourceResponse(source) };
};

const parseJsonIdsOption = (body: Record<string, unknown>): ParseResult<string[]> => {
    const idsValue = getOption(body, 'ids', 'ids');
    if (!Array.isArray(idsValue) || idsValue.length === 0) {
        return {
            error: invalidFieldResponse('ids', idsValue, '`ids` must be a non-empty array of explicit ids.'),
        };
    }

    if (idsValue.length > MAX_ID_BATCH_SIZE) {
        return {
            error: invalidFieldResponse(
                'ids',
                idsValue.length,
                `\`ids\` cannot include more than ${MAX_ID_BATCH_SIZE} ids.`,
            ),
        };
    }

    const ids: string[] = [];
    const seenIds = new Set<string>();
    for (const [index, value] of idsValue.entries()) {
        if (typeof value !== 'string') {
            return {
                error: invalidFieldResponse('ids', value, `\`ids[${index}]\` must be a string.`),
            };
        }

        const id = value.trim();
        if (!id || id.length > MAX_ID_LENGTH) {
            return {
                error: invalidFieldResponse('ids', value, `\`ids[${index}]\` is invalid.`),
            };
        }

        const idError = validateConversationId(id);
        if (idError) {
            return { error: idError };
        }

        if (!seenIds.has(id)) {
            seenIds.add(id);
            ids.push(id);
        }
    }

    return { value: ids };
};

const parseJsonExportFormat = (body: Record<string, unknown>): ParseResult<'md'> => {
    const outputFormat = getStringOption(body, 'outputFormat', 'output_format');
    if ('error' in outputFormat) {
        return outputFormat;
    }

    if (outputFormat.value === undefined || outputFormat.value === 'md') {
        return { value: 'md' };
    }

    return { error: invalidFieldResponse('output_format', outputFormat.value, '`output_format` must be "md".') };
};

const parseJsonExportMessageSelector = (body: Record<string, unknown>): ParseResult<ConversationMessageSelector> => {
    const messageSelectorValue = getStringOption(body, 'messageSelector', 'message_selector');
    if ('error' in messageSelectorValue) {
        return messageSelectorValue;
    }

    return parseMessageSelector(messageSelectorValue.value ?? null, 'all');
};

const parseConversationIdSetRecord = (body: Record<string, unknown>): ParseResult<DeleteConversationsOptions> => {
    const source = parseJsonSourceOption(body);
    if ('error' in source) {
        return source;
    }

    const ids = parseJsonIdsOption(body);
    if ('error' in ids) {
        return ids;
    }

    return {
        value: {
            ids: ids.value,
            source: source.value,
        },
    };
};

const parseExportConversationsBody = async (request: Request): Promise<ParseResult<ExportConversationsZipOptions>> => {
    const body = await parseJsonBody(request);
    if ('error' in body) {
        return body;
    }

    const idSet = parseConversationIdSetRecord(body.value);
    if ('error' in idSet) {
        return idSet;
    }

    const outputFormat = parseJsonExportFormat(body.value);
    if ('error' in outputFormat) {
        return outputFormat;
    }

    const messageSelector = parseJsonExportMessageSelector(body.value);
    if ('error' in messageSelector) {
        return messageSelector;
    }

    return {
        value: {
            ids: idSet.value.ids,
            messageSelector: messageSelector.value,
            outputFormat: outputFormat.value,
            source: idSet.value.source,
        },
    };
};

const handleDeleteConversations = async (request: Request, dependencies: ReturnType<typeof getDeps>) => {
    const body = await parseJsonBody(request);
    if ('error' in body) {
        return body.error;
    }

    const result = parseConversationIdSetRecord(body.value);
    if ('error' in result) {
        return result.error;
    }

    const deleteResult = await dependencies.deleteConversations(result.value);
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
        return errorResponse('conversation_not_found', 'No conversations exist for that source and id set.', 404, {
            ids: result.value.ids,
            source: result.value.source,
        });
    }

    return jsonResponse({ data: deleteResult });
};

const getConversationZipEntry = (conversation: ConversationDetail, markdown: string) => ({
    fallbackBaseName: `${conversation.source}-${conversation.id}`,
    markdown,
    title: conversation.title,
});

const handleExportConversations = async (request: Request, dependencies: ReturnType<typeof getDeps>) => {
    const result = await parseExportConversationsBody(request);
    if ('error' in result) {
        return result.error;
    }

    const loaded = await mapWithConcurrency(result.value.ids, BATCH_LOAD_CONCURRENCY, async (id) => {
        const conversation = await dependencies.getConversation({
            id,
            messageSelector: result.value.messageSelector,
            source: result.value.source,
        });
        if (!conversation) {
            return { entry: null, id };
        }

        return {
            entry: getConversationZipEntry(
                conversation,
                dependencies.renderConversationMarkdown(conversation, {
                    messageSelector: result.value.messageSelector,
                }),
            ),
            id,
        };
    });
    const missingIds = loaded.filter(({ entry }) => !entry).map(({ id }) => id);

    if (missingIds.length > 0) {
        return errorResponse(
            'conversation_not_found',
            'Some conversations do not exist for that source and id set.',
            404,
            {
                ids: missingIds,
                source: result.value.source,
            },
        );
    }

    const zip = await createConversationMarkdownZip({
        entries: loaded.flatMap(({ entry }) => (entry ? [entry] : [])),
        fileBaseName: `${result.value.source}-conversations-${result.value.ids.length}`,
    });

    return new Response(zip.blob, {
        headers: {
            'Cache-Control': 'no-store',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(zip.fileName)}`,
            'Content-Type': zip.mimeType,
            'X-Content-Type-Options': 'nosniff',
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

    const cwdError = validatePathLength('cwd', cwd) ?? validateAbsoluteCwd(cwd);
    return cwdError ? { error: cwdError } : { value: cwd };
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
        validateAbsoluteCwd(options.cwd) ??
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
        matches: ({ action, source }) => !source && !action,
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
        handle: ({ dependencies, id, request, source }) => handleExportEvidence(source, id, request, dependencies),
        matches: ({ action, id, source }) => Boolean(source && id && action === 'evidence'),
        method: 'POST',
        resource: 'conversations',
    },
    {
        handle: ({ dependencies, id, source }) => handleDeleteConversation(source, id, dependencies),
        matches: ({ action, id, source }) => Boolean(source && id && !action),
        method: 'DELETE',
        resource: 'conversations',
    },
    {
        handle: ({ dependencies, request }) => handleDeleteConversations(request, dependencies),
        matches: ({ action, source }) => !source && action === 'delete',
        method: 'POST',
        resource: 'conversations',
    },
    {
        handle: ({ dependencies, request }) => handleExportConversations(request, dependencies),
        matches: ({ action, source }) => !source && action === 'export',
        method: 'POST',
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

const parseConversationApiSegments = (segments: string[], resource: string) => {
    if (segments.length === 3) {
        return { action: undefined, id: undefined, resource, source: undefined };
    }
    if (segments.length === 4 && (segments[3] === 'delete' || segments[3] === 'export')) {
        return { action: segments[3], id: undefined, resource, source: undefined };
    }
    if (segments.length === 5) {
        return { action: undefined, id: segments[4], resource, source: segments[3] };
    }
    if (segments.length === 6 && (segments[5] === 'export' || segments[5] === 'evidence')) {
        return { action: segments[5], id: segments[4], resource, source: segments[3] };
    }
    return { action: '__invalid__', id: undefined, resource, source: undefined };
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
        return parseConversationApiSegments(segments, resource);
    }

    return segments.length === 3
        ? { action: undefined, id: undefined, resource, source: undefined }
        : { action: '__invalid__', id: undefined, resource, source: undefined };
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
        try {
            return await route.handle(context);
        } catch (error) {
            console.error('[spiracha:conversation-api] request_failed', {
                error: error instanceof Error ? error.message : String(error),
                method: request.method,
                pathname: url.pathname,
            });
            return errorResponse('internal_error', 'Conversation API request failed.', 500);
        }
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
