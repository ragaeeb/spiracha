import { createHash } from 'node:crypto';
import type { ThreadEvent } from './codex-browser-types';

type JsonRecord = Record<string, unknown>;

export type WebChatFileInput = {
    content: string;
    name: string;
};

export type WebChatImportError = {
    fileName: string;
    message: string;
};

export type WebChatConversationSummary = {
    createdAtMs: number | null;
    fileName: string;
    id: string;
    lastActiveAtMs: number | null;
    messageCount: number;
    model: string | null;
    platform: string;
    sourceConversationId: string | null;
    title: string;
};

export type WebChatConversation = WebChatConversationSummary & {
    events: ThreadEvent[];
};

export type WebChatParseResult = {
    conversations: WebChatConversation[];
    errors: WebChatImportError[];
};

type SizedWebChatConversation = {
    bytes: number;
    conversation: WebChatConversation;
};

type NormalizedMessage = {
    id: string | null;
    model: string | null;
    phase: 'commentary' | 'final_answer' | null;
    reasoning: string[];
    recipient: string | null;
    role: string;
    sourceOrder: number | null;
    text: string;
    timestamp: string | null;
};

type ConversationDraft = {
    createdAtMs: number | null;
    messages: NormalizedMessage[];
    model: string | null;
    platform: string;
    sourceConversationId: string | null;
    title: string | null;
    updatedAtMs: number | null;
};

type ImportedToolEvent = {
    argumentsText: string | null;
    callId: string | null;
    kind: 'call' | 'output';
    name: string | null;
    outputText: string | null;
    sourceOrder?: number;
    timestamp: string | null;
};

type SourceMessage = {
    message: JsonRecord;
    sourceOrder: number;
};

const isRecord = (value: unknown): value is JsonRecord =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | null => {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed || null;
};

const firstString = (...values: unknown[]): string | null => {
    for (const value of values) {
        const text = asString(value);
        if (text) {
            return text;
        }
    }
    return null;
};

const toTimestampMs = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value < 10_000_000_000 ? value * 1000 : value;
    }
    if (typeof value === 'string') {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && value.trim()) {
            return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
        }
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
    }
    if (!isRecord(value)) {
        return null;
    }
    const date = isRecord(value.$date) ? value.$date.$numberLong : value.$date;
    return toTimestampMs(date);
};

const toIsoTimestamp = (value: unknown): string | null => {
    const timestamp = toTimestampMs(value);
    return timestamp === null ? null : new Date(timestamp).toISOString();
};

const normalizeRole = (value: unknown): string => {
    const role = asString(value)?.toLowerCase() ?? 'system';
    if (role === 'human') {
        return 'user';
    }
    if (role === 'ai' || role === 'bot' || role === 'model') {
        return 'assistant';
    }
    if (role === 'function') {
        return 'tool';
    }
    return role;
};

const uniqueStrings = (values: Array<string | null>): string[] => [
    ...new Set(values.filter((value): value is string => Boolean(value))),
];

const pushInVisitOrder = (pending: unknown[], values: unknown[]) => {
    for (let index = values.length - 1; index >= 0; index -= 1) {
        pending.push(values[index]);
    }
};

const visitJsonValues = (root: unknown, visitor: (value: unknown) => void) => {
    const pending = [root];
    while (pending.length > 0) {
        const value = pending.pop();
        visitor(value);
        if (Array.isArray(value)) {
            pushInVisitOrder(pending, value);
        } else if (isRecord(value)) {
            pushInVisitOrder(pending, Object.values(value));
        }
    }
};

const REASONING_TYPES = new Set(['analysis', 'reasoning', 'reasoning_recap', 'thinking', 'thoughts']);
const TOOL_TYPES = new Set(['tool_result', 'tool_use']);

const getBlockType = (value: JsonRecord): string => (firstString(value.type, value.content_type) ?? '').toLowerCase();

const extractTextBlock = (value: unknown): string | null => {
    if (typeof value === 'string') {
        return asString(value);
    }
    if (!isRecord(value)) {
        return null;
    }
    const type = getBlockType(value);
    if (REASONING_TYPES.has(type) || TOOL_TYPES.has(type)) {
        return null;
    }
    return firstString(value.text, value.content, value.output);
};

const joinTextBlocks = (value: unknown): string => {
    const values = Array.isArray(value) ? value : [value];
    return values
        .map(extractTextBlock)
        .filter((text): text is string => Boolean(text))
        .join('\n\n')
        .trim();
};

const extractMessageText = (message: JsonRecord): string => {
    const content = message.content;
    if (typeof content === 'string' || Array.isArray(content)) {
        return joinTextBlocks(content) || (typeof message.text === 'string' ? message.text.trim() : '');
    }
    if (!isRecord(content)) {
        return firstString(message.text, message.message) ?? '';
    }

    const contentType = getBlockType(content);
    const thoughts = Array.isArray(content.thoughts) ? content.thoughts : [];
    if (REASONING_TYPES.has(contentType) && thoughts.length === 0) {
        return '';
    }
    const partsText = joinTextBlocks(content.parts);
    return partsText || firstString(content.content, content.text, message.text, message.message) || '';
};

const extractReasoningBlock = (value: unknown): string | null => {
    if (typeof value === 'string') {
        return asString(value);
    }
    if (!isRecord(value)) {
        return null;
    }
    const type = getBlockType(value);
    if (type && !REASONING_TYPES.has(type)) {
        return null;
    }
    return firstString(value.thinking, value.reasoning, value.content, value.text, value.summary);
};

const extractReasoningValues = (value: unknown): Array<string | null> =>
    Array.isArray(value) ? value.map(extractReasoningBlock) : [extractReasoningBlock(value)];

