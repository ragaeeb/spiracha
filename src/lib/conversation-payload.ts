import { finalizeMessages } from './conversation-data/adapter-helpers';
import { renderConversationMarkdown } from './conversation-data/markdown';
import { selectConversationMessages } from './conversation-data/message-selector';
import { CONVERSATION_SOURCES } from './conversation-data/types';
import { parseAntigravityPayload } from './conversation-payload-antigravity';
import { parseClinePayload } from './conversation-payload-cline';
import { parseCodexPayload } from './conversation-payload-codex';
import { parseCursorPayload } from './conversation-payload-cursor';
import { parseFxPayload } from './conversation-payload-fx';
import { parseGrokPayload } from './conversation-payload-grok';
import { parseGrokBotPayload } from './conversation-payload-grok-bot';
import { parseKiroPayload } from './conversation-payload-kiro';
import { parseMiniMaxCodePayload } from './conversation-payload-minimax-code';
import { parseOpenCodePayload } from './conversation-payload-opencode';
import { parseQoderPayload } from './conversation-payload-qoder';
import type {
    ConvertConversationPayloadOptions,
    ConvertedConversation,
    PayloadConversationDraft,
} from './conversation-payload-types';
import { parseWebPayload } from './conversation-payload-web';
import { sha256Hex } from './sha256';
import { cleanInlineTitle } from './shared-text';

export type {
    ConversationPayloadArtifact,
    ConversationPayloadSource,
    ConvertConversationPayloadOptions,
    ConvertedConversation,
} from './conversation-payload-types';

export type ConversationPayloadErrorCode =
    | 'invalid_input'
    | 'invalid_json'
    | 'unsupported_source'
    | 'unsupported_format'
    | 'ambiguous_source'
    | 'malformed_payload';

export class ConversationPayloadError extends Error {
    constructor(
        readonly code: ConversationPayloadErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'ConversationPayloadError';
    }
}

const MAX_PAYLOAD_BYTES = 25 * 1024 * 1024;

const nativeParsers = {
    antigravity: parseAntigravityPayload,
    cline: parseClinePayload,
    codex: parseCodexPayload,
    cursor: parseCursorPayload,
    fx: parseFxPayload,
    grok: parseGrokPayload,
    'grok-bot': parseGrokBotPayload,
    kiro: parseKiroPayload,
    'minimax-code': parseMiniMaxCodePayload,
    opencode: parseOpenCodePayload,
    qoder: parseQoderPayload,
};

const parsePayloadDrafts = async (
    value: unknown,
    options: ConvertConversationPayloadOptions,
): Promise<PayloadConversationDraft[] | null> => {
    if (options.source === 'web') {
        return parseWebPayload(value, options.fileName);
    }
    if (options.source) {
        return nativeParsers[options.source](value, options.source);
    }
    const candidates: Array<{ drafts: PayloadConversationDraft[]; source: string }> = [];
    for (const [source, parse] of Object.entries(nativeParsers)) {
        try {
            const drafts = parse(value);
            if (drafts) {
                candidates.push({ drafts, source });
            }
        } catch {
            // A native parser may reject a shape it claimed while another parser, including Web, can still accept it.
        }
    }
    if (candidates.length > 1) {
        throw new ConversationPayloadError(
            'ambiguous_source',
            `Payload matches multiple sources (${candidates.map(({ source }) => source).join(', ')}); provide a source hint.`,
        );
    }
    return candidates[0]?.drafts ?? parseWebPayload(value, options.fileName);
};

const decodePayload = (payload: unknown): unknown => {
    if (typeof payload !== 'string') {
        return payload;
    }
    if (new TextEncoder().encode(payload).byteLength > MAX_PAYLOAD_BYTES) {
        throw new ConversationPayloadError('invalid_input', 'Payload must be 25 MB or smaller.');
    }
    const text = payload.replace(/^\uFEFF/, '');
    try {
        return JSON.parse(text);
    } catch {
        const lines = text.split(/\r?\n/);
        if (lines.filter((line) => line.trim()).length < 2) {
            throw new ConversationPayloadError('invalid_json', 'Payload is not valid JSON or JSONL.');
        }
        return lines.flatMap((line, index) => {
            if (!line.trim()) {
                return [];
            }
            try {
                return [JSON.parse(line)];
            } catch {
                throw new ConversationPayloadError('invalid_json', `Invalid JSONL at line ${index + 1}.`);
            }
        });
    }
};

