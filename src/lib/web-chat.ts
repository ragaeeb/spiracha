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

type NormalizedMessage = {
    id: string | null;
    model: string | null;
    phase: 'commentary' | 'final_answer' | null;
    reasoning: string[];
    recipient: string | null;
    role: string;
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
): NormalizedMessage => {
    const author = isRecord(message.author) ? message.author : null;
    return {
        id: firstString(message.id, message.uuid, message._id, fallbackId),
        model: extractMessageModel(message) ?? fallbackModel,
        phase: null,
        reasoning: extractReasoning(message),
        recipient: asString(message.recipient),
        role: normalizeRole(firstString(author?.role, message.role, message.sender)),
        text: extractMessageText(message),
        timestamp: toIsoTimestamp(
            message.create_time ?? message.created_at ?? message.timestamp ?? message.update_time ?? message.updated_at,
        ),
    };
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
    const messages = classifyAssistantPhases(
        chain.flatMap(({ id, message }) => {
            const normalized = normalizeMessage(message, rootModel, id);
            const report = getDeepResearchReport(message);
            const reportMessage = report ? normalizeMessage(report, rootModel, `${id}-deep-research-report`) : null;
            return [normalized, reportMessage].filter((item): item is NormalizedMessage =>
                Boolean(item && (item.text || item.reasoning.length > 0)),
            );
        }),
    );
    if (messages.length === 0) {
        return null;
    }
    const model = [...messages].reverse().find((message) => message.model)?.model ?? rootModel;
    return {
        createdAtMs: toTimestampMs(root.create_time ?? root.created_at),
        messages,
        model,
        platform: inferPlatform({ ...root, model }, fileName),
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
    const messages = classifyAssistantPhases(
        root.responses.flatMap((entry, index) => {
            const response = isRecord(entry) && isRecord(entry.response) ? entry.response : null;
            if (!response) {
                return [];
            }
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
            );
            return message.text || message.reasoning.length > 0 ? [message] : [];
        }),
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
    const messages = classifyAssistantPhases(
        rawMessages.flatMap((value, index) => {
            if (!isRecord(value)) {
                return [];
            }
            const message = normalizeMessage(value, rootModel, `message-${index}`);
            return message.text || message.reasoning.length > 0 ? [message] : [];
        }),
    );
    if (messages.length === 0) {
        return null;
    }
    const model = [...messages].reverse().find((message) => message.model)?.model ?? rootModel;
    return {
        createdAtMs: toTimestampMs(root.create_time ?? root.created_at),
        messages,
        model,
        platform: inferPlatform({ ...root, model }, fileName),
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

const buildToolEvent = (message: NormalizedMessage, platform: string, sequence: number): ThreadEvent | null => {
    if (!message.text) {
        return null;
    }
    const raw = { messageId: message.id, platform, source: 'web_import' };
    if (isToolCallMessage(message)) {
        let argumentsParseFailed = false;
        try {
            JSON.parse(message.text);
        } catch {
            argumentsParseFailed = true;
        }
        return {
            argumentsParseFailed,
            argumentsText: message.text,
            callId: message.id,
            command: null,
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

export const parseWebChatFiles = (files: WebChatFileInput[]): WebChatParseResult => {
    const conversations = new Map<string, WebChatConversation>();
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
        for (const draft of drafts) {
            const conversation = finalizeConversation(draft, file.name);
            conversations.set(conversation.id, conversation);
        }
    }
    return { conversations: [...conversations.values()], errors };
};

const MAX_IMPORTED_WEB_CHAT_BYTES = 128 * 1024 * 1024;
const importedWebChats = new Map<string, { bytes: number; conversation: WebChatConversation }>();
let importedWebChatBytes = 0;

const retainImportedWebChat = (conversation: WebChatConversation) => {
    const previous = importedWebChats.get(conversation.id);
    if (previous) {
        importedWebChatBytes -= previous.bytes;
        importedWebChats.delete(conversation.id);
    }
    const bytes = Buffer.byteLength(JSON.stringify(conversation));
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
    const result = parseWebChatFiles(files);
    for (const conversation of result.conversations) {
        retainImportedWebChat(conversation);
    }
    return result;
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