const extractTypedReasoningBlock = (value: unknown): string | null => {
    if (!isRecord(value) || !REASONING_TYPES.has(getBlockType(value))) {
        return null;
    }
    return extractReasoningBlock(value);
};

const extractPartReasoning = (value: unknown): Array<string | null> => {
    if (!isRecord(value) || !REASONING_TYPES.has(getBlockType(value))) {
        return [];
    }
    const summaries = Array.isArray(value.summaries) ? value.summaries.map(extractReasoningBlock) : [];
    return [extractTypedReasoningBlock(value), ...summaries];
};

const extractReasoning = (message: JsonRecord): string[] => {
    const content = isRecord(message.content) ? message.content : null;
    const metadata = isRecord(message.metadata) ? message.metadata : null;
    const fragments: Array<string | null> = [
        ...extractReasoningValues(message.reasoning),
        ...extractReasoningValues(message.thinking),
        ...extractReasoningValues(message.analysis),
        ...extractReasoningValues(metadata?.reasoning),
        ...extractReasoningValues(metadata?.thinking_trace),
    ];
    if (content) {
        if (Array.isArray(content.thoughts)) {
            fragments.push(...content.thoughts.map(extractReasoningBlock));
        }
        if (Array.isArray(content.parts)) {
            fragments.push(...content.parts.flatMap(extractPartReasoning));
        }
        if (REASONING_TYPES.has(getBlockType(content))) {
            fragments.push(extractReasoningBlock(content.content), ...extractReasoningValues(content.parts));
        }
    }
    if (Array.isArray(message.content)) {
        fragments.push(...message.content.flatMap(extractPartReasoning));
    }
    return uniqueStrings(fragments);
};

const normalizeModel = (value: unknown): string | null => {
    const model = asString(value);
    if (!model || ['auto', 'normal', 'snapshot', 'unknown'].includes(model.toLowerCase())) {
        return null;
    }
    return model;
};

const extractMessageModel = (message: JsonRecord): string | null => {
    const metadata = isRecord(message.metadata) ? message.metadata : {};
    return normalizeModel(
        firstString(
            metadata.resolved_model_slug,
            metadata.model_slug,
            metadata.default_model_slug,
            metadata.qwen_model,
            metadata.model,
            message.model,
        ),
    );
};

const PLATFORM_HINTS: ReadonlyArray<readonly [RegExp, string]> = [
    [/amazon[\W_]*nova|(?:^|[^a-z])nova(?:[^a-z]|$)/i, 'Amazon Nova'],
    [/claude|anthropic/i, 'Claude'],
    [/gemini|bard/i, 'Gemini'],
    [/grok|\bxai\b/i, 'Grok'],
    [/qwen/i, 'Qwen'],
    [/\bglm\b|zhipu/i, 'GLM'],
    [/chatgpt|openai|(^|[^a-z])(gpt|o[1345])(?:[-_.\d]|$)/i, 'ChatGPT'],
    [/deepseek/i, 'DeepSeek'],
    [/mistral/i, 'Mistral'],
    [/perplexity/i, 'Perplexity'],
];

const getMappingPlatformHints = (mapping: unknown): string[] => {
    if (!isRecord(mapping)) {
        return [];
    }
    return Object.values(mapping).flatMap((node) => {
        const message = isRecord(node) && isRecord(node.message) ? node.message : null;
        const metadata = message && isRecord(message.metadata) ? message.metadata : null;
        return metadata ? [...Object.keys(metadata), firstString(metadata.model, metadata.qwen_model) ?? ''] : [];
    });
};

const getPlatformHintText = (root: JsonRecord): string => {
    const rawPayload = isRecord(root.raw_payload) ? root.raw_payload : {};
    return [
        firstString(root.platform, root.provider, root.llm, root.default_model_slug, root.model, root.model_slug) ?? '',
        firstString(rawPayload.platform, rawPayload.provider, rawPayload.model) ?? '',
        ...getMappingPlatformHints(root.mapping),
    ].join(' ');
};

const inferPlatform = (root: JsonRecord, fileName: string): string => {
    if (Array.isArray(root.chat_messages)) {
        return 'Claude';
    }
    if (isRecord(root.conversation) && Array.isArray(root.responses)) {
        return 'Grok';
    }
    const contentPlatform = PLATFORM_HINTS.find(([pattern]) => pattern.test(getPlatformHintText(root)))?.[1];
    return contentPlatform ?? PLATFORM_HINTS.find(([pattern]) => pattern.test(fileName))?.[1] ?? 'Unknown';
};

const normalizeMessage = (
    message: JsonRecord,
    fallbackModel: string | null,
    fallbackId?: string,
    sourceOrder: number | null = null,
): NormalizedMessage => {
    const author = isRecord(message.author) ? message.author : null;
    const metadata = isRecord(message.metadata) ? message.metadata : null;
    const chatgptSdk = metadata && isRecord(metadata.chatgpt_sdk) ? metadata.chatgpt_sdk : null;
    const recipient = asString(message.recipient);
    const text = extractMessageText(message);
    const toolLabel = firstString(chatgptSdk?.resource_name, metadata?.tool_invoking_message);
    return {
        id: firstString(message.id, message.uuid, message._id, fallbackId),
        model: extractMessageModel(message) ?? fallbackModel,
        phase: null,
        reasoning: extractReasoning(message),
        recipient,
        role: normalizeRole(firstString(author?.role, message.role, message.sender)),
        sourceOrder,
        text:
            text ||
            (recipient && recipient.toLowerCase() !== 'all' && toolLabel
                ? JSON.stringify({ resource_name: toolLabel })
                : ''),
        timestamp: toIsoTimestamp(
            message.create_time ?? message.created_at ?? message.timestamp ?? message.update_time ?? message.updated_at,
        ),
    };
};

