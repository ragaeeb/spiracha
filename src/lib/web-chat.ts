import type { ThreadEvent } from './codex-browser-types';
import { sha256Hex } from './sha256';

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

export type WebChatArtifact = {
    id: string;
    title: string;
    content: string;
};

export type WebChatConversation = WebChatConversationSummary & {
    artifacts: WebChatArtifact[];
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
    artifacts?: WebChatArtifact[];
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
    sourceId?: string;
    sourceOrder: number;
};

type ClaudeArtifactCandidate = {
    content: string;
    id: string | null;
    path: string;
    title: string;
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
        if (
            REASONING_TYPES.has(getBlockType(content)) &&
            !(Array.isArray(content.thoughts) && content.thoughts.length > 0)
        ) {
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
    [/\bmeta(?:[\W_]+ai)\b|\bmuse(?:[\W_]+spark)?\b/i, 'Meta'],
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

const getQwenToolEvents = async (rawPayload: unknown): Promise<ImportedToolEvent[]> => {
    const searches: { query: string; research: JsonRecord }[] = [];
    visitJsonValues(rawPayload, (value) => {
        if (!isRecord(value) || value.deep_research === undefined) {
            return;
        }
        visitJsonValues(value.deep_research, (research) => {
            const query = isRecord(research) ? asString(research.query) : null;
            if (query && isRecord(research)) {
                searches.push({ query, research });
            }
        });
    });
    const events: ImportedToolEvent[] = [];
    for (const [searchIndex, { query, research }] of searches.entries()) {
        const callId = `qwen-web-search:${(await sha256Hex(query)).slice(0, 32)}:${searchIndex}`;
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
            events.push({ argumentsText: null, callId, kind: 'output', name: null, outputText, timestamp: null });
        }
    }
    return events;
};

type QwenCitationMatch = {
    end: number;
    numbers: number[];
    start: number;
};

type QwenReferences = JsonRecord | unknown[];

const getQwenRawMessage = (rawPayload: unknown, messageId: string): JsonRecord | null => {
    const data = isRecord(rawPayload) && isRecord(rawPayload.data) ? rawPayload.data : null;
    const chat = data && isRecord(data.chat) ? data.chat : null;
    const history = chat && isRecord(chat.history) ? chat.history : null;
    const messages = history && isRecord(history.messages) ? history.messages : null;
    const message = messages?.[messageId];
    return isRecord(message) && firstString(message.id) === messageId ? message : null;
};

const getQwenReportBody = (message: JsonRecord): string | null => {
    const content = isRecord(message.content) ? message.content : null;
    const parts = content && Array.isArray(content.parts) ? content.parts : null;
    return parts?.length === 1 && typeof parts[0] === 'string' ? parts[0] : null;
};

const getQwenAnswerReferences = (entry: JsonRecord): QwenReferences | null => {
    const extra = isRecord(entry.extra) ? entry.extra : null;
    const research = extra && isRecord(extra.deep_research) ? extra.deep_research : null;
    return research && (Array.isArray(research.references) || isRecord(research.references))
        ? research.references
        : null;
};

const getQwenAnswerEntry = (rawMessage: JsonRecord, body: string): JsonRecord | null => {
    const entries = Array.isArray(rawMessage.content_list) ? rawMessage.content_list : [];
    const candidates = entries.filter((entry): entry is JsonRecord => {
        if (!isRecord(entry) || entry.phase !== 'answer' || entry.status !== 'finished' || entry.role !== 'assistant') {
            return false;
        }
        return entry.content === body && getQwenAnswerReferences(entry) !== null;
    });
    return candidates.length === 1 ? candidates[0]! : null;
};

const getQwenMarkdownTitle = (rawMessage: JsonRecord): string | null => {
    const entries = Array.isArray(rawMessage.content_list) ? rawMessage.content_list : [];
    const names = uniqueStrings(
        entries.flatMap((entry) => {
            if (
                !isRecord(entry) ||
                entry.phase !== 'PdfMdGen' ||
                entry.status !== 'finished' ||
                entry.role !== 'assistant'
            ) {
                return [];
            }
            const extra = isRecord(entry.extra) ? entry.extra : null;
            const research = extra && isRecord(extra.deep_research) ? extra.deep_research : null;
            const markdown = research && isRecord(research.md) ? research.md : null;
            return [firstString(markdown?.name)];
        }),
    );
    if (names.length > 1) {
        return null;
    }
    const name = names[0];
    if (!name) {
        return 'Research report.md';
    }
    return /\.(?:md|markdown)$/i.test(name) ? name : `${name}.md`;
};

const isSafeQwenReferenceUrl = (value: unknown): value is string => {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || !URL.canParse(value)) {
        return false;
    }
    return ![...value].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 0x20 || codePoint === 0x7f || '()[]<>`"\\'.includes(character);
    });
};

const getQwenReferenceIndex = (reference: JsonRecord): number | null => {
    const index = reference.index_number;
    return typeof index === 'number' && Number.isSafeInteger(index) && index > 0 ? index : null;
};

