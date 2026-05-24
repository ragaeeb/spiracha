import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { matchesFilters, toCodexRelativePath } from './codex-exporter-db';
import type { CodexCliOptions, ExportTarget, MessageRecord, SessionMeta, ToolRecord } from './codex-exporter-types';
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

export const convertSessionFile = async (target: ExportTarget, options: CodexCliOptions): Promise<string | null> => {
    let transcriptState: CodexTranscriptState;

    try {
        transcriptState = await collectCodexTranscript(target.sessionFile, options);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read Codex transcript ${target.sessionFile}: ${message}`);
    }

    if (!matchesFilters(target.thread?.cwd ?? transcriptState.sessionMeta.cwd ?? null, options)) {
        return null;
    }

    if (transcriptState.sections.length === 0) {
        return null;
    }

    if (options.optimized) {
        return transcriptState.sections.join('\n\n').trimEnd() + '\n';
    }

    const title = getTitle(target, transcriptState.sessionMeta);
    const metadata = buildMetadataEntries(target, transcriptState.sessionMeta, options);
    const parts = [
        renderDocumentTitle(title, options.outputFormat),
        '',
        renderMetadataBlock(metadata, options.outputFormat),
        ...transcriptState.sections,
    ].filter(Boolean);
    return parts.join('\n').trimEnd() + '\n';
};

type TranscriptTextTransform = (text: string) => string;

export const writeSessionFileExport = async (
    target: ExportTarget,
    options: CodexCliOptions,
    outputPath: string,
    transform: TranscriptTextTransform = (text) => text,
): Promise<boolean> => {
    const transcriptOutputPath = `${outputPath}.transcript.tmp`;
    const transcriptStream = await createExportWriteStream(transcriptOutputPath);
    const state: CodexTranscriptState = {
        sections: [],
        sessionMeta: {},
        startedTranscript: false,
    };
    let wroteSection = false;

    try {
        for await (const parsed of readJsonlObjects(target.sessionFile)) {
            captureSessionMeta(parsed, state.sessionMeta);
            const block = renderCodexTranscriptRecord(parsed, options, state);
            if (!block) {
                continue;
            }

            transcriptStream.write(transform(wroteSection ? `${getSectionSeparator(options)}${block}` : block));
            wroteSection = true;
        }
    } catch (error) {
        transcriptStream.destroy();
        throw error;
    }

    await finalizeExportWriteStream(transcriptStream);

    if (!matchesFilters(target.thread?.cwd ?? state.sessionMeta.cwd ?? null, options) || !wroteSection) {
        await rm(transcriptOutputPath, { force: true });
        return false;
    }

    const outputStream = await createExportWriteStream(outputPath);
    const prefix = buildStreamExportPrefix(target, state.sessionMeta, options);
    if (prefix) {
        outputStream.write(transform(prefix));
    }

    const transcriptReadStream = createReadStream(transcriptOutputPath, { encoding: 'utf8' });
    transcriptReadStream.pipe(outputStream, { end: false });
    await finished(transcriptReadStream);
    outputStream.write('\n');
    await finalizeExportWriteStream(outputStream);
    await rm(transcriptOutputPath, { force: true });
    return true;
};

type CodexTranscriptState = {
    sessionMeta: SessionMeta;
    sections: string[];
    startedTranscript: boolean;
};

const collectCodexTranscript = async (sessionFile: string, options: CodexCliOptions): Promise<CodexTranscriptState> => {
    const state: CodexTranscriptState = {
        sections: [],
        sessionMeta: {},
        startedTranscript: false,
    };

    for await (const parsed of readJsonlObjects(sessionFile)) {
        processCodexTranscriptRecord(parsed, options, state);
    }

    return state;
};

const getSectionSeparator = (options: CodexCliOptions) => {
    return options.optimized ? '\n\n' : '\n';
};

const processCodexTranscriptRecord = (
    parsed: Record<string, JsonValue>,
    options: CodexCliOptions,
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
    options: CodexCliOptions,
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

    return options.optimized
        ? renderCompactToolBlock(tool, options.outputFormat)
        : renderToolBlock(tool, options.outputFormat);
};

const processCodexMessageRecord = (message: MessageRecord, options: CodexCliOptions, state: CodexTranscriptState) => {
    if (options.optimized) {
        return processOptimizedCodexMessageRecord(message, options, state);
    }

    return renderMessageBlock(message, options.outputFormat);
};

const processOptimizedCodexMessageRecord = (
    message: MessageRecord,
    options: CodexCliOptions,
    state: CodexTranscriptState,
) => {
    if (message.role !== 'user' && message.role !== 'assistant') {
        return '';
    }

    const compact = compactMessageText(message, true);
    if (!compact) {
        return '';
    }

    if (!state.startedTranscript) {
        if (shouldSkipOptimizedPrelude(message.role, compact)) {
            return '';
        }
        state.startedTranscript = true;
    }

    return renderCompactBlock(message, compact, options.outputFormat);
};

const buildStreamExportPrefix = (target: ExportTarget, sessionMeta: SessionMeta, options: CodexCliOptions) => {
    if (options.optimized) {
        return '';
    }

    const title = getTitle(target, sessionMeta);
    const metadata = buildMetadataEntries(target, sessionMeta, options);
    const parts = [
        renderDocumentTitle(title, options.outputFormat),
        '',
        renderMetadataBlock(metadata, options.outputFormat),
    ]
        .filter(Boolean)
        .join('\n');

    return `${parts}\n`;
};

export const compactMessageText = (message: MessageRecord, optimized: boolean): string => {
    const rawText = extractText(message.content);
    const cleaned = stripPreviewBlock(rawText);

    return optimized ? optimizePlainText(optimizeRenderedText(cleaned)) : cleaned.trim();
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

const getTitle = (target: ExportTarget, sessionMeta: SessionMeta): string => {
    if (target.thread?.title) {
        return cleanInlineTitle(target.thread.title);
    }

    return sessionMeta.id ?? path.basename(target.sessionFile, '.jsonl');
};

const shouldSkipOptimizedPrelude = (role: string, text: string): boolean => {
    if (role !== 'user') {
        return true;
    }

    return (
        text.startsWith('AGENTS.md instructions for ') ||
        text.startsWith('# AGENTS.md instructions for ') ||
        text.startsWith('<permissions instructions>') ||
        text.startsWith('<environment_context>') ||
        text.startsWith('<app-context>') ||
        text.startsWith('<collaboration_mode>') ||
        text.startsWith('<skills_instructions>') ||
        text.startsWith('You are Codex, a coding agent based on GPT-5.') ||
        text.startsWith('Read this before making changes.') ||
        text.includes('Filesystem sandboxing defines which files can be read or written.') ||
        text.includes('approval_policy') ||
        text.includes('base_instructions')
    );
};

const buildMetadataEntries = (
    target: ExportTarget,
    sessionMeta: SessionMeta,
    options: CodexCliOptions,
): MetadataEntry[] => {
    return [
        ...buildCodexExportIdentityMetadata(target, sessionMeta),
        ...buildCodexExportPathMetadata(target, options),
        ...buildCodexRelationMetadata(target),
        ...buildCodexThreadMetadata(target, sessionMeta),
        ...buildCodexAgentMetadata(target),
    ];
};

const buildCodexExportIdentityMetadata = (target: ExportTarget, sessionMeta: SessionMeta): MetadataEntry[] => {
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

const buildCodexExportPathMetadata = (target: ExportTarget, options: CodexCliOptions): MetadataEntry[] => {
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

const buildCodexRelationMetadata = (target: ExportTarget): MetadataEntry[] => {
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

const buildCodexThreadMetadata = (target: ExportTarget, sessionMeta: SessionMeta): MetadataEntry[] => {
    return [
        ...buildCodexThreadTimingMetadata(target, sessionMeta),
        ...buildCodexThreadIdentityMetadata(target, sessionMeta),
    ];
};

const buildCodexThreadTimingMetadata = (target: ExportTarget, sessionMeta: SessionMeta): MetadataEntry[] => {
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

const buildCodexThreadIdentityMetadata = (target: ExportTarget, sessionMeta: SessionMeta): MetadataEntry[] => {
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

const buildCodexAgentMetadata = (target: ExportTarget): MetadataEntry[] => {
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
    if (!payload || payload.type !== 'message') {
        return null;
    }

    return normalizeMessage(payload);
};

const normalizeMessage = (value: Record<string, JsonValue>): MessageRecord | null => {
    const role = asString(value.role);
    const content = value.content;
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

const renderMessageBlock = (message: MessageRecord, outputFormat: ExportFormat): string => {
    if (message.role !== 'user' && message.role !== 'assistant') {
        return '';
    }

    const text = cleanExtractedText(extractText(message.content)).trim();
    if (!text || shouldSkipMessage(message.role, text)) {
        return '';
    }

    const title = message.role === 'user' ? 'User' : formatModelLabel(message.model);
    const body = message.phase ? `Phase: ${message.phase}\n\n${text}` : text;

    return renderSection(title, body, outputFormat);
};

const renderToolBlock = (tool: ToolRecord, outputFormat: ExportFormat): string => {
    if (tool.kind === 'call') {
        const details = formatToolCallDetails(tool, outputFormat);
        return details ? renderSection('Tool', details, outputFormat) : '';
    }

    const summary = formatToolOutputSummary(tool.outputText ?? '', outputFormat);
    return summary ? renderSection('Tool Output', summary, outputFormat) : '';
};

const renderCompactBlock = (message: MessageRecord, text: string, outputFormat: ExportFormat): string => {
    const prefix = message.role === 'user' ? 'U:' : `${formatModelLabel(message.model)}:`;
    const lines = text.split('\n');
    const [firstLine, ...rest] = lines;

    if (rest.length === 0) {
        return `${prefix} ${normalizeCompactLiteral(firstLine, outputFormat)}`;
    }

    return [
        `${prefix} ${normalizeCompactLiteral(firstLine, outputFormat)}`,
        ...rest.map((line) => normalizeCompactLiteral(line, outputFormat)),
    ].join('\n');
};

const renderCompactToolBlock = (tool: ToolRecord, outputFormat: ExportFormat): string => {
    if (tool.kind === 'call') {
        const details = formatCompactToolCall(tool, outputFormat);
        return details ? `T: ${details}` : '';
    }

    const summary = formatCompactToolOutput(tool.outputText ?? '');
    return summary ? `R: ${summary}` : '';
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

const optimizeRenderedText = (text: string): string => {
    return text
        .replace(/^\*Phase:\s+`[^`]+`\*\s*\n*/gm, '')
        .replace(/^\s*<image\b[^>]*>\s*$/gim, '')
        .replace(/^\s*<\/image>\s*$/gim, '')
        .replace(/^\s*\[Image attached\]\s*$/gim, '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^```[^\n]*\n?/gm, '')
        .replace(/\n```$/gm, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^##\s+User\s*$/gm, 'User:')
        .replace(/^##\s+Assistant\s*$/gm, 'Assistant:')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*\n]+)\*/g, '$1')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};

const optimizePlainText = (text: string): string => {
    const normalized = text
        .replace(/\r/g, '')
        .replace(/^\s*<image\b[^>]*>\s*$/gim, '')
        .replace(/^\s*<\/image>\s*$/gim, '')
        .replace(/^\s*\[Image attached\]\s*$/gim, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*\n]+)\*/g, '$1');

    return normalized
        .split('\n')
        .map((line) => line.replace(/[ \t]+$/g, ''))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};

const shouldSkipMessage = (role: string, text: string): boolean => {
    if (text.startsWith('<environment_context>')) {
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

const formatCompactToolCall = (tool: ToolRecord, outputFormat: ExportFormat): string => {
    if (tool.name === 'exec_command') {
        const details = parseExecCommandArguments(tool.argumentsText);
        if (!details.cmd) {
            return 'exec_command';
        }

        const command = formatInlineLiteral(details.cmd, outputFormat);
        return details.workdir ? `exec_command ${command} @ ${details.workdir}` : `exec_command ${command}`;
    }

    return tool.callId ? `${tool.name} (${tool.callId})` : tool.name;
};

const formatCompactToolOutput = (outputText: string): string => {
    if (!outputText) {
        return '';
    }

    const lines = outputText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const exit = lines.find((line) => line.startsWith('Process exited with code '));
    const wall = lines.find((line) => line.startsWith('Wall time: '));

    if (exit && wall) {
        return `${exit.replace('Process ', '')}; ${wall.toLowerCase()}`;
    }

    if (exit) {
        return exit.replace('Process ', '');
    }

    return '';
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

const normalizeCompactLiteral = (value: string, outputFormat: ExportFormat): string => {
    return outputFormat === 'md' ? value : value.replace(/`([^`]+)`/g, '$1');
};