const getToolResultText = (value: unknown): string => {
    const values = Array.isArray(value) ? value : [value];
    return values
        .map((item) => {
            if (typeof item === 'string') {
                return asString(item);
            }
            if (!isRecord(item)) {
                return null;
            }
            return uniqueStrings([
                asString(item.title),
                asString(item.url),
                asString(item.snippet),
                asString(item.description),
                extractTextBlock(item),
            ]).join('\n');
        })
        .filter((text): text is string => Boolean(text))
        .join('\n\n');
};

const getEmbeddedToolEvents = (message: JsonRecord): ImportedToolEvent[] => {
    const content = message.content;
    const blocks = Array.isArray(content)
        ? content
        : isRecord(content) && Array.isArray(content.parts)
          ? content.parts
          : [];
    const timestamp = toIsoTimestamp(
        message.create_time ?? message.created_at ?? message.timestamp ?? message.update_time ?? message.updated_at,
    );
    return blocks.flatMap<ImportedToolEvent>((block) => {
        if (!isRecord(block)) {
            return [];
        }
        if (getBlockType(block) === 'tool_result') {
            const outputText = getToolResultText(block.content);
            return outputText
                ? [
                      {
                          argumentsText: null,
                          callId: firstString(block.tool_use_id, block.id),
                          kind: 'output',
                          name: null,
                          outputText,
                          timestamp,
                      } satisfies ImportedToolEvent,
                  ]
                : [];
        }
        if (getBlockType(block) !== 'tool_use') {
            return [];
        }
        const name = firstString(block.name, block.tool_name);
        if (!name) {
            return [];
        }
        return [
            {
                argumentsText: JSON.stringify(block.input ?? {}),
                callId: firstString(block.id, block.tool_use_id),
                kind: 'call',
                name,
                outputText: null,
                timestamp,
            },
        ];
    });
};

const GROK_TOOL_CARD_PATTERN = /<xai:tool_usage_card>([\s\S]*?)<\/xai:tool_usage_card>/g;
const getGrokCardValue = (card: string, field: string): string | null =>
    asString(card.match(new RegExp(`<xai:${field}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/xai:${field}>`))?.[1]);

const getGrokResultEvents = (value: unknown): ImportedToolEvent[] =>
    Array.isArray(value)
        ? value.flatMap((result) => {
              if (!isRecord(result) || !Array.isArray(result.web_results)) {
                  return [];
              }
              const outputText = getToolResultText(result.web_results);
              return outputText
                  ? [
                        {
                            argumentsText: null,
                            callId: firstString(result.tool_usage_card_id),
                            kind: 'output',
                            name: null,
                            outputText,
                            timestamp: null,
                        } satisfies ImportedToolEvent,
                    ]
                  : [];
          })
        : [];

const getGrokCallEvents = (value: string): ImportedToolEvent[] =>
    [...value.matchAll(GROK_TOOL_CARD_PATTERN)].flatMap((match) => {
        const card = match[1] ?? '';
        const name = getGrokCardValue(card, 'tool_name');
        const argumentsText = getGrokCardValue(card, 'tool_args');
        return name && argumentsText
            ? [
                  {
                      argumentsText,
                      callId: getGrokCardValue(card, 'tool_usage_card_id'),
                      kind: 'call',
                      name,
                      outputText: null,
                      timestamp: null,
                  } satisfies ImportedToolEvent,
              ]
            : [];
    });

const pairGrokToolEvents = (calls: ImportedToolEvent[], results: ImportedToolEvent[]): ImportedToolEvent[] => {
    const resultsByCallId = new Map<string, ImportedToolEvent[]>();
    const unpairedResults: ImportedToolEvent[] = [];
    for (const result of results) {
        if (!result.callId) {
            unpairedResults.push(result);
            continue;
        }
        const matchingResults = resultsByCallId.get(result.callId) ?? [];
        matchingResults.push(result);
        resultsByCallId.set(result.callId, matchingResults);
    }
    const paired = calls.flatMap((call) => {
        const matchingResults = call.callId ? (resultsByCallId.get(call.callId) ?? []) : [];
        if (call.callId) {
            resultsByCallId.delete(call.callId);
        }
        return [call, ...matchingResults];
    });
    return [...paired, ...unpairedResults, ...[...resultsByCallId.values()].flat()];
};

const getGrokToolEvents = (rawPayload: unknown): ImportedToolEvent[] => {
    const events: ImportedToolEvent[] = [];
    visitJsonValues(rawPayload, (value) => {
        if (!isRecord(value) || typeof value.tool_usage_card !== 'string') {
            return;
        }
        events.push(
            ...pairGrokToolEvents(
                getGrokCallEvents(value.tool_usage_card),
                getGrokResultEvents(value.tool_usage_card_results),
            ),
        );
    });
    return events;
};

const getQwenToolEvents = (rawPayload: unknown): ImportedToolEvent[] => {
    const events: ImportedToolEvent[] = [];
    let searchIndex = 0;
    visitJsonValues(rawPayload, (value) => {
        if (!isRecord(value) || value.deep_research === undefined) {
            return;
        }
        visitJsonValues(value.deep_research, (research) => {
            const query = isRecord(research) ? asString(research.query) : null;
            if (!query || !isRecord(research)) {
                return;
            }
            const callId = `qwen-web-search:${createHash('sha256').update(query).digest('hex').slice(0, 32)}:${searchIndex}`;
            searchIndex += 1;
            events.push({
                argumentsText: JSON.stringify({ query }),
                callId,
                kind: 'call',
                name: 'web_search',
                outputText: null,
                timestamp: null,
            });
            const outputText = getToolResultText(research.webSites);
            if (outputText) {
                events.push({
                    argumentsText: null,
                    callId,
                    kind: 'output',
                    name: null,
                    outputText,
                    timestamp: null,
                });
            }
        });
    });
    return events;
};