const getQwenCitedUrls = (references: QwenReferences, citedNumbers: Set<number>): Map<number, string> | null => {
    const urlsByNumber = new Map<number, Set<string>>();
    const referenceValues = Array.isArray(references) ? references : Object.values(references);
    for (const reference of referenceValues) {
        if (!isRecord(reference)) {
            continue;
        }
        const index = getQwenReferenceIndex(reference);
        if (index === null || !citedNumbers.has(index)) {
            continue;
        }
        if (!isSafeQwenReferenceUrl(reference.url)) {
            return null;
        }
        const urls = urlsByNumber.get(index) ?? new Set<string>();
        urls.add(reference.url);
        urlsByNumber.set(index, urls);
    }
    const citedUrls = new Map<number, string>();
    for (const number of citedNumbers) {
        const urls = urlsByNumber.get(number);
        if (urls?.size !== 1) {
            return null;
        }
        citedUrls.set(number, urls.values().next().value!);
    }
    return citedUrls;
};

type QwenCodeState = {
    fenced: boolean;
    inlineDelimiterLength: number;
};

const getQwenBacktickRun = (body: string, index: number): number => {
    if (body[index] !== '`') {
        return 0;
    }
    let runLength = 1;
    while (body[index + runLength] === '`') {
        runLength += 1;
    }
    return runLength;
};

const updateQwenCodeState = (body: string, index: number, runLength: number, state: QwenCodeState): QwenCodeState => {
    const lineStart = body.lastIndexOf('\n', index - 1) + 1;
    const isFence = runLength >= 3 && /^[ \t]{0,3}$/u.test(body.slice(lineStart, index));
    if (isFence && state.inlineDelimiterLength === 0) {
        return { fenced: !state.fenced, inlineDelimiterLength: 0 };
    }
    if (!state.fenced && runLength < 3) {
        return {
            fenced: false,
            inlineDelimiterLength:
                state.inlineDelimiterLength === runLength ? 0 : state.inlineDelimiterLength || runLength,
        };
    }
    return state;
};

const getQwenCitationAt = (body: string, index: number): QwenCitationMatch | null => {
    if (!body.startsWith('[[', index) || (index > 0 && body[index - 1] === '[')) {
        return null;
    }
    const close = body.indexOf(']]', index + 2);
    if (close === -1 || (close + 2 < body.length && body[close + 2] === ']')) {
        return null;
    }
    const rawNumbers = body.slice(index + 2, close);
    if (!/^\d+(?:,\d+)*$/u.test(rawNumbers)) {
        return null;
    }
    const numbers = rawNumbers.split(',').map(Number);
    return numbers.every((number) => Number.isSafeInteger(number) && number > 0)
        ? { end: close + 2, numbers, start: index }
        : null;
};

const getQwenCitationMatches = (body: string): QwenCitationMatch[] => {
    const matches: QwenCitationMatch[] = [];
    let state: QwenCodeState = { fenced: false, inlineDelimiterLength: 0 };
    for (let index = 0; index < body.length; ) {
        const runLength = getQwenBacktickRun(body, index);
        if (runLength > 0) {
            state = updateQwenCodeState(body, index, runLength, state);
            index += runLength;
            continue;
        }
        const match = !state.fenced && state.inlineDelimiterLength === 0 ? getQwenCitationAt(body, index) : null;
        if (match) {
            matches.push(match);
            index = match.end;
            continue;
        }
        index += 1;
    }
    return matches;
};

const expandQwenCitations = (body: string, references: QwenReferences): string | null => {
    const matches = getQwenCitationMatches(body);
    if (matches.length === 0) {
        return body;
    }
    const citedNumbers = new Set(matches.flatMap((match) => match.numbers));
    const citedUrls = getQwenCitedUrls(references, citedNumbers);
    if (!citedUrls) {
        return null;
    }
    let cursor = 0;
    let expanded = '';
    for (const match of matches) {
        expanded += body.slice(cursor, match.start);
        expanded += `[${match.numbers.map((number) => `[${number}](${citedUrls.get(number)!})`).join(', ')}]`;
        cursor = match.end;
    }
    return expanded + body.slice(cursor);
};

const getQwenArtifactForMessage = (
    rawPayload: unknown,
    message: JsonRecord,
    sourceId: string | undefined,
): WebChatArtifact | null => {
    const author = isRecord(message.author) ? message.author : null;
    const role = normalizeRole(firstString(author?.role, message.role, message.sender));
    if (role !== 'assistant' || !sourceId) {
        return null;
    }
    const body = getQwenReportBody(message);
    const rawMessage = getQwenRawMessage(rawPayload, sourceId);
    if (body === null || !rawMessage || normalizeRole(rawMessage.role) !== 'assistant') {
        return null;
    }
    const answer = getQwenAnswerEntry(rawMessage, body);
    const references = answer && getQwenAnswerReferences(answer);
    const content = references ? expandQwenCitations(body, references) : null;
    const title = answer ? getQwenMarkdownTitle(rawMessage) : null;
    return content !== null && title !== null ? { content, id: `qwen-report:${sourceId}`, title } : null;
};

const getQwenArtifacts = (rawPayload: unknown, sourceMessages: SourceMessage[]): WebChatArtifact[] =>
    sourceMessages.flatMap(({ message, sourceId }) => {
        const artifact = getQwenArtifactForMessage(rawPayload, message, sourceId);
        return artifact ? [artifact] : [];
    });

