import { mapWithConcurrency } from './lib/concurrency';
import {
    deleteConversation as deleteLocalConversation,
    deleteConversations as deleteLocalConversations,
    getConversation as getLocalConversation,
    listConversationSources as listLocalConversationSources,
    listConversationsForPath as listLocalConversationsForPath,
    renderConversationMarkdown as renderLocalConversationMarkdown,
    resolveConversationRef as resolveLocalConversationRef,
} from './lib/conversation-data';
import type {
    ConversationDataLocations,
    ConversationDetail,
    ConversationMessageSelector,
    ConversationPage,
    ConversationSourceInfo,
    ConversationZipDownload,
    DeleteConversationOptions,
    DeleteConversationResult,
    DeleteConversationsOptions,
    DeleteConversationsResult,
    ExportConversationsZipOptions,
    GetConversationOptions,
    ListConversationsForPathOptions,
    ResolvedConversationRef,
} from './lib/conversation-data/types';
import { createConversationMarkdownZip } from './lib/conversation-zip-export';

export type {
    ConversationDataLocations,
    ConversationDeepLinks,
    ConversationDetail,
    ConversationMessage,
    ConversationMessagePhase,
    ConversationMessageRole,
    ConversationMessageSelector,
    ConversationPage,
    ConversationPathMatch,
    ConversationSource,
    ConversationSourceInfo,
    ConversationZipDownload,
    DeleteConversationOptions,
    DeleteConversationResult,
    DeleteConversationsOptions,
    DeleteConversationsResult,
    ExportConversationsZipOptions,
    GetConversationOptions,
    ListConversationsForPathOptions,
    ResolvedConversationRef,
} from './lib/conversation-data/types';

type HttpEnvelope<T> = {
    data?: T;
    error?: {
        code?: string | null;
        message?: string | null;
    } | null;
    meta?: {
        has_next?: boolean | null;
        hasNext?: boolean | null;
        nextCursor?: string | null;
        next_cursor?: string | null;
    } | null;
};

export class SpirachaClientError extends Error {
    readonly status: number | null;

    constructor(message: string, status: number | null = null) {
        super(message);
        this.name = 'SpirachaClientError';
        this.status = status;
    }
}

export type LocalConversationClientOptions = {
    locations?: ConversationDataLocations;
    mode?: 'local';
};

export type HttpConversationClientOptions = {
    baseUrl: string;
    mode: 'http';
};

export type CreateConversationClientOptions = HttpConversationClientOptions | LocalConversationClientOptions;

export type ExportConversationMarkdownOptions = GetConversationOptions;

export type ConversationClient = {
    deleteConversation: (options: DeleteConversationOptions) => Promise<DeleteConversationResult | null>;
    deleteConversations: (options: DeleteConversationsOptions) => Promise<DeleteConversationsResult | null>;
    exportConversationMarkdown: (options: ExportConversationMarkdownOptions) => Promise<string | null>;
    exportConversationsZip: (options: ExportConversationsZipOptions) => Promise<ConversationZipDownload | null>;
    getConversation: (options: GetConversationOptions) => Promise<ConversationDetail | null>;
    listConversations: (options: ListConversationsForPathOptions) => Promise<ConversationPage>;
    listSources: () => Promise<ConversationSourceInfo[]>;
    resolveConversationRef: (ref: string) => Promise<ResolvedConversationRef | null>;
};

const withDefaultLocations = <T extends { locations?: ConversationDataLocations }>(
    options: T,
    locations: ConversationDataLocations | undefined,
): T => {
    return locations && !options.locations ? { ...options, locations } : options;
};

const normalizeBaseUrl = (value: string): URL => {
    try {
        const url = new URL(value);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
            return url;
        }
    } catch {
        // Fall through to a consistent client-facing error.
    }

    throw new SpirachaClientError(`Invalid Spiracha base URL "${value}". Use an http:// or https:// URL.`);
};

const appendOptionalNumber = (url: URL, key: string, value: number | undefined): void => {
    if (value !== undefined) {
        url.searchParams.set(key, String(value));
    }
};