const getGeminiToolCalls = (rawPayload: unknown): ImportedToolEvent[] => {
    const calls: ImportedToolEvent[] = [];
    let hasResearchTrace = false;
    visitJsonValues(rawPayload, (value) => {
        if (typeof value === 'string' && /\bresearching websites\b/i.test(value)) {
            hasResearchTrace = true;
        }
        if (isRecord(value) && Object.keys(value).some((key) => /grounding|citation|web.?search/i.test(key))) {
            hasResearchTrace = true;
        }
        if (
            Array.isArray(value) &&
            value.some((item) => typeof item === 'string' && !/^https?:\/\//i.test(item)) &&
            value.some(
                (item) =>
                    Array.isArray(item) &&
                    item.some((nested) => typeof nested === 'string' && /^https?:\/\//i.test(nested)),
            )
        ) {
            hasResearchTrace = true;
        }
        if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || !URL.canParse(value)) {
            return;
        }
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        if (
            host === 'gemini.google.com' ||
            host === 'gstatic.com' ||
            host.endsWith('.gstatic.com') ||
            host === 'googleusercontent.com' ||
            host.endsWith('.googleusercontent.com')
        ) {
            return;
        }
        calls.push({
            argumentsText: JSON.stringify({ url: value }),
            callId: null,
            kind: 'call',
            name: 'browse_page',
            outputText: null,
            timestamp: null,
        });
    });
    return hasResearchTrace ? calls : [];
};

const NOVA_SEARCH_PATTERN = /^🔍\s+Searching for:\s*([\s\S]+)$/;
const NOVA_RESULTS_PATTERN = /^🔍\s+Retrieved results:\s*([\s\S]+)$/;
const NOVA_NAVIGATION_PATTERN = /^🌎\s+Navigating to:\s*([\s\S]+)$/;
const MARKDOWN_URL_PATTERN = /\]\((https?:\/\/[^)]+)\)/g;

const getNovaReasoningTexts = (interaction: JsonRecord): string[] =>
    (Array.isArray(interaction.messages) ? interaction.messages : []).flatMap((message) =>
        isRecord(message) && Array.isArray(message.content)
            ? message.content.flatMap((content) =>
                  isRecord(content) && Array.isArray(content.reasoningBlocks)
                      ? content.reasoningBlocks
                            .map((block) => (isRecord(block) ? asString(block.text) : null))
                            .filter((text): text is string => Boolean(text))
                      : [],
              )
            : [],
    );

const getNovaInteractionToolEvents = (interaction: JsonRecord, interactionIndex: number): ImportedToolEvent[] => {
    const interactionId = firstString(interaction.interactionId) ?? `interaction-${interactionIndex}`;
    let searchIndex = 0;
    let navigationIndex = 0;
    const pendingSearchCallIds: string[] = [];
    const entries = getNovaReasoningTexts(interaction).flatMap((text) => text.split(/\r?\n(?=[🔍🌎]\s+)/u));
    return entries.flatMap<ImportedToolEvent>((text) => {
        const query = asString(text.match(NOVA_SEARCH_PATTERN)?.[1]);
        if (query) {
            const callId = `${interactionId}:web-search:${searchIndex}`;
            pendingSearchCallIds.push(callId);
            searchIndex += 1;
            return [
                {
                    argumentsText: JSON.stringify({ query }),
                    callId,
                    kind: 'call',
                    name: 'web_search',
                    outputText: null,
                    timestamp: null,
                } satisfies ImportedToolEvent,
            ];
        }
        const results = asString(text.match(NOVA_RESULTS_PATTERN)?.[1]);
        if (results) {
            const callId = pendingSearchCallIds.shift() ?? null;
            return [
                {
                    argumentsText: null,
                    callId,
                    kind: 'output',
                    name: null,
                    outputText: results,
                    timestamp: null,
                } satisfies ImportedToolEvent,
            ];
        }
        const destination = asString(text.match(NOVA_NAVIGATION_PATTERN)?.[1]);
        if (!destination) {
            return [];
        }
        const urls = [...destination.matchAll(MARKDOWN_URL_PATTERN)].map((match) => match[1]!);
        const callId = `${interactionId}:browse-page:${navigationIndex}`;
        navigationIndex += 1;
        return [
            {
                argumentsText: JSON.stringify({ url: urls[0] ?? destination, urls }),
                callId,
                kind: 'call',
                name: 'browse_page',
                outputText: null,
                timestamp: null,
            } satisfies ImportedToolEvent,
        ];
    });
};

const getNovaToolEvents = (rawPayload: unknown): ImportedToolEvent[] =>
    isRecord(rawPayload) && Array.isArray(rawPayload.conversationInteractions)
        ? rawPayload.conversationInteractions.flatMap((interaction, index) =>
              isRecord(interaction) ? getNovaInteractionToolEvents(interaction, index) : [],
          )
        : [];

