import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import {
    type CodexTranscriptExportTarget,
    type CodexTranscriptRenderOptions,
    DEFAULT_CODEX_DIR,
    type MessageRecord,
    type SessionMeta,
    type ToolRecord,
} from './codex-thread-types';
import {
    buildHeadroomMetadataEntries,
    type HeadroomRehydrationContext,
    type HeadroomRehydrator,
    resolveHeadroomRehydrator,
} from './headroom-transcript-rehydration';
import {
    asObject,
    asString,
    cleanExtractedText,
    cleanInlineTitle,
    createExportWriteStream,
    type ExportFormat,
    finalizeExportWriteStream,
    formatInlineLiteral,
    formatModelLabel,
    type JsonValue,
    type MetadataEntry,
    readJsonlObjects,
    renderDocumentTitle,
    renderMetadataBlock,
    renderSection,
} from './shared';

export const renderCodexSessionFile = async (
    target: CodexTranscriptExportTarget,
    options: CodexTranscriptRenderOptions,
): Promise<string | null> => {
    let transcriptState: CodexTranscriptState;

    try {
        transcriptState = await collectCodexTranscript(target.sessionFile, options, target.thread?.model ?? null);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read Codex transcript ${target.sessionFile}: ${message}`);
    }

    if (transcriptState.sections.length === 0) {
        return null;
    }

    const title = getTitle(target, transcriptState.sessionMeta);
    const parts = [
        renderDocumentTitle(title, options.outputFormat),
        '',
        options.includeMetadata
            ? renderMetadataBlock(
                  buildMetadataEntries(
                      target,
                      transcriptState.sessionMeta,
                      options,
                      transcriptState.headroomRehydrator,
                  ),
                  options.outputFormat,
              )
            : '',
        ...transcriptState.sections,
    ].filter(Boolean);
    return parts.join('\n').trimEnd() + '\n';
};

type TranscriptTextTransform = (text: string) => string;

export const writeCodexSessionFileExport = async (
    target: CodexTranscriptExportTarget,
    options: CodexTranscriptRenderOptions,
    outputPath: string,
    transform: TranscriptTextTransform = (text) => text,
): Promise<boolean> => {
    const transcriptOutputPath = `${outputPath}.transcript.tmp`;
    let transcriptStream: any = null;
    const state: CodexTranscriptState = {
        assistantModel: target.thread?.model ?? null,
        headroomRehydrator: getHeadroomRehydrator(options),
        sections: [],
        sessionMeta: {},
    };
    let wroteSection = false;

    try {
        transcriptStream = await createExportWriteStream(transcriptOutputPath);
        for await (const parsed of readJsonlObjects(target.sessionFile)) {
            captureSessionMeta(parsed, state.sessionMeta);
            const block = renderCodexTranscriptRecord(parsed, options, state);
            if (!block) {
                continue;
            }

            transcriptStream.write(transform(wroteSection ? `${getSectionSeparator()}${block}` : block));
            wroteSection = true;
        }
        await finalizeExportWriteStream(transcriptStream);
        transcriptStream = null;

        if (!wroteSection) {
            return false;
        }

        const outputStream = await createExportWriteStream(outputPath);
        try {
            const prefix = buildStreamExportPrefix(target, state.sessionMeta, options, state.headroomRehydrator);
            if (prefix) {
                outputStream.write(transform(prefix));
            }

            const transcriptReadStream = createReadStream(transcriptOutputPath, { encoding: 'utf8' });
            transcriptReadStream.pipe(outputStream, { end: false });
            await finished(transcriptReadStream);
            outputStream.write('\n');
            await finalizeExportWriteStream(outputStream);
        } catch (error) {
            outputStream.destroy();
            throw error;
        }

        return true;
    } catch (error) {
        if (transcriptStream) {
            transcriptStream.destroy();
        }
        throw error;
    } finally {
        await rm(transcriptOutputPath, { force: true });
    }
};

type CodexTranscriptState = {
    assistantModel: string | null;
    headroomRehydrator: HeadroomRehydrator | null;
    sessionMeta: SessionMeta;
    sections: string[];
};

const collectCodexTranscript = async (
    sessionFile: string,
    options: CodexTranscriptRenderOptions,
    assistantModel: string | null = null,
): Promise<CodexTranscriptState> => {
    const state: CodexTranscriptState = {
        assistantModel,
        headroomRehydrator: getHeadroomRehydrator(options),
        sections: [],
        sessionMeta: {},
    };

    for await (const parsed of readJsonlObjects(sessionFile)) {
        processCodexTranscriptRecord(parsed, options, state);
    }

    return state;
};

const getSectionSeparator = () => '\n';

const processCodexTranscriptRecord = (
    parsed: Record<string, JsonValue>,
    options: CodexTranscriptRenderOptions,
    state: CodexTranscriptState,
) => {
    captureSessionMeta(parsed, state.sessionMeta);
    const block = renderCodexTranscriptRecord(parsed, options, state);
    if (block) {
        state.sections.push(block);
    }
};

const renderCodexTranscriptRecord = (
    parsed: Record<string, JsonValue>,
    options: CodexTranscriptRenderOptions,
    state: CodexTranscriptState,
) => {
    const message = extractMessageRecord(parsed);
    if (message) {
        return processCodexMessageRecord(message, options, state);
    }

    if (!options.includeTools) {
        return '';
    }

    const tool = extractToolRecord(parsed);
    if (!tool) {
        return '';
    }

    return renderToolBlock(tool, options.outputFormat, state);
};

const processCodexMessageRecord = (
    message: MessageRecord,
    options: CodexTranscriptRenderOptions,
    state: CodexTranscriptState,
) => {
    return renderMessageBlock(message, options.outputFormat, state, options.includeCommentary);
};

const buildStreamExportPrefix = (
    target: CodexTranscriptExportTarget,
    sessionMeta: SessionMeta,
    options: CodexTranscriptRenderOptions,
    rehydrator: HeadroomRehydrator | null,
) => {
    const title = getTitle(target, sessionMeta);
    if (!options.includeMetadata) {
        return `${renderDocumentTitle(title, options.outputFormat)}\n`;
    }

    const parts = [
        renderDocumentTitle(title, options.outputFormat),
        '',
        renderMetadataBlock(buildMetadataEntries(target, sessionMeta, options, rehydrator), options.outputFormat),
    ]
        .filter(Boolean)
        .join('\n');

    return `${parts}\n`;
};

export const formatToolOutputSummary = (outputText: string, outputFormat: ExportFormat): string => {
    if (!outputText) {
        return '';
    }

    const lines = outputText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length === 0) {
        return '';
    }

    const summaryLines: string[] = [];
    const command = lines.find((line) => line.startsWith('Command: '));
    const exit = lines.find((line) => line.startsWith('Process exited with code '));
    const wall = lines.find((line) => line.startsWith('Wall time: '));

    if (command) {
        summaryLines.push(command);
    }
    if (exit) {
        summaryLines.push(exit);
    }
    if (wall) {
        summaryLines.push(wall);
    }

    if (outputFormat === 'md') {
        return summaryLines.map((line) => `*${line}*`).join('\n');
    }

    return summaryLines.join('\n');
};

export const parseExecCommandArguments = (argumentsText?: string) => {
    if (!argumentsText) {
        return { argumentsParseFailed: false, cmd: null as string | null, workdir: null as string | null };
    }

    try {
        const parsed = JSON.parse(argumentsText) as Record<string, unknown>;
        return {
            argumentsParseFailed: false,
            cmd: typeof parsed.cmd === 'string' ? parsed.cmd : null,
            workdir: typeof parsed.workdir === 'string' ? parsed.workdir : null,
        };
    } catch {
        return { argumentsParseFailed: true, cmd: null as string | null, workdir: null as string | null };
    }
};

const getTitle = (target: CodexTranscriptExportTarget, sessionMeta: SessionMeta): string => {
    if (target.thread?.title) {
        return cleanInlineTitle(target.thread.title);
    }

    return sessionMeta.id ?? path.basename(target.sessionFile, '.jsonl');
};

const toCodexRelativePath = (targetPath: string): string => {
    const codexRoot = path.resolve(DEFAULT_CODEX_DIR);
    const normalized = path.resolve(targetPath);

    if (normalized.startsWith(`${codexRoot}${path.sep}`)) {
        return path.relative(codexRoot, normalized);
    }

    return normalized;
};

const buildMetadataEntries = (
    target: CodexTranscriptExportTarget,
    sessionMeta: SessionMeta,
    options: CodexTranscriptRenderOptions,
    rehydrator: HeadroomRehydrator | null,
): MetadataEntry[] => {
    return [
        ...buildCodexExportIdentityMetadata(target, sessionMeta),
        ...buildCodexExportPathMetadata(target, options),
        ...buildHeadroomMetadataEntries(rehydrator),
        ...buildCodexRelationMetadata(target),
        ...buildCodexThreadMetadata(target, sessionMeta),
        ...buildCodexAgentMetadata(target),
    ];
};

const buildCodexExportIdentityMetadata = (
    target: CodexTranscriptExportTarget,
    sessionMeta: SessionMeta,
): MetadataEntry[] => {
    const thread = target.thread;

    return [
        {
            key: 'exported_from',
            value: thread ? 'thread_db_and_session_jsonl' : 'session_jsonl_fallback',
        },
        { key: 'fallback_reason', value: target.fallbackReason },
        { key: 'thread_id', value: thread?.id ?? sessionMeta.id ?? null },
        { key: 'title', value: thread?.title || null },
    ];
};

const buildCodexExportPathMetadata = (
    target: CodexTranscriptExportTarget,
    options: CodexTranscriptRenderOptions,
): MetadataEntry[] => {
    const relativeOutputPath = target.outputRelativePath;

    return [
        { key: 'source_output_relative_path', value: relativeOutputPath },
        {
            key: options.outputFormat === 'md' ? 'source_markdown_path' : 'source_text_path',
            value: relativeOutputPath,
        },
        { key: 'rollout_path', value: target.sessionFile },
        {
            key: 'rollout_path_relative_to_codex',
            value: toCodexRelativePath(target.sessionFile),
        },
    ];
};

const buildCodexRelationMetadata = (target: CodexTranscriptExportTarget): MetadataEntry[] => {
    const childThreadIds = target.relations.childEdges.map((edge) => edge.child_thread_id);
    const childEdges = target.relations.childEdges.map((edge) => ({
        child_thread_id: edge.child_thread_id,
        status: edge.status,
    }));

    return [
        { key: 'parent_thread_id', value: target.relations.parentThreadId },
        { key: 'child_thread_ids', value: childThreadIds },
        { key: 'spawn_edges', value: childEdges },
    ];
};

const buildCodexThreadMetadata = (target: CodexTranscriptExportTarget, sessionMeta: SessionMeta): MetadataEntry[] => {
    return [
        ...buildCodexThreadTimingMetadata(target, sessionMeta),
        ...buildCodexThreadIdentityMetadata(target, sessionMeta),
    ];
};

const buildCodexThreadTimingMetadata = (
    target: CodexTranscriptExportTarget,
    sessionMeta: SessionMeta,
): MetadataEntry[] => {
    const thread = target.thread;

    return [
        { key: 'created_at_unix', value: thread?.created_at ?? null },
        { key: 'created_at_iso', value: formatUnixSeconds(thread?.created_at ?? null) },
        { key: 'updated_at_unix', value: thread?.updated_at ?? null },
        { key: 'updated_at_iso', value: formatUnixSeconds(thread?.updated_at ?? null) },
        { key: 'archived_at_unix', value: thread?.archived_at ?? null },
        { key: 'archived_at_iso', value: formatUnixSeconds(thread?.archived_at ?? null) },
        { key: 'session_started_at_iso', value: sessionMeta.timestamp ?? null },
    ];
};

const buildCodexThreadIdentityMetadata = (
    target: CodexTranscriptExportTarget,
    sessionMeta: SessionMeta,
): MetadataEntry[] => {
    const thread = target.thread;

    return [
        { key: 'archived', value: thread ? Boolean(thread.archived) : null },
        { key: 'source', value: thread?.source ?? sessionMeta.source ?? null },
        { key: 'originator', value: sessionMeta.originator ?? null },
        { key: 'model_provider', value: thread?.model_provider ?? null },
        { key: 'model', value: thread?.model ?? null },
        { key: 'reasoning_effort', value: thread?.reasoning_effort ?? null },
        {
            key: 'cli_version',
            value: thread?.cli_version || sessionMeta.cli_version || null,
        },
        { key: 'cwd', value: thread?.cwd || sessionMeta.cwd || null },
        { key: 'approval_mode', value: thread?.approval_mode ?? null },
        {
            key: 'sandbox_policy',
            value: parseJsonSafely(thread?.sandbox_policy ?? null),
        },
        { key: 'memory_mode', value: thread?.memory_mode ?? null },
        { key: 'tokens_used', value: thread?.tokens_used ?? null },
        { key: 'has_user_event', value: thread ? Boolean(thread.has_user_event) : null },
    ];
};

const buildCodexAgentMetadata = (target: CodexTranscriptExportTarget): MetadataEntry[] => {
    const thread = target.thread;

    return [
        { key: 'git_sha', value: thread?.git_sha ?? null },
        { key: 'git_branch', value: thread?.git_branch ?? null },
        { key: 'git_origin_url', value: thread?.git_origin_url ?? null },
        { key: 'agent_nickname', value: thread?.agent_nickname ?? null },
        { key: 'agent_role', value: thread?.agent_role ?? null },
        { key: 'agent_path', value: thread?.agent_path ?? null },
        { key: 'first_user_message', value: thread?.first_user_message || null },
    ];
};

const parseJsonSafely = (value: string | null): unknown => {
    if (!value) {
        return null;
    }

    try {
        return JSON.parse(value) as unknown;
    } catch {
        return value;
    }
};

const formatUnixSeconds = (value: number | null): string | null => {
    if (value === null || value === undefined) {
        return null;
    }

    return new Date(value * 1000).toISOString();
};

const captureSessionMeta = (parsed: Record<string, JsonValue>, meta: SessionMeta) => {
    if (parsed.type !== 'session_meta') {
        return;
    }

    const payload = asObject(parsed.payload);
    if (!payload) {
        return;
    }

    meta.id = asString(payload.id) ?? meta.id;
    meta.timestamp = asString(payload.timestamp) ?? meta.timestamp;
    meta.cwd = asString(payload.cwd) ?? meta.cwd;
    meta.source = asString(payload.source) ?? meta.source;
    meta.originator = asString(payload.originator) ?? meta.originator;
    meta.cli_version = asString(payload.cli_version) ?? meta.cli_version;
};

const getHeadroomRehydrator = (options: CodexTranscriptRenderOptions): HeadroomRehydrator | null => {
    return options.headroomRehydrator ?? resolveHeadroomRehydrator(options);
};

const getCodexHeadroomContext = (state: CodexTranscriptState, message?: MessageRecord): HeadroomRehydrationContext => ({
    client: state.sessionMeta.originator ?? state.sessionMeta.source ?? 'codex',
    model: message?.model ?? state.assistantModel,
    provider: state.sessionMeta.model_provider,
    sessionId: state.sessionMeta.id,
});

const rehydrateCodexText = (text: string, state: CodexTranscriptState, message?: MessageRecord): string => {
    return state.headroomRehydrator?.rehydrateText(text, getCodexHeadroomContext(state, message)) ?? text;
};

const extractMessageRecord = (parsed: Record<string, JsonValue>): MessageRecord | null => {
    if (parsed.type === 'message') {
        const directMessage = normalizeMessage(parsed);
        if (directMessage) {
            return directMessage;
        }
    }

    if (parsed.type !== 'response_item') {
        return null;
    }

    const payload = asObject(parsed.payload);
    if (!payload) {
        return null;
    }

    if (payload.type !== 'message' && payload.type !== 'agent_message' && payload.type !== 'user_message') {
        return null;
    }

    return normalizeMessage(payload);
};

const normalizeMessage = (value: Record<string, JsonValue>): MessageRecord | null => {
    const type = asString(value.type);
    const role =
        asString(value.role) ?? (type === 'agent_message' ? 'assistant' : type === 'user_message' ? 'user' : null);
    const content = value.content ?? asString(value.message);
    const phase = asString(value.phase);

    if (!role || content === undefined) {
        return null;
    }

    return { content, model: asString(value.model), phase: phase ?? undefined, role };
};

const extractToolRecord = (parsed: Record<string, JsonValue>): ToolRecord | null => {
    if (parsed.type !== 'response_item') {
        return null;
    }

    const payload = asObject(parsed.payload);
    if (!payload) {
        return null;
    }

    if (payload.type === 'function_call') {
        const name = asString(payload.name);
        const argumentsText = asString(payload.arguments);
        const callId = asString(payload.call_id);

        if (name !== 'exec_command') {
            return null;
        }

        return {
            argumentsText: argumentsText ?? undefined,
            callId,
            kind: 'call',
            name,
        };
    }

    if (payload.type === 'function_call_output') {
        const callId = asString(payload.call_id);
        const outputText = asString(payload.output);

        if (!outputText?.includes('Command: ')) {
            return null;
        }

        return {
            callId,
            kind: 'output',
            name: 'function_call_output',
            outputText: outputText ?? undefined,
        };
    }

    return null;
};

const renderMessageBlock = (
    message: MessageRecord,
    outputFormat: ExportFormat,
    state: CodexTranscriptState,
    includeCommentary: boolean,
): string => {
    if (message.role !== 'user' && message.role !== 'assistant') {
        return '';
    }

    if (message.role === 'assistant' && message.phase === 'commentary' && !includeCommentary) {
        return '';
    }

    const extractedText = rehydrateCodexText(extractText(message.content), state, message);
    const text = cleanExtractedText(stripPreviewBlock(extractedText)).trim();
    if (!text || shouldSkipMessage(message.role, text)) {
        return '';
    }

    const title = message.role === 'user' ? 'User' : formatModelLabel(message.model ?? state.assistantModel);
    const body = message.phase ? `Phase: ${message.phase}\n\n${text}` : text;

    return renderSection(title, body, outputFormat);
};

const renderToolBlock = (tool: ToolRecord, outputFormat: ExportFormat, state?: CodexTranscriptState): string => {
    if (tool.kind === 'call') {
        const details = formatToolCallDetails(tool, outputFormat);
        return details ? renderSection('Tool', details, outputFormat) : '';
    }

    const outputText = state ? rehydrateCodexText(tool.outputText ?? '', state) : (tool.outputText ?? '');
    const summary = formatToolOutputSummary(outputText, outputFormat);
    return summary ? renderSection('Tool Output', summary, outputFormat) : '';
};

const stripPreviewBlock = (text: string): string => {
    const parts = text
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter(Boolean);

    if (parts.length < 2) {
        return text.trim();
    }

    const first = parts[0];
    const second = parts[1];
    const isTranscriptHeading = (value: string) => /^##\s+.+$/i.test(value);
    const looksLikePreview =
        !/^([UA]):/i.test(first) &&
        !isTranscriptHeading(first) &&
        /^([UA]):/i.test(second) === false &&
        isTranscriptHeading(second);

    if (!looksLikePreview) {
        return text.trim();
    }

    return parts.slice(1).join('\n\n');
};

const shouldSkipMessage = (role: string, text: string): boolean => {
    if (text.startsWith('<environment_context>')) {
        return true;
    }

    if (text.startsWith('AGENTS.md instructions for ')) {
        return true;
    }

    if (text.startsWith('# AGENTS.md instructions for ')) {
        return true;
    }

    if (role === 'user' && text.includes('<environment_context>')) {
        return true;
    }

    return false;
};

const formatToolCallDetails = (tool: ToolRecord, outputFormat: ExportFormat): string => {
    if (tool.name !== 'exec_command') {
        return '';
    }

    const details = parseExecCommandArguments(tool.argumentsText);
    return details.cmd ? `Command: ${formatInlineLiteral(details.cmd, outputFormat)}` : '';
};

const extractText = (content: JsonValue): string => {
    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        const parts = content.map((item) => extractContentPart(item)).filter((part) => part.length > 0);
        return parts.join('\n\n');
    }

    if (content && typeof content === 'object') {
        const text = asString((content as Record<string, JsonValue>).text);
        if (text) {
            return text;
        }
    }

    return '';
};

const extractContentPart = (value: JsonValue): string => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return '';
    }

    const item = value as Record<string, JsonValue>;
    const type = asString(item.type);
    const text = asString(item.text);

    if ((type === 'input_text' || type === 'output_text' || type === 'text') && text) {
        return text;
    }

    if (type === 'input_image') {
        return '[Image attached]';
    }

    return text ?? '';
};