const appendListOptions = (url: URL, options: ListConversationsForPathOptions): void => {
    url.searchParams.set('cwd', options.cwd);
    if (options.cursor) {
        url.searchParams.set('cursor', options.cursor);
    }
    if (options.includeMessages !== undefined) {
        url.searchParams.set('include_messages', String(options.includeMessages));
    }
    if (options.limit !== undefined) {
        url.searchParams.set('limit', String(options.limit));
    }
    if (options.messageSelector) {
        url.searchParams.set('message_selector', options.messageSelector);
    }
    if (options.sources && options.sources !== 'all') {
        url.searchParams.set('source', options.sources.join(','));
    }
    appendOptionalNumber(url, 'updated_after_ms', options.updatedAfterMs);
    appendOptionalNumber(url, 'updated_before_ms', options.updatedBeforeMs);
};

const appendMessageSelector = (url: URL, messageSelector: ConversationMessageSelector | undefined): void => {
    if (messageSelector) {
        url.searchParams.set('message_selector', messageSelector);
    }
};

const httpErrorMessage = async (response: Response): Promise<string> => {
    const text = await response.text();
    if (!text.trim()) {
        return response.statusText || `HTTP ${response.status}`;
    }

    try {
        const parsed = JSON.parse(text) as HttpEnvelope<unknown>;
        return parsed.error?.message || text.trim();
    } catch {
        return text.trim();
    }
};

const fetchResponse = async (url: URL, init?: RequestInit): Promise<Response> => {
    try {
        return await fetch(url, init);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new SpirachaClientError(`Unable to reach Spiracha at ${url.origin}: ${message}`);
    }
};

const assertOkResponse = async (response: Response): Promise<void> => {
    if (response.ok) {
        return;
    }

    throw new SpirachaClientError(
        `Spiracha API request failed (${response.status}): ${await httpErrorMessage(response)}`,
        response.status,
    );
};

const readJsonEnvelope = async <T>(response: Response): Promise<HttpEnvelope<T>> => {
    try {
        return (await response.json()) as HttpEnvelope<T>;
    } catch {
        throw new SpirachaClientError('Spiracha API returned invalid JSON.', response.status);
    }
};

const fetchJson = async <T>(url: URL, init?: RequestInit): Promise<HttpEnvelope<T>> => {
    const response = await fetchResponse(url, init);
    await assertOkResponse(response);
    return readJsonEnvelope(response);
};

const isMissingConversationResponse = async (response: Response): Promise<boolean> => {
    if (response.status !== 404) {
        return false;
    }

    try {
        const envelope = (await response.clone().json()) as HttpEnvelope<unknown>;
        return envelope.error?.code === 'conversation_not_found';
    } catch {
        return false;
    }
};

const fetchJsonOrNull = async <T>(url: URL, init?: RequestInit): Promise<HttpEnvelope<T> | null> => {
    const response = await fetchResponse(url, init);
    if (await isMissingConversationResponse(response)) {
        return null;
    }

    await assertOkResponse(response);
    return readJsonEnvelope(response);
};

const fetchDeleteJsonOrNull = async <T>(url: URL, init?: RequestInit): Promise<HttpEnvelope<T> | null> => {
    const response = await fetchResponse(url, init);
    if (await isMissingConversationResponse(response)) {
        return null;
    }

    if (response.status === 405) {
        try {
            const envelope = (await response.clone().json()) as HttpEnvelope<T>;
            if (envelope.error?.code === 'unsupported_operation') {
                return null;
            }
        } catch {
            // Let the normal error path report malformed error responses.
        }
    }

    await assertOkResponse(response);
    return readJsonEnvelope(response);
};

const fetchTextOrNull = async (url: URL, init?: RequestInit): Promise<string | null> => {
    const response = await fetchResponse(url, init);
    if (await isMissingConversationResponse(response)) {
        return null;
    }

    await assertOkResponse(response);
    return response.text();
};