const addImportedToolEvents = (messages: NormalizedMessage[], toolEvents: ImportedToolEvent[]): NormalizedMessage[] => {
    const seen = new Set<string>();
    const toolMessages = toolEvents.flatMap((event) => {
        const text = event.kind === 'call' ? event.argumentsText : event.outputText;
        const key = `${event.kind}\0${event.callId ?? ''}\0${event.name ?? ''}\0${text ?? ''}`;
        if (seen.has(key)) {
            return [];
        }
        seen.add(key);
        return [
            {
                id: event.callId,
                model: null,
                phase: null,
                reasoning: [],
                recipient: event.name,
                role: event.kind === 'call' ? 'assistant' : 'tool',
                sourceOrder: event.sourceOrder ?? null,
                text: text ?? '',
                timestamp: event.timestamp,
            } satisfies NormalizedMessage,
        ];
    });
    const positionedToolMessages = toolMessages.filter((message) => message.sourceOrder !== null);
    const unpositionedToolMessages = toolMessages.filter((message) => message.sourceOrder === null);
    const orderedMessages = [...positionedToolMessages, ...messages]
        .map((message, index) => ({ index, message }))
        .sort(
            (left, right) =>
                (left.message.sourceOrder ?? Number.POSITIVE_INFINITY) -
                    (right.message.sourceOrder ?? Number.POSITIVE_INFINITY) || left.index - right.index,
        )
        .map(({ message }) => message);
    const finalIndex = orderedMessages.findLastIndex((message) => message.phase === 'final_answer');
    const insertionIndex = finalIndex === -1 ? orderedMessages.length : finalIndex;
    return [
        ...orderedMessages.slice(0, insertionIndex),
        ...unpositionedToolMessages,
        ...orderedMessages.slice(insertionIndex),
    ];
};

const getProviderToolEvents = (
    root: JsonRecord,
    platform: string,
    sourceMessages: SourceMessage[],
): ImportedToolEvent[] => {
    const embedded = sourceMessages.flatMap(({ message, sourceOrder }) =>
        getEmbeddedToolEvents(message).map((event) => ({ ...event, sourceOrder })),
    );
    if (platform === 'Grok') {
        return [...embedded, ...getGrokToolEvents(root.raw_payload)];
    }
    if (platform === 'Qwen') {
        return [...embedded, ...getQwenToolEvents(root.raw_payload)];
    }
    if (platform === 'Gemini') {
        return [...embedded, ...getGeminiToolCalls(root.raw_payload)];
    }
    if (platform === 'Amazon Nova') {
        return [...embedded, ...getNovaToolEvents(root.raw_payload)];
    }
    return embedded;
};

const getDeepResearchReport = (message: JsonRecord): JsonRecord | null => {
    const metadata = isRecord(message.metadata) ? message.metadata : null;
    const chatgptSdk = metadata && isRecord(metadata.chatgpt_sdk) ? metadata.chatgpt_sdk : null;
    const widgetStateValue = chatgptSdk?.widget_state;
    let widgetState: unknown = widgetStateValue;
    if (typeof widgetStateValue === 'string') {
        try {
            widgetState = JSON.parse(widgetStateValue);
        } catch {
            return null;
        }
    }
    return isRecord(widgetState) && isRecord(widgetState.report_message) ? widgetState.report_message : null;
};

const isToolCallMessage = (message: NormalizedMessage): boolean =>
    message.role === 'assistant' && message.recipient !== null && message.recipient.toLowerCase() !== 'all';

const classifyAssistantPhases = (messages: NormalizedMessage[]): NormalizedMessage[] => {
    const finalIndexes = new Set<number>();
    let latestAssistantIndex: number | null = null;
    const flush = () => {
        if (latestAssistantIndex !== null) {
            finalIndexes.add(latestAssistantIndex);
        }
        latestAssistantIndex = null;
    };
    for (const [index, message] of messages.entries()) {
        if (message.role === 'user') {
            flush();
        } else if (isToolCallMessage(message)) {
            latestAssistantIndex = null;
        } else if (message.role === 'assistant' && message.text) {
            latestAssistantIndex = index;
        }
    }
    flush();
    return messages.map((message, index) => ({
        ...message,
        phase:
            message.role === 'assistant' && message.text && !isToolCallMessage(message)
                ? finalIndexes.has(index)
                    ? 'final_answer'
                    : 'commentary'
                : null,
    }));
};

const getMappingChain = (root: JsonRecord): Array<{ id: string; message: JsonRecord }> => {
    if (!isRecord(root.mapping)) {
        return [];
    }
    const mapping = root.mapping;
    const leafIds = Object.entries(mapping)
        .filter(([, node]) => isRecord(node) && (!Array.isArray(node.children) || node.children.length === 0))
        .map(([id]) => id);
    let currentId = firstString(root.current_node);
    if (!currentId || !isRecord(mapping[currentId])) {
        currentId = leafIds.at(-1) ?? Object.keys(mapping).at(-1) ?? null;
    }
    const chain: Array<{ id: string; message: JsonRecord }> = [];
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const node = mapping[currentId];
        if (!isRecord(node)) {
            break;
        }
        if (isRecord(node.message)) {
            chain.unshift({ id: currentId, message: node.message });
        }
        currentId = firstString(node.parent);
    }
    return chain;
};