const serializePayload = (value: unknown): string => {
    if (typeof value !== 'object' || value === null) {
        throw new ConversationPayloadError('invalid_input', 'Payload must be a JSON object or array.');
    }
    let serialized: string;
    try {
        serialized = JSON.stringify(value, (_key, item: unknown) => {
            if (
                ['bigint', 'function', 'symbol', 'undefined'].includes(typeof item) ||
                (typeof item === 'number' && !Number.isFinite(item))
            ) {
                throw new Error('Non-JSON value');
            }
            return item;
        });
    } catch {
        throw new ConversationPayloadError('invalid_input', 'Payload must contain only serializable JSON values.');
    }
    if (new TextEncoder().encode(serialized).byteLength > MAX_PAYLOAD_BYTES) {
        throw new ConversationPayloadError('invalid_input', 'Payload must be 25 MB or smaller.');
    }
    return serialized;
};

const isClaudeCodePayload = (value: unknown): boolean => {
    const records = Array.isArray(value) ? value : [value];
    return records.some((record) => {
        if (typeof record !== 'object' || record === null || Array.isArray(record)) {
            return false;
        }
        const candidate = record as Record<string, unknown>;
        const message = candidate.message;
        return (
            typeof candidate.sessionId === 'string' &&
            typeof candidate.uuid === 'string' &&
            (candidate.type === 'user' || candidate.type === 'assistant') &&
            typeof message === 'object' &&
            message !== null &&
            !Array.isArray(message) &&
            (typeof (message as Record<string, unknown>).content === 'string' ||
                Array.isArray((message as Record<string, unknown>).content))
        );
    });
};

const validateOptions = (options: ConvertConversationPayloadOptions) => {
    if (!options || typeof options !== 'object') {
        throw new ConversationPayloadError('invalid_input', 'Conversion options are required.');
    }
    if ((options.source as string) === 'claude-code') {
        throw new ConversationPayloadError('unsupported_source', 'Claude Code payload conversion is not supported.');
    }
    if (
        options.source !== undefined &&
        options.source !== 'web' &&
        !CONVERSATION_SOURCES.some((source) => source === options.source)
    ) {
        throw new ConversationPayloadError('unsupported_source', `Unknown payload source: ${options.source}.`);
    }
    if (
        options.messageSelector !== undefined &&
        !['all', 'last_assistant', 'last_final_answer'].includes(options.messageSelector)
    ) {
        throw new ConversationPayloadError('invalid_input', 'Invalid message selector.');
    }
    if (options.fileName !== undefined && (typeof options.fileName !== 'string' || !options.fileName.trim())) {
        throw new ConversationPayloadError('invalid_input', 'fileName must be a nonempty string.');
    }
};

const finalizePayload = async (
    draft: PayloadConversationDraft,
    identity: string,
    options: ConvertConversationPayloadOptions,
): Promise<ConvertedConversation> => {
    const messages = selectConversationMessages(finalizeMessages(draft.messages), options.messageSelector ?? 'all');
    const artifacts = draft.artifacts ?? [];
    const conversation = {
        id: draft.id ?? (await sha256Hex(identity)).slice(0, 32),
        source: draft.source,
        title: draft.title ?? null,
        ...(draft.model ? { model: draft.model } : {}),
        artifacts,
        createdAtMs: draft.createdAtMs ?? null,
        messages,
        metadata: draft.metadata ?? {},
        updatedAtMs: draft.updatedAtMs ?? null,
        workspacePath: draft.workspacePath ?? null,
    };
    const transcript = renderConversationMarkdown(conversation);
    const markdown =
        artifacts.length > 0
            ? `${transcript}\n## Artifacts\n\n${artifacts
                  .map((artifact) => `### ${cleanInlineTitle(artifact.title)}\n\n${artifact.content}`)
                  .join('\n\n')
                  .trimEnd()}\n`
            : transcript;
    return { ...conversation, markdown };
};

export const convertConversationPayload = async (
    options: ConvertConversationPayloadOptions,
): Promise<ConvertedConversation[]> => {
    validateOptions(options);
    const value = decodePayload(options.payload);
    const serialized = serializePayload(value);
    if ((!options.source || options.source === 'web') && isClaudeCodePayload(value)) {
        throw new ConversationPayloadError('unsupported_source', 'Claude Code payload conversion is not supported.');
    }
    let drafts: PayloadConversationDraft[] | null;
    try {
        drafts = await parsePayloadDrafts(value, options);
    } catch (error) {
        if (error instanceof ConversationPayloadError) {
            throw error;
        }
        throw new ConversationPayloadError('malformed_payload', error instanceof Error ? error.message : String(error));
    }
    if (!drafts?.length) {
        throw new ConversationPayloadError(
            'unsupported_format',
            'No supported conversation format was found in the payload.',
        );
    }
    return Promise.all(drafts.map((draft, index) => finalizePayload(draft, `${serialized}\0${index}`, options)));
};
