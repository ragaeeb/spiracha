import path from 'node:path';
import type { ParsedCodexTranscript } from './codex-browser-types';
import { parseCodexTranscriptFile } from './codex-thread-parser';
import {
    type CodexTranscriptExportTarget,
    type CodexTranscriptRenderOptions,
    DEFAULT_CODEX_DIR,
    type SessionMeta,
} from './codex-thread-types';
import { normalizeCodexEvents } from './conversation-data/codex-messages';
import { renderSelectedTranscriptExport } from './conversation-data/conversation-export';
import { createExportWriteStream, finalizeExportWriteStream } from './shared';
import { cleanInlineTitle, type MetadataEntry } from './shared-text';
import { runWithTranscriptLoadLimit } from './transcript-load-limiter';

type TranscriptTextTransform = (text: string) => string;

const loadCodexTranscript = async (target: CodexTranscriptExportTarget): Promise<ParsedCodexTranscript> => {
    try {
        return await runWithTranscriptLoadLimit(
            () => parseCodexTranscriptFile(target.sessionFile, { includeRaw: false }),
            {
                id: target.thread?.id,
                integration: 'codex',
                operation: 'export-inline',
                path: target.sessionFile,
            },
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read Codex transcript ${target.sessionFile}: ${message}`);
    }
};

const renderLoadedCodexTranscript = (
    target: CodexTranscriptExportTarget,
    transcript: ParsedCodexTranscript,
    options: CodexTranscriptRenderOptions,
): string | null => {
    const model = target.thread?.model;
    return renderSelectedTranscriptExport(
        {
            bodyAvailability: 'full',
            messages: normalizeCodexEvents(transcript.events),
            metadata: Object.fromEntries(
                buildMetadataEntries(target, transcript.sessionMeta, options).map((entry) => [entry.key, entry.value]),
            ),
            ...(model ? { model } : {}),
            title: getTitle(target, transcript.sessionMeta),
        },
        options,
    );
};

export const renderCodexSessionFile = async (
    target: CodexTranscriptExportTarget,
    options: CodexTranscriptRenderOptions,
): Promise<string | null> => {
    return renderLoadedCodexTranscript(target, await loadCodexTranscript(target), options);
};

export const writeCodexSessionFileExport = async (
    target: CodexTranscriptExportTarget,
    options: CodexTranscriptRenderOptions,
    outputPath: string,
    transform: TranscriptTextTransform = (text) => text,
): Promise<boolean> => {
    const content = await renderCodexSessionFile(target, options);
    if (!content) {
        return false;
    }

    const outputStream = await createExportWriteStream(outputPath);
    try {
        outputStream.write(transform(content));
        await finalizeExportWriteStream(outputStream);
        return true;
    } catch (error) {
        outputStream.destroy();
        throw error;
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
): MetadataEntry[] => {
    return [
        ...buildCodexExportIdentityMetadata(target, sessionMeta),
        ...buildCodexExportPathMetadata(target, options),
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