const getGeminiToolCalls = (rawPayload: unknown): ImportedToolEvent[] => {
    const calls: ImportedToolEvent[] = [];
    let hasResearchTrace = false;
    visitJsonValues(rawPayload, (value) => {
        if (typeof value === 'string' && /\bresearching websites\b/i.test(value)) {
            hasResearchTrace = true;
        }
        if (isRecord(value)) {
            hasResearchTrace ||=
                Object.keys(value).some((key) => /grounding|citation|web.?search/i.test(key)) ||
                getGeminiCitations([value]).length > 0;
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

const getGeminiCitations = (metadata: unknown): Array<{ number: number; title: string; url: string }> => {
    const citations = new Map<number, { number: number; title: string; url: string }>();
    // Field 44 holds citation groups; each source pairs [favicon, URL, title] with its displayed number.
    const groups = Array.isArray(metadata)
        ? metadata.flatMap((entry) => (isRecord(entry) && Array.isArray(entry[44]) ? entry[44] : []))
        : [];
    visitJsonValues(groups, (value) => {
        if (!Array.isArray(value) || !Array.isArray(value[0])) {
            return;
        }
        const [number, url, title] = [value[1], value[0][1], value[0][2]];
        if (
            !Number.isSafeInteger(number) ||
            number <= 0 ||
            typeof url !== 'string' ||
            !/^https?:\/\//i.test(url) ||
            !URL.canParse(url) ||
            typeof title !== 'string' ||
            !title.trim()
        ) {
            return;
        }
        citations.set(number, { number, title, url });
    });
    return [...citations.values()].sort((left, right) => left.number - right.number);
};

const getGeminiArtifacts = (rawPayload: unknown): WebChatArtifact[] => {
    const artifacts = new Map<string, WebChatArtifact>();
    visitJsonValues(rawPayload, (value) => {
        // Gemini immersive document tuples repeat the document ID at index 9; type 3 contains Markdown.
        if (
            !Array.isArray(value) ||
            typeof value[0] !== 'string' ||
            !value[0].startsWith('im_') ||
            value[9] !== value[0] ||
            value[10] !== 3 ||
            typeof value[2] !== 'string' ||
            !value[2].trim() ||
            typeof value[4] !== 'string' ||
            !value[4].trim()
        ) {
            return;
        }
        const citations = getGeminiCitations(value[5]).map(({ number, title, url }) => {
            const label = title.replace(/\r?\n/g, ' ').replace(/[\\`*_[\]<>]/g, '\\$&');
            const destination = new URL(url).href.replace(/[<>]/g, encodeURIComponent);
            return `${number}. [${label}](<${destination}>)`;
        });
        const content =
            citations.length > 0
                ? `${value[4]}${value[4].endsWith('\n') ? '\n' : '\n\n'}## Works cited\n\n${citations.join('\n')}\n`
                : value[4];
        artifacts.set(value[0], { content, id: value[0], title: value[2] });
    });
    return [...artifacts.values()];
};

type MetaArtifactSlot = {
    extension: string | null;
    id: string | null;
    title: string | null;
    valid: boolean;
};

const getMetaArtifactLink = (value: unknown): { label: string; path: string } | null => {
    if (typeof value !== 'string') {
        return null;
    }
    const match = value.match(/\[([^\]]+)\]\(([^)\s]+)\)/u);
    if (!match) {
        return null;
    }
    try {
        return { label: match[1]!, path: new URL(match[2]!).pathname };
    } catch {
        return null;
    }
};

const getMetaFileExtension = (value: string | null): string | null => {
    if (!value?.includes('.')) {
        return null;
    }
    return value.split('.').at(-1)?.toLowerCase() ?? null;
};

const getMetaArtifactSlots = (rawMessage: JsonRecord): MetaArtifactSlot[] => {
    const renderer = isRecord(rawMessage.contentRenderer) ? rawMessage.contentRenderer : null;
    const response = renderer && isRecord(renderer.unified_response) ? renderer.unified_response : null;
    const sections = response && Array.isArray(response.sections) ? response.sections : [];
    return sections.flatMap((section) => {
        const primitive =
            isRecord(section) && isRecord(section.view_model) && isRecord(section.view_model.primitive)
                ? section.view_model.primitive
                : null;
        const sandbox = primitive && isRecord(primitive.html_artifact_sandbox) ? primitive.html_artifact_sandbox : null;
        if (!sandbox) {
            return [];
        }
        const extension = firstString(sandbox.file_extension)?.replace(/^\./u, '').toLowerCase() ?? null;
        const link = getMetaArtifactLink(primitive?.text);
        const pathTitle = link?.path.split(/[\\/]/u).at(-1) ?? null;
        const labelTitle = link?.label.split(/[\\/]/u).at(-1) ?? null;
        const title = pathTitle?.includes('.') ? pathTitle : labelTitle;
        const linkedExtensions = [getMetaFileExtension(pathTitle), getMetaFileExtension(labelTitle)].filter(
            (value): value is string => value !== null,
        );
        return [
            {
                extension,
                id: firstString(sandbox.uuid, sandbox.asset_id, sandbox.clippy_file_id),
                title,
                valid: Boolean(
                    extension &&
                        title &&
                        linkedExtensions.length > 0 &&
                        linkedExtensions.every((value) => value === extension),
                ),
            },
        ];
    });
};

const getMetaRawMessage = (rawPayload: unknown, messageId: string): JsonRecord | null => {
    const data = isRecord(rawPayload) && isRecord(rawPayload.data) ? rawPayload.data : null;
    const conversation = data && isRecord(data.conversation) ? data.conversation : null;
    const messages = conversation && isRecord(conversation.messages) ? conversation.messages : null;
    const edges = messages && Array.isArray(messages.edges) ? messages.edges : [];
    return (
        edges
            .map((edge) => (isRecord(edge) && isRecord(edge.node) ? edge.node : null))
            .find((message) => message !== null && firstString(message.id) === messageId) ?? null
    );
};

const getMetaContentParts = (message: JsonRecord): string[] | null => {
    const content = isRecord(message.content) ? message.content : null;
    const parts = content && Array.isArray(content.parts) ? content.parts : null;
    return parts && parts.length > 0 && parts.every((part) => typeof part === 'string') ? (parts as string[]) : null;
};

const isValidMetaArtifactBody = (body: string, extension: string | null): boolean => {
    if (extension !== 'json') {
        return true;
    }
    try {
        JSON.parse(body);
        return true;
    } catch {
        return false;
    }
};

const dedupeMetaArtifactSlots = (slots: MetaArtifactSlot[]): MetaArtifactSlot[] | null => {
    const byId = new Map<string, MetaArtifactSlot>();
    const unique: MetaArtifactSlot[] = [];
    for (const slot of slots) {
        if (!slot.id) {
            unique.push(slot);
            continue;
        }
        const previous = byId.get(slot.id);
        if (previous) {
            if (
                previous.extension !== slot.extension ||
                previous.title !== slot.title ||
                previous.valid !== slot.valid
            ) {
                return null;
            }
            continue;
        }
        byId.set(slot.id, slot);
        unique.push(slot);
    }
    return unique;
};

const bindMetaArtifacts = (parts: string[], slots: MetaArtifactSlot[], messageId: string): WebChatArtifact[] => {
    const bindings = new Map<string, WebChatArtifact>();
    for (const [index, slot] of slots.entries()) {
        if (!slot.valid || !slot.title) {
            continue;
        }
        const body = parts[index + 1]!;
        if (!isValidMetaArtifactBody(body, slot.extension)) {
            continue;
        }
        const id = `${messageId}:${slot.id ?? `part-${index + 1}`}`;
        const artifact = { content: body, id, title: slot.title };
        const previous = bindings.get(id);
        if (!previous) {
            bindings.set(id, artifact);
            continue;
        }
        if (previous.title !== artifact.title || previous.content !== artifact.content) {
            return [];
        }
    }
    return [...bindings.values()];
};

const getMetaArtifactsForMessage = (rawPayload: unknown, message: JsonRecord): WebChatArtifact[] => {
    const messageId = firstString(message.id, message.uuid, message._id);
    const parts = getMetaContentParts(message);
    const rawMessage = messageId ? getMetaRawMessage(rawPayload, messageId) : null;
    if (!messageId || !rawMessage || !parts) {
        return [];
    }
    // Meta places exact artifact bodies after the visible answer; the raw node proves the selected message and slot count.
    if (rawMessage.content !== parts[0]) {
        return [];
    }
    const slots = getMetaArtifactSlots(rawMessage);
    if (slots.length === 0 || parts.length !== slots.length + 1) {
        const uniqueSlots = dedupeMetaArtifactSlots(slots);
        if (!uniqueSlots || parts.length !== uniqueSlots.length + 1) {
            return [];
        }
        return bindMetaArtifacts(parts, uniqueSlots, messageId);
    }
    return bindMetaArtifacts(parts, slots, messageId);
};

const getMetaArtifacts = (rawPayload: unknown, sourceMessages: SourceMessage[]): WebChatArtifact[] =>
    sourceMessages.flatMap(({ message }) => {
        const author = isRecord(message.author) ? message.author : null;
        const role = normalizeRole(firstString(author?.role, message.role, message.sender));
        return role === 'assistant' ? getMetaArtifactsForMessage(rawPayload, message) : [];
    });

const getClaudeContentBlocks = (message: JsonRecord): unknown[] => {
    if (Array.isArray(message.content)) {
        return message.content;
    }
    return isRecord(message.content) && Array.isArray(message.content.parts) ? message.content.parts : [];
};

const getClaudeArtifactCandidate = (block: unknown): ClaudeArtifactCandidate | null => {
    if (!isRecord(block) || getBlockType(block) !== 'tool_use') {
        return null;
    }
    if (firstString(block.name)?.toLowerCase() !== 'create_file') {
        return null;
    }
    const input = isRecord(block.input) ? block.input : null;
    const path = typeof input?.path === 'string' ? input.path : null;
    const content = input && typeof input.file_text === 'string' ? input.file_text : null;
    if (path === null || !/\.(?:md|markdown)$/i.test(path) || content === null) {
        return null;
    }
    return {
        content,
        id: asString(block.id),
        path,
        title: path.split(/[\\/]/u).at(-1) || path,
    };
};

const isSameClaudeArtifact = (
    candidate: ClaudeArtifactCandidate,
    existing: { artifact: WebChatArtifact; id: string | null; path: string },
): boolean =>
    existing.id === candidate.id &&
    existing.path === candidate.path &&
    existing.artifact.title === candidate.title &&
    existing.artifact.content === candidate.content;

const getClaudeArtifacts = (sourceMessages: SourceMessage[]): WebChatArtifact[] => {
    const candidates: Array<{
        artifact: WebChatArtifact;
        id: string | null;
        path: string;
    }> = [];
    const usedIds = new Set<string>();
    const nextArtifactId = (baseId: string): string => {
        let id = baseId;
        let suffix = 2;
        while (usedIds.has(id)) {
            id = `${baseId}:${suffix}`;
            suffix += 1;
        }
        usedIds.add(id);
        return id;
    };

    for (const { message } of sourceMessages) {
        const blocks = getClaudeContentBlocks(message);
        for (const block of blocks) {
            const candidate = getClaudeArtifactCandidate(block);
            if (!candidate) {
                continue;
            }
            // ponytail: O(n²) duplicate scan is bounded by the few file artifacts in a chat export.
            if (candidates.some((existing) => isSameClaudeArtifact(candidate, existing))) {
                continue;
            }
            const artifactId = nextArtifactId(candidate.id ?? `claude-artifact-${candidates.length + 1}`);
            candidates.push({
                artifact: { content: candidate.content, id: artifactId, title: candidate.title },
                id: candidate.id,
                path: candidate.path,
            });
        }
    }
    return candidates.map(({ artifact }) => artifact);
};

type GlmFileMutation =
    | {
          content: string;
          kind: 'write';
          path: string;
      }
    | {
          content: string;
          kind: 'append';
          path: string;
      }
    | {
          kind: 'copy';
          path: string;
          sourcePath: string;
      };

type GlmFileOperation = GlmFileMutation & {
    callId: string | null;
    succeeded: boolean;
};

type GlmToolInvocation = {
    args: JsonRecord | null;
    functionName: string;
    id: string | null;
    succeeded: boolean | null;
};

const getGlmBatchMessages = (rawPayload: unknown): Array<{ id: string; message: JsonRecord }> => {
    if (!isRecord(rawPayload) || !isRecord(rawPayload.messages_batch)) {
        return [];
    }
    const data = rawPayload.messages_batch.data;
    if (Array.isArray(data)) {
        return data.flatMap((value, index) =>
            isRecord(value) ? [{ id: firstString(value.id) ?? `message-${index}`, message: value }] : [],
        );
    }
    if (!isRecord(data)) {
        return [];
    }
    return Object.entries(data).flatMap(([id, value]) => (isRecord(value) ? [{ id, message: value }] : []));
};

type GlmToolCall = {
    args: JsonRecord | null;
    argsText: string | null;
    functionName: string;
    id: string | null;
};

const parseGlmArguments = (value: unknown): JsonRecord | null => {
    if (typeof value !== 'string' || !value) {
        return null;
    }
    try {
        const parsed = JSON.parse(value);
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
};

const getGlmToolBlocks = (message: JsonRecord): JsonRecord[] =>
    Array.isArray(message.content_blocks)
        ? message.content_blocks.filter(
              (block): block is JsonRecord => isRecord(block) && getBlockType(block) === 'tool_calls',
          )
        : [];

const getGlmToolCall = (value: unknown): GlmToolCall | null => {
    if (!isRecord(value) || !isRecord(value.function)) {
        return null;
    }
    const functionName = firstString(value.function.name);
    if (!functionName) {
        return null;
    }
    const argsText = typeof value.function.arguments === 'string' ? value.function.arguments : null;
    return {
        args: parseGlmArguments(argsText),
        argsText,
        functionName: functionName.toLowerCase(),
        id: firstString(value.id),
    };
};

const getGlmToolCalls = (block: JsonRecord): GlmToolCall[] =>
    Array.isArray(block.content)
        ? block.content.flatMap((value) => {
              const call = getGlmToolCall(value);
              return call ? [call] : [];
          })
        : [];

const getGlmResultStatuses = (block: JsonRecord): Array<{ id: string; succeeded: boolean }> =>
    Array.isArray(block.results)
        ? block.results.flatMap((value) => {
              if (!isRecord(value)) {
                  return [];
              }
              const id = firstString(value.tool_call_id, value.id);
              return id
                  ? [
                        {
                            id,
                            succeeded: asString(value.status)?.toLowerCase() === 'completed' && value.is_error !== true,
                        },
                    ]
                  : [];
          })
        : [];

const dedupeGlmToolCalls = (
    calls: GlmToolCall[],
    resultStatuses: Map<string, boolean>,
    invalid: boolean,
): GlmToolInvocation[] | null => {
    const uniqueCalls = new Map<string, GlmToolCall>();
    const invocations: GlmToolInvocation[] = [];
    for (const call of calls) {
        if (!call.id) {
            invocations.push({ args: call.args, functionName: call.functionName, id: null, succeeded: null });
            continue;
        }
        const previous = uniqueCalls.get(call.id);
        if (previous) {
            if (previous.functionName !== call.functionName || previous.argsText !== call.argsText) {
                invalid = true;
            }
            continue;
        }
        uniqueCalls.set(call.id, call);
        invocations.push({
            args: call.args,
            functionName: call.functionName,
            id: call.id,
            succeeded: resultStatuses.get(call.id) ?? null,
        });
    }
    return invalid ? null : invocations;
};

const getGlmToolInvocations = (rawPayload: unknown, sourceMessages: SourceMessage[]): GlmToolInvocation[] | null => {
    const sourceIds = new Set(
        sourceMessages
            .map(({ message }) => firstString(message.id, message.uuid, message._id))
            .filter((id): id is string => Boolean(id)),
    );
    const batchMessages = getGlmBatchMessages(rawPayload).filter(({ id, message }) => {
        const messageId = firstString(message.id);
        return sourceIds.size === 0 || sourceIds.has(id) || (messageId !== null && sourceIds.has(messageId));
    });
    const blocks = batchMessages.flatMap(({ message }) => getGlmToolBlocks(message));
    const resultStatuses = new Map<string, boolean>();
    let invalid = false;
    for (const block of blocks) {
        for (const { id, succeeded } of getGlmResultStatuses(block)) {
            const previous = resultStatuses.get(id);
            if (previous !== undefined && previous !== succeeded) {
                invalid = true;
            }
            resultStatuses.set(id, succeeded);
        }
    }
    return dedupeGlmToolCalls(blocks.flatMap(getGlmToolCalls), resultStatuses, invalid);
};

const resolveGlmPath = (directory: string | null, path: string): string =>
    path.startsWith('/') || !directory ? path : `${directory.replace(/\/+$/u, '')}/${path}`;

const parseGlmHeredoc = (
    command: string,
    directory: string | null,
): { content: string; path: string; pathToken: string; suffix: string } | null => {
    const prefix = command.match(/^cat >> (\S+) << 'EOF'\n/u);
    if (!prefix) {
        return null;
    }
    const rest = command.slice(prefix[0].length);
    const delimiter = rest.match(/(?:^|\n)EOF\n/u);
    if (!delimiter || delimiter.index === undefined) {
        return null;
    }
    const separatorLength = delimiter[0].startsWith('\n') ? 1 : 0;
    const bodyEnd = delimiter.index;
    const suffixStart = bodyEnd + separatorLength + 'EOF\n'.length;
    return {
        content: `${rest.slice(0, bodyEnd)}${separatorLength > 0 ? '\n' : ''}`,
        path: resolveGlmPath(directory, prefix[1]!),
        pathToken: prefix[1]!,
        suffix: rest.slice(suffixStart),
    };
};

const parseGlmBashOperations = (command: string): { operations: GlmFileMutation[]; unsupported: boolean } => {
    const finalPrefix = command.match(/^cd (\S+) && jq -e \. (\S+) > \/dev\/null && echo "JSON VALID" && /u);
    if (finalPrefix) {
        const directory = finalPrefix[1]!;
        const jsonToken = finalPrefix[2]!;
        const heredoc = parseGlmHeredoc(command.slice(finalPrefix[0].length), directory);
        if (!heredoc) {
            return { operations: [], unsupported: true };
        }
        const closingFence = '```';
        const expectedSuffix =
            `cat ${jsonToken} >> ${heredoc.pathToken} && echo '${closingFence}' >> ${heredoc.pathToken} && ` +
            `echo "REPORT.md finalized:" && wc -c ${heredoc.pathToken} ${jsonToken} && tail -3 ${heredoc.pathToken}`;
        if (heredoc.suffix !== expectedSuffix) {
            return { operations: [], unsupported: true };
        }
        return {
            operations: [
                { content: heredoc.content, kind: 'append', path: heredoc.path },
                {
                    kind: 'copy',
                    path: heredoc.path,
                    sourcePath: resolveGlmPath(directory, jsonToken),
                },
                { content: '```\n', kind: 'append', path: heredoc.path },
            ],
            unsupported: false,
        };
    }

    const heredoc = parseGlmHeredoc(command, null);
    if (heredoc) {
        if (!/\breport\.(?:md|markdown|json)\b/i.test(heredoc.pathToken)) {
            return { operations: [], unsupported: false };
        }
        const suffix = heredoc.suffix.match(/^echo "[^"]*"; wc -c (\S+)$/u);
        if (!suffix || suffix[1] !== heredoc.pathToken) {
            return { operations: [], unsupported: true };
        }
        return {
            operations: [{ content: heredoc.content, kind: 'append', path: heredoc.path }],
            unsupported: false,
        };
    }

    return {
        operations: [],
        unsupported:
            /\breport\.(?:md|markdown|json)\b/i.test(command) &&
            /(?:>>|>)\s*[^\s;]+\.(?:md|markdown|json)\b|\b(?:rm|mv|cp|tee|sed)\b[^\n]*\.(?:md|markdown|json)\b/i.test(
                command,
            ),
    };
};

const getGlmInvocationOperations = (
    invocation: GlmToolInvocation,
): { operations: GlmFileOperation[]; unsupported: boolean } => {
    const succeeded = invocation.succeeded === true;
    if (invocation.functionName === 'write') {
        const path = typeof invocation.args?.filepath === 'string' ? invocation.args.filepath : null;
        const content = typeof invocation.args?.content === 'string' ? invocation.args.content : null;
        return path !== null && content !== null
            ? {
                  operations: [{ callId: invocation.id, content, kind: 'write', path, succeeded }],
                  unsupported: false,
              }
            : { operations: [], unsupported: true };
    }
    if (invocation.functionName !== 'bash') {
        return { operations: [], unsupported: false };
    }
    const command = typeof invocation.args?.command === 'string' ? invocation.args.command : null;
    if (command === null) {
        return { operations: [], unsupported: true };
    }
    const parsed = parseGlmBashOperations(command);
    return {
        operations: parsed.operations.map((operation) => ({ ...operation, callId: invocation.id, succeeded })),
        unsupported: parsed.unsupported,
    };
};

const getGlmFileOperations = (invocations: GlmToolInvocation[]): GlmFileOperation[] | null => {
    const operations: GlmFileOperation[] = [];
    for (const invocation of invocations) {
        const parsed = getGlmInvocationOperations(invocation);
        if (parsed.unsupported) {
            return null;
        }
        operations.push(...parsed.operations);
    }
    return operations;
};

const getGlmReportPaths = (operations: GlmFileOperation[]) => {
    const reportPaths = new Set<string>();
    const dependencyPaths = new Set<string>();
    const isMarkdownPath = (path: string) => /\.(?:md|markdown)$/i.test(path);
    for (const operation of operations) {
        if (operation.kind === 'copy') {
            dependencyPaths.add(operation.sourcePath);
            if (isMarkdownPath(operation.path)) {
                reportPaths.add(operation.path);
            }
        } else if (operation.kind === 'append' && isMarkdownPath(operation.path)) {
            reportPaths.add(operation.path);
        } else if (
            operation.kind === 'write' &&
            /^report\.(?:md|markdown)$/i.test(operation.path.split(/[\\/]/u).at(-1) ?? '')
        ) {
            reportPaths.add(operation.path);
        }
    }
    return { dependencyPaths, reportPaths };
};

const applyGlmFileOperation = (
    operation: GlmFileOperation,
    files: Map<string, string>,
    artifactIds: Map<string, string>,
    reportPaths: Set<string>,
    dependencyPaths: Set<string>,
): boolean => {
    if (operation.kind === 'write') {
        if (!operation.succeeded) {
            return !reportPaths.has(operation.path) && !dependencyPaths.has(operation.path);
        }
        files.set(operation.path, operation.content);
        if (reportPaths.has(operation.path) && !artifactIds.has(operation.path)) {
            artifactIds.set(operation.path, operation.callId ?? `glm-artifact-${artifactIds.size + 1}`);
        }
        return true;
    }
    if (!operation.succeeded || !files.has(operation.path)) {
        return false;
    }
    if (operation.kind === 'append') {
        files.set(operation.path, `${files.get(operation.path)!}${operation.content}`);
        return true;
    }
    const content = files.get(operation.sourcePath);
    if (content === undefined) {
        return false;
    }
    files.set(operation.path, `${files.get(operation.path)!}${content}`);
    return true;
};

const replayGlmFileOperations = (
    operations: GlmFileOperation[],
    reportPaths: Set<string>,
    dependencyPaths: Set<string>,
) => {
    const files = new Map<string, string>();
    const artifactIds = new Map<string, string>();
    for (const operation of operations) {
        if (!applyGlmFileOperation(operation, files, artifactIds, reportPaths, dependencyPaths)) {
            return null;
        }
    }
    return { artifactIds, files };
};

const getGlmArtifacts = (rawPayload: unknown, sourceMessages: SourceMessage[]): WebChatArtifact[] => {
    const invocations = getGlmToolInvocations(rawPayload, sourceMessages);
    const operations = invocations ? getGlmFileOperations(invocations) : null;
    if (!operations) {
        return [];
    }
    const { dependencyPaths, reportPaths } = getGlmReportPaths(operations);
    if (reportPaths.size === 0) {
        return [];
    }
    const replayed = replayGlmFileOperations(operations, reportPaths, dependencyPaths);
    if (!replayed) {
        return [];
    }
    return [...reportPaths]
        .map((path, index) => {
            const content = replayed.files.get(path);
            if (content === undefined) {
                return null;
            }
            return {
                content,
                id: replayed.artifactIds.get(path) ?? `glm-artifact-${index + 1}`,
                title: path.split(/[\\/]/u).at(-1) || path,
            } satisfies WebChatArtifact;
        })
        .filter((artifact): artifact is WebChatArtifact => artifact !== null);
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

const getProviderToolEvents = async (
    root: JsonRecord,
    platform: string,
    sourceMessages: SourceMessage[],
): Promise<ImportedToolEvent[]> => {
    const embedded = sourceMessages.flatMap(({ message, sourceOrder }) =>
        getEmbeddedToolEvents(message).map((event) => ({ ...event, sourceOrder })),
    );
    if (platform === 'Grok') {
        return [...embedded, ...getGrokToolEvents(root.raw_payload)];
    }
    if (platform === 'Qwen') {
        return [...embedded, ...(await getQwenToolEvents(root.raw_payload))];
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

const parseMappingConversation = async (root: JsonRecord, fileName: string): Promise<ConversationDraft | null> => {
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
            sourceMessages.push({ message, sourceId: id, sourceOrder });
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
        addImportedToolEvents(normalizedMessages, await getProviderToolEvents(root, platform, sourceMessages)),
    );
    if (messages.length === 0) {
        return null;
    }
    return {
        artifacts:
            platform === 'Claude'
                ? getClaudeArtifacts(sourceMessages)
                : platform === 'Meta'
                  ? getMetaArtifacts(root.raw_payload, sourceMessages)
                  : platform === 'GLM'
                    ? getGlmArtifacts(root.raw_payload, sourceMessages)
                    : platform === 'Qwen'
                      ? getQwenArtifacts(root.raw_payload, sourceMessages)
                      : undefined,
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

const parseGrokConversation = async (root: JsonRecord): Promise<ConversationDraft | null> => {
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
        addImportedToolEvents(normalizedMessages, await getProviderToolEvents(root, 'Grok', sourceMessages)),
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

const resolveMessageArrayRoot = (root: JsonRecord): JsonRecord | null => {
    for (const candidate of [root, root.conversation, root.data]) {
        if (isRecord(candidate) && (Array.isArray(candidate.messages) || Array.isArray(candidate.chat_messages))) {
            return candidate;
        }
    }
    return null;
};

const parseMessageArrayConversation = async (
    input: JsonRecord,
    fileName: string,
): Promise<ConversationDraft | null> => {
    const messageRoot = resolveMessageArrayRoot(input);
    if (!messageRoot) {
        return null;
    }
    const root = { ...input, ...messageRoot };
    const rawMessages = (Array.isArray(root.messages) ? root.messages : root.chat_messages) as unknown[];
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
        addImportedToolEvents(normalizedMessages, await getProviderToolEvents(root, platform, sourceMessages)),
    );
    if (messages.length === 0) {
        return null;
    }
    return {
        artifacts:
            platform === 'Claude'
                ? getClaudeArtifacts(sourceMessages)
                : platform === 'Meta'
                  ? getMetaArtifacts(root.raw_payload, sourceMessages)
                  : platform === 'GLM'
                    ? getGlmArtifacts(root.raw_payload, sourceMessages)
                    : undefined,
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

const parseConversation = async (value: unknown, fileName: string): Promise<ConversationDraft | null> => {
    if (!isRecord(value)) {
        return null;
    }
    const parsed =
        (await parseMappingConversation(value, fileName)) ??
        (await parseGrokConversation(value)) ??
        (await parseMessageArrayConversation(value, fileName)) ??
        parseCommonConversation(value, fileName);
    if (parsed) {
        const artifacts =
            parsed.artifacts ??
            (parsed.platform === 'Gemini'
                ? getGeminiArtifacts(resolveMessageArrayRoot(value)?.raw_payload ?? value.raw_payload)
                : parsed.platform === 'GLM'
                  ? getGlmArtifacts(resolveMessageArrayRoot(value)?.raw_payload ?? value.raw_payload, [])
                  : []);
        return {
            ...parsed,
            artifacts,
            messages: parsed.messages.map((message) => ({
                ...message,
                // Some Gemini exports mislabel document sections as thoughts; retain them only in the artifact.
                reasoning:
                    parsed.platform === 'Gemini'
                        ? message.reasoning.filter(
                              (text) => !artifacts.some((artifact) => artifact.content.includes(text)),
                          )
                        : message.reasoning,
            })),
        };
    }
    for (const nested of [value.data, value.payload]) {
        const nestedParsed = await parseConversation(nested, fileName);
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

const parsePayload = async (value: unknown, fileName: string): Promise<ConversationDraft[]> => {
    if (Array.isArray(value)) {
        if (value.length > 0 && value.every(isMessageLike)) {
            const parsed = await parseMessageArrayConversation({ messages: value }, fileName);
            return parsed ? [parsed] : [];
        }
        return (await Promise.all(value.map((item) => parseConversation(item, fileName)))).filter(
            (item): item is ConversationDraft => item !== null,
        );
    }
    if (!isRecord(value)) {
        return [];
    }
    const conversations = Array.isArray(value.conversations) ? value.conversations : null;
    if (conversations) {
        return (await Promise.all(conversations.map((item) => parseConversation(item, fileName)))).filter(
            (item): item is ConversationDraft => item !== null,
        );
    }
    const parsed = await parseConversation(value, fileName);
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

const finalizeConversation = async (draft: ConversationDraft, fileName: string): Promise<WebChatConversation> => {
    const events = messagesToEvents(draft.messages, draft.platform);
    const eventTimestamps = draft.messages
        .map((message) => toTimestampMs(message.timestamp))
        .filter((value): value is number => value !== null);
    const createdAtMs = draft.createdAtMs ?? (eventTimestamps.length > 0 ? Math.min(...eventTimestamps) : null);
    const lastActiveAtMs =
        draft.updatedAtMs ?? (eventTimestamps.length > 0 ? Math.max(...eventTimestamps) : createdAtMs);
    const identity = draft.sourceConversationId ?? JSON.stringify({ events, fileName, title: draft.title });
    const id = (await sha256Hex(`${draft.platform}\0${identity}`)).slice(0, 32);
    return {
        artifacts: draft.artifacts ?? [],
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

const parseSizedWebChatFiles = async (
    files: WebChatFileInput[],
): Promise<{ conversations: SizedWebChatConversation[]; errors: WebChatImportError[] }> => {
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
        const drafts = await parsePayload(value, file.name);
        if (drafts.length === 0) {
            errors.push({ fileName: file.name, message: 'No supported web conversation was found.' });
            continue;
        }
        const bytes = Math.ceil(new TextEncoder().encode(file.content).byteLength / drafts.length);
        for (const draft of drafts) {
            const conversation = await finalizeConversation(draft, file.name);
            conversations.set(conversation.id, { bytes, conversation });
        }
    }
    return { conversations: [...conversations.values()], errors };
};

export const parseWebChatFiles = async (files: WebChatFileInput[]): Promise<WebChatParseResult> => {
    const result = await parseSizedWebChatFiles(files);
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

const toWebChatSummary = ({
    artifacts: _artifacts,
    events: _events,
    ...summary
}: WebChatConversation): WebChatConversationSummary => summary;

export const importWebChatFiles = async (files: WebChatFileInput[]): Promise<WebChatParseResult> => {
    const result = await parseSizedWebChatFiles(files);
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