const fileNameFromContentDisposition = (contentDisposition: string | null, fallback: string) => {
    const encodedMatch = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/iu);
    if (encodedMatch?.[1]) {
        try {
            return decodeURIComponent(encodedMatch[1]);
        } catch {
            return fallback;
        }
    }

    const quotedMatch = contentDisposition?.match(/filename="([^"]+)"/iu);
    return quotedMatch?.[1] || fallback;
};

const fetchZipOrNull = async (url: URL, init?: RequestInit): Promise<ConversationZipDownload | null> => {
    const response = await fetchResponse(url, init);
    if (await isMissingConversationResponse(response)) {
        return null;
    }

    await assertOkResponse(response);
    return {
        blob: await response.blob(),
        fileName: fileNameFromContentDisposition(response.headers.get('Content-Disposition'), 'conversations.zip'),
        mimeType: 'application/zip',
    };
};

const requireData = <T>(envelope: HttpEnvelope<T>, label: string): T => {
    if (envelope.data === undefined) {
        throw new SpirachaClientError(`Spiracha API response did not include ${label}.`);
    }

    return envelope.data;
};

const normalizePage = (envelope: HttpEnvelope<ConversationDetail[]>): ConversationPage => {
    const data = requireData(envelope, 'a data field');
    if (!Array.isArray(data)) {
        throw new SpirachaClientError('Spiracha API response did not include a data array.');
    }

    return {
        data,
        meta: {
            hasNext: envelope.meta?.has_next === true || envelope.meta?.hasNext === true,
            nextCursor: envelope.meta?.nextCursor ?? envelope.meta?.next_cursor ?? null,
        },
    };
};

const makeHttpUrl = (baseUrl: URL, pathname: string): URL => {
    const url = new URL(baseUrl);
    const basePath = url.pathname.replace(/\/+$/u, '');
    url.pathname = `${basePath}/${pathname.replace(/^\/+/, '')}`;
    url.search = '';
    url.hash = '';
    return url;
};

const rejectHttpLocations = (locations: ConversationDataLocations | undefined): void => {
    if (locations) {
        throw new SpirachaClientError('`locations` is only supported by local Spiracha clients.');
    }
};

const buildBatchBody = ({ ids, messageSelector, outputFormat, source }: ExportConversationsZipOptions) => ({
    ids,
    message_selector: messageSelector,
    output_format: outputFormat,
    source,
});

const exportLocalConversationsZip = async (
    exportOptions: ExportConversationsZipOptions,
    locations: ConversationDataLocations | undefined,
) => {
    const options = withDefaultLocations(exportOptions, locations);
    if (options.ids.length > 200) {
        throw new SpirachaClientError('At most 200 conversation ids may be exported at once.');
    }
    const conversations = await mapWithConcurrency(options.ids, 4, (id) =>
        getLocalConversation({
            id,
            locations: options.locations,
            messageSelector: options.messageSelector ?? 'all',
            source: options.source,
        }),
    );

    if (conversations.some((conversation) => conversation === null)) {
        return null;
    }

    return createConversationMarkdownZip({
        entries: conversations.map((conversation, index) => {
            const resolvedConversation = conversation!;
            return {
                fallbackBaseName: `${options.source}-${options.ids[index]}`,
                markdown: renderLocalConversationMarkdown(resolvedConversation, {
                    messageSelector: options.messageSelector ?? 'all',
                }),
                title: resolvedConversation.title,
            };
        }),
        fileBaseName: `${options.source}-conversations-${options.ids.length}`,
    });
};

const makeLocalClient = (options: LocalConversationClientOptions): ConversationClient => ({
    deleteConversation: (deleteOptions) =>
        deleteLocalConversation(withDefaultLocations(deleteOptions, options.locations)),
    deleteConversations: (deleteOptions) =>
        deleteLocalConversations(withDefaultLocations(deleteOptions, options.locations)),
    exportConversationMarkdown: async (getOptions) => {
        const conversation = await getLocalConversation(withDefaultLocations(getOptions, options.locations));
        return conversation
            ? renderLocalConversationMarkdown(conversation, {
                  messageSelector: getOptions.messageSelector,
              })
            : null;
    },
    exportConversationsZip: (exportOptions) => exportLocalConversationsZip(exportOptions, options.locations),
    getConversation: (getOptions) => getLocalConversation(withDefaultLocations(getOptions, options.locations)),
    listConversations: (listOptions) =>
        listLocalConversationsForPath(withDefaultLocations(listOptions, options.locations)),
    listSources: () => listLocalConversationSources(),
    resolveConversationRef: (ref) => resolveLocalConversationRef(ref),
});