const parseMappingConversation = (root: JsonRecord, fileName: string): ConversationDraft | null => {
    const chain = getMappingChain(root);
    if (chain.length === 0) {
        return null;
    }
    const rootModel = normalizeModel(firstString(root.default_model_slug, root.model));
    const sourceMessages: SourceMessage[] = [];
    const normalizedMessages = classifyAssistantPhases(
        chain.flatMap(({ id, message }, index) => {
            const sourceOrder = index * 2;
            const normalized = normalizeMessage(message, rootModel, id, sourceOrder);
            const report = getDeepResearchReport(message);
            sourceMessages.push({ message, sourceOrder });
            if (report) {
                sourceMessages.push({ message: report, sourceOrder: sourceOrder + 1 });
            }
            const reportMessage = report
                ? {
                      ...normalizeMessage(
                          report,
                          normalized.model ?? rootModel,
                          `${id}-deep-research-report`,
                          sourceOrder + 1,
                      ),
                      // ChatGPT report widgets may expose legacy internal labels such as gpt-5-thinking.
                      model: normalized.model ?? rootModel,
                  }
                : null;
            return [normalized, reportMessage].filter((item): item is NormalizedMessage =>
                Boolean(item && (item.text || item.reasoning.length > 0)),
            );
        }),
    );
    const model = [...normalizedMessages].reverse().find((message) => message.model)?.model ?? rootModel;
    const platform = inferPlatform({ ...root, model }, fileName);
    const messages = classifyAssistantPhases(
        addImportedToolEvents(normalizedMessages, getProviderToolEvents(root, platform, sourceMessages)),
    );
    if (messages.length === 0) {
        return null;
    }
    return {
        createdAtMs: toTimestampMs(root.create_time ?? root.created_at),
        messages,
        model,
        platform,
        sourceConversationId: firstString(root.conversation_id, root.id, root.uuid),
        title: firstString(root.title, root.name),
        updatedAtMs: toTimestampMs(root.update_time ?? root.updated_at),
    };
};

const extractGrokReasoning = (response: JsonRecord): string[] => {
    const traces = Array.isArray(response.agent_thinking_traces)
        ? response.agent_thinking_traces.map((trace) => (isRecord(trace) ? firstString(trace.thinking_trace) : null))
        : [];
    const steps = Array.isArray(response.steps)
        ? response.steps.flatMap((step) => {
              if (!isRecord(step) || !Array.isArray(step.tag_order) || !isRecord(step.tagged_text)) {
                  return [];
              }
              const taggedText = step.tagged_text;
              return step.tag_order.map((tag) => (typeof tag === 'string' ? firstString(taggedText[tag]) : null));
          })
        : [];
    return uniqueStrings([...traces, ...steps]);
};

const parseGrokConversation = (root: JsonRecord): ConversationDraft | null => {
    if (!isRecord(root.conversation) || !Array.isArray(root.responses)) {
        return null;
    }
    const conversation = root.conversation;
    const sourceMessages: SourceMessage[] = [];
    const normalizedMessages = classifyAssistantPhases(
        root.responses.flatMap((entry, index) => {
            const response = isRecord(entry) && isRecord(entry.response) ? entry.response : null;
            if (!response) {
                return [];
            }
            sourceMessages.push({ message: response, sourceOrder: index });
            const requestMetadata =
                isRecord(response.metadata) && isRecord(response.metadata.request_metadata)
                    ? response.metadata.request_metadata
                    : null;
            const model = normalizeModel(firstString(requestMetadata?.model, response.model));
            const message = normalizeMessage(
                {
                    ...response,
                    content: firstString(response.message),
                    id: firstString(response._id, response.id),
                    reasoning: extractGrokReasoning(response),
                    role: response.sender,
                },
                model,
                `response-${index}`,
                index,
            );
            return message.text || message.reasoning.length > 0 ? [message] : [];
        }),
    );
    const messages = classifyAssistantPhases(
        addImportedToolEvents(normalizedMessages, getProviderToolEvents(root, 'Grok', sourceMessages)),
    );
    if (messages.length === 0) {
        return null;
    }
    return {
        createdAtMs: toTimestampMs(conversation.create_time),
        messages,
        model: [...messages].reverse().find((message) => message.model)?.model ?? null,
        platform: 'Grok',
        sourceConversationId: firstString(conversation.id, conversation.uuid),
        title: firstString(conversation.title, conversation.name),
        updatedAtMs: toTimestampMs(conversation.modify_time ?? conversation.update_time),
    };
};

const resolveMessageArray = (root: JsonRecord): unknown[] | null => {
    if (Array.isArray(root.messages)) {
        return root.messages;
    }
    if (Array.isArray(root.chat_messages)) {
        return root.chat_messages;
    }
    const conversation = isRecord(root.conversation) ? root.conversation : null;
    if (conversation && Array.isArray(conversation.messages)) {
        return conversation.messages;
    }
    const data = isRecord(root.data) ? root.data : null;
    return data && Array.isArray(data.messages) ? data.messages : null;
};

const parseMessageArrayConversation = (root: JsonRecord, fileName: string): ConversationDraft | null => {
    const rawMessages = resolveMessageArray(root);
    if (!rawMessages) {
        return null;
    }
    const rootModel = normalizeModel(firstString(root.model, root.model_slug, root.default_model_slug));
    const sourceMessages: SourceMessage[] = [];
    const normalizedMessages = classifyAssistantPhases(
        rawMessages.flatMap((value, index) => {
            if (!isRecord(value)) {
                return [];
            }
            sourceMessages.push({ message: value, sourceOrder: index });
            const message = normalizeMessage(value, rootModel, `message-${index}`, index);
            return message.text || message.reasoning.length > 0 ? [message] : [];
        }),
    );
    const model = [...normalizedMessages].reverse().find((message) => message.model)?.model ?? rootModel;
    const platform = inferPlatform({ ...root, model }, fileName);
    const messages = classifyAssistantPhases(
        addImportedToolEvents(normalizedMessages, getProviderToolEvents(root, platform, sourceMessages)),
    );
    if (messages.length === 0) {
        return null;
    }
    return {
        createdAtMs: toTimestampMs(root.create_time ?? root.created_at),
        messages,
        model,
        platform,
        sourceConversationId: firstString(root.conversation_id, root.chat_id, root.id, root.uuid),
        title: firstString(root.title, root.name, root.summary),
        updatedAtMs: toTimestampMs(root.update_time ?? root.updated_at),
    };
};

const parseCommonConversation = (root: JsonRecord, fileName: string): ConversationDraft | null => {
    const prompt = asString(root.prompt);
    const response = asString(root.response);
    if (!prompt && !response) {
        return null;
    }
    const model = normalizeModel(root.model);
    const messages: NormalizedMessage[] = [];
    if (prompt) {
        messages.push({
            id: null,
            model: null,
            phase: null,
            reasoning: [],
            recipient: null,
            role: 'user',
            sourceOrder: 0,
            text: prompt,
            timestamp: null,
        });
    }
    if (response) {
        const reasoning = Array.isArray(root.reasoning)
            ? uniqueStrings(root.reasoning.map(asString))
            : uniqueStrings([asString(root.reasoning)]);
        messages.push({
            id: null,
            model,
            phase: 'final_answer',
            reasoning,
            recipient: null,
            role: 'assistant',
            sourceOrder: 1,
            text: response,
            timestamp: null,
        });
    }
    return {
        createdAtMs: toTimestampMs(root.created_at),
        messages,
        model,
        platform: inferPlatform(root, fileName),
        sourceConversationId: firstString(root.conversation_id, root.id, root.uuid),
        title: firstString(root.title, root.name),
        updatedAtMs: toTimestampMs(root.updated_at),
    };
};

const parseConversation = (value: unknown, fileName: string): ConversationDraft | null => {
    if (!isRecord(value)) {
        return null;
    }
    const parsed =
        parseMappingConversation(value, fileName) ??
        parseGrokConversation(value) ??
        parseMessageArrayConversation(value, fileName) ??
        parseCommonConversation(value, fileName);
    if (parsed) {
        return parsed;
    }
    for (const nested of [value.data, value.payload]) {
        const nestedParsed = parseConversation(nested, fileName);
        if (nestedParsed) {
            return nestedParsed;
        }
    }
    return null;
};

const isMessageLike = (value: unknown): boolean => {
    if (!isRecord(value)) {
        return false;
    }
    return Boolean(value.role || value.sender || (isRecord(value.author) && value.author.role));
};

const parsePayload = (value: unknown, fileName: string): ConversationDraft[] => {
    if (Array.isArray(value)) {
        if (value.length > 0 && value.every(isMessageLike)) {
            const parsed = parseMessageArrayConversation({ messages: value }, fileName);
            return parsed ? [parsed] : [];
        }
        return value
            .map((item) => parseConversation(item, fileName))
            .filter((item): item is ConversationDraft => item !== null);
    }
    if (!isRecord(value)) {
        return [];
    }
    const conversations = Array.isArray(value.conversations) ? value.conversations : null;
    if (conversations) {
        return conversations
            .map((item) => parseConversation(item, fileName))
            .filter((item): item is ConversationDraft => item !== null);
    }
    const parsed = parseConversation(value, fileName);
    return parsed ? [parsed] : [];
};

const buildReasoningEvent = (message: NormalizedMessage, platform: string, sequence: number): ThreadEvent | null =>
    message.reasoning.length === 0
        ? null
        : {
              content: message.reasoning.join('\n\n'),
              hasEncryptedContent: false,
              kind: 'reasoning',
              raw: { messageId: message.id, platform, source: 'web_import' },
              sequence,
              summary: message.reasoning,
              timestamp: message.timestamp,
          };

const buildMessageEvent = (message: NormalizedMessage, platform: string, sequence: number): ThreadEvent | null =>
    message.text
        ? {
              isHiddenByDefault: message.role !== 'assistant' && message.role !== 'user',
              kind: 'message',
              memoryCitation: null,
              model: message.model,
              phase: message.phase,
              raw: { messageId: message.id, platform, source: 'web_import' },
              role: message.role,
              sequence,
              text: message.text,
              timestamp: message.timestamp,
              variant:
                  message.role === 'user' ? 'user_message' : message.role === 'assistant' ? 'agent_message' : 'message',
          }
        : null;

const TOOL_LABEL_KEYS = ['query', 'q', 'url', 'ref_id', 'path', 'resource_name', 'toolLabel'] as const;

const getToolArgumentLabel = (value: unknown): string | null => {
    const pending = [value];
    while (pending.length > 0) {
        const current = pending.shift();
        if (Array.isArray(current)) {
            pending.push(...current);
            continue;
        }
        if (!isRecord(current)) {
            continue;
        }
        for (const key of TOOL_LABEL_KEYS) {
            const label = asString(current[key]);
            if (label) {
                return label;
            }
        }
        pending.push(...Object.values(current));
    }
    return null;
};

const buildToolEvent = (message: NormalizedMessage, platform: string, sequence: number): ThreadEvent | null => {
    if (!message.text) {
        return null;
    }
    const raw = { messageId: message.id, platform, source: 'web_import' };
    if (isToolCallMessage(message)) {
        let argumentsParseFailed = false;
        let command = message.text;
        try {
            command = getToolArgumentLabel(JSON.parse(message.text)) ?? message.text;
        } catch {
            argumentsParseFailed = true;
        }
        return {
            argumentsParseFailed,
            argumentsText: message.text,
            callId: message.id,
            command,
            kind: 'tool_call',
            name: message.recipient ?? 'tool',
            raw,
            sequence,
            timestamp: message.timestamp,
            workdir: null,
        };
    }
    if (message.role === 'tool') {
        return {
            callId: message.id,
            exitCode: null,
            kind: 'tool_output',
            outputText: message.text,
            raw,
            sequence,
            summary: message.text,
            timestamp: message.timestamp,
            wallTime: null,
        };
    }
    return null;
};