const makeHttpClient = (options: HttpConversationClientOptions): ConversationClient => {
    const baseUrl = normalizeBaseUrl(options.baseUrl);

    return {
        deleteConversation: async (deleteOptions) => {
            rejectHttpLocations(deleteOptions.locations);
            const { id, source } = deleteOptions;
            const url = makeHttpUrl(baseUrl, `/api/v1/conversations/${source}/${encodeURIComponent(id)}`);
            const envelope = await fetchDeleteJsonOrNull<DeleteConversationResult>(url, { method: 'DELETE' });
            if (!envelope) {
                return null;
            }
            return requireData(envelope, 'a delete result');
        },
        deleteConversations: async (deleteOptions) => {
            rejectHttpLocations(deleteOptions.locations);
            const envelope = await fetchDeleteJsonOrNull<DeleteConversationsResult>(
                makeHttpUrl(baseUrl, '/api/v1/conversations/delete'),
                {
                    body: JSON.stringify({
                        ids: deleteOptions.ids,
                        source: deleteOptions.source,
                    }),
                    headers: { 'Content-Type': 'application/json' },
                    method: 'POST',
                },
            );
            if (!envelope) {
                return null;
            }
            return requireData(envelope, 'a delete result');
        },
        exportConversationMarkdown: async (getOptions) => {
            rejectHttpLocations(getOptions.locations);
            const { id, messageSelector, source } = getOptions;
            const url = makeHttpUrl(baseUrl, `/api/v1/conversations/${source}/${encodeURIComponent(id)}/export`);
            appendMessageSelector(url, messageSelector);
            return fetchTextOrNull(url);
        },
        exportConversationsZip: async (exportOptions) => {
            rejectHttpLocations(exportOptions.locations);
            return fetchZipOrNull(makeHttpUrl(baseUrl, '/api/v1/conversations/export'), {
                body: JSON.stringify(buildBatchBody(exportOptions)),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            });
        },
        getConversation: async (getOptions) => {
            rejectHttpLocations(getOptions.locations);
            const { id, messageSelector, source } = getOptions;
            const url = makeHttpUrl(baseUrl, `/api/v1/conversations/${source}/${encodeURIComponent(id)}`);
            appendMessageSelector(url, messageSelector);
            const envelope = await fetchJsonOrNull<ConversationDetail>(url);
            if (!envelope) {
                return null;
            }
            return requireData(envelope, 'a conversation');
        },
        listConversations: async (listOptions) => {
            rejectHttpLocations(listOptions.locations);
            const url = makeHttpUrl(baseUrl, '/api/v1/conversations');
            appendListOptions(url, listOptions);
            return normalizePage(await fetchJson<ConversationDetail[]>(url));
        },
        listSources: async () => {
            const envelope = await fetchJson<ConversationSourceInfo[]>(makeHttpUrl(baseUrl, '/api/v1/sources'));
            return requireData(envelope, 'a source list');
        },
        resolveConversationRef: async (ref) => {
            const url = makeHttpUrl(baseUrl, '/api/v1/resolve');
            url.searchParams.set('ref', ref);
            const envelope = await fetchJsonOrNull<ResolvedConversationRef>(url);
            if (!envelope) {
                return null;
            }
            return requireData(envelope, 'a resolved ref');
        },
    };
};

export const createConversationClient = (options: CreateConversationClientOptions = {}): ConversationClient => {
    return options.mode === 'http' ? makeHttpClient(options) : makeLocalClient(options);
};