const messagesToEvents = (messages: NormalizedMessage[], platform: string): ThreadEvent[] => {
    const events: ThreadEvent[] = [];
    for (const message of messages) {
        const reasoningEvent = buildReasoningEvent(message, platform, events.length);
        if (reasoningEvent) {
            events.push(reasoningEvent);
        }
        const messageEvent =
            buildToolEvent(message, platform, events.length) ?? buildMessageEvent(message, platform, events.length);
        if (messageEvent) {
            events.push(messageEvent);
        }
    }
    return events;
};

const fallbackTitle = (draft: ConversationDraft, fileName: string): string => {
    const firstUserText = draft.messages.find((message) => message.role === 'user' && message.text)?.text;
    if (firstUserText) {
        return firstUserText.length > 80 ? `${firstUserText.slice(0, 77)}…` : firstUserText;
    }
    return fileName.replace(/\.json$/i, '') || 'Imported conversation';
};

const finalizeConversation = (draft: ConversationDraft, fileName: string): WebChatConversation => {
    const events = messagesToEvents(draft.messages, draft.platform);
    const eventTimestamps = draft.messages
        .map((message) => toTimestampMs(message.timestamp))
        .filter((value): value is number => value !== null);
    const createdAtMs = draft.createdAtMs ?? (eventTimestamps.length > 0 ? Math.min(...eventTimestamps) : null);
    const lastActiveAtMs =
        draft.updatedAtMs ?? (eventTimestamps.length > 0 ? Math.max(...eventTimestamps) : createdAtMs);
    const identity = draft.sourceConversationId ?? JSON.stringify({ events, fileName, title: draft.title });
    const id = createHash('sha256').update(draft.platform).update('\0').update(identity).digest('hex').slice(0, 32);
    return {
        createdAtMs,
        events,
        fileName,
        id,
        lastActiveAtMs,
        messageCount: events.filter((event) => event.kind === 'message').length,
        model: draft.model,
        platform: draft.platform,
        sourceConversationId: draft.sourceConversationId,
        title: draft.title ?? fallbackTitle(draft, fileName),
    };
};

const parseSizedWebChatFiles = (
    files: WebChatFileInput[],
): { conversations: SizedWebChatConversation[]; errors: WebChatImportError[] } => {
    const conversations = new Map<string, SizedWebChatConversation>();
    const errors: WebChatImportError[] = [];
    for (const file of files) {
        let value: unknown;
        try {
            value = JSON.parse(file.content);
        } catch {
            errors.push({ fileName: file.name, message: 'File is not valid JSON.' });
            continue;
        }
        const drafts = parsePayload(value, file.name);
        if (drafts.length === 0) {
            errors.push({ fileName: file.name, message: 'No supported web conversation was found.' });
            continue;
        }
        const bytes = Math.ceil(Buffer.byteLength(file.content) / drafts.length);
        for (const draft of drafts) {
            const conversation = finalizeConversation(draft, file.name);
            conversations.set(conversation.id, { bytes, conversation });
        }
    }
    return { conversations: [...conversations.values()], errors };
};

export const parseWebChatFiles = (files: WebChatFileInput[]): WebChatParseResult => {
    const result = parseSizedWebChatFiles(files);
    return { conversations: result.conversations.map(({ conversation }) => conversation), errors: result.errors };
};

const MAX_IMPORTED_WEB_CHAT_BYTES = 128 * 1024 * 1024;
const importedWebChats = new Map<string, { bytes: number; conversation: WebChatConversation }>();
let importedWebChatBytes = 0;

const retainImportedWebChat = (conversation: WebChatConversation, bytes: number) => {
    const previous = importedWebChats.get(conversation.id);
    if (previous) {
        importedWebChatBytes -= previous.bytes;
        importedWebChats.delete(conversation.id);
    }
    importedWebChats.set(conversation.id, { bytes, conversation });
    importedWebChatBytes += bytes;
    while (importedWebChatBytes > MAX_IMPORTED_WEB_CHAT_BYTES) {
        const oldestId = importedWebChats.keys().next().value;
        if (!oldestId) {
            break;
        }
        const oldest = importedWebChats.get(oldestId);
        importedWebChats.delete(oldestId);
        importedWebChatBytes -= oldest?.bytes ?? 0;
    }
};

const toWebChatSummary = ({ events: _events, ...summary }: WebChatConversation): WebChatConversationSummary => summary;

export const importWebChatFiles = (files: WebChatFileInput[]): WebChatParseResult => {
    const result = parseSizedWebChatFiles(files);
    for (const { bytes, conversation } of result.conversations) {
        retainImportedWebChat(conversation, bytes);
    }
    return { conversations: result.conversations.map(({ conversation }) => conversation), errors: result.errors };
};

export const listImportedWebChats = (): WebChatConversationSummary[] =>
    [...importedWebChats.values()]
        .map(({ conversation }) => conversation)
        .sort((left, right) => (right.lastActiveAtMs ?? 0) - (left.lastActiveAtMs ?? 0))
        .map(toWebChatSummary);

export const getImportedWebChat = (id: string): WebChatConversation | null =>
    importedWebChats.get(id)?.conversation ?? null;

export const getImportedWebChatSummary = (id: string): WebChatConversationSummary | null => {
    const conversation = getImportedWebChat(id);
    return conversation ? toWebChatSummary(conversation) : null;
};
