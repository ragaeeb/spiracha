import { access, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
    asBoolean,
    asNumber,
    asObject,
    asString,
    CliUsageError,
    cleanExtractedText,
    cleanInlineTitle,
    type ExportFormat,
    expandHome,
    formatInlineLiteral,
    type JsonValue,
    type MetadataEntry,
    readJsonlObjects,
    renderCodeBlock,
    renderDocumentTitle,
    renderMetadataBlock,
    renderSection,
    writeExportFile,
} from './shared';

export type ClaudeCliOptions = {
    inputPath: string;
    outputPath: string | null;
    outputFormat: ExportFormat;
    includeTools: boolean;
};

export type ClaudeExportResult = {
    outputPath: string;
    sourcePath: string;
};

type ClaudeExportMetadata = {
    sessionId?: string;
    cliSessionId?: string;
    cwd?: string;
    originCwd?: string;
    createdAt?: number;
    lastActivityAt?: number;
    model?: string;
    effort?: string;
    isArchived?: boolean;
    title?: string;
    titleSource?: string;
    permissionMode?: string;
    prNumber?: number;
    prUrl?: string;
    prRepository?: string;
    prState?: string;
    completedTurns?: number;
};

type ClaudeSource = {
    jsonlPath: string;
    metadataPath: string | null;
    metadata: ClaudeExportMetadata | null;
    outputBaseName: string;
};

type ClaudeSessionMeta = {
    sessionId?: string;
    cwd?: string;
    entrypoint?: string;
    version?: string;
    gitBranch?: string;
    model?: string;
    firstTimestamp?: string;
    lastTimestamp?: string;
};

type BashToolCall = {
    id: string;
    command: string;
};

type ConvertState = {
    bashCallsById: Map<string, BashToolCall>;
    firstUserText: string | null;
};

export const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), 'exports', 'claude');

export const parseClaudeCliArgs = (argv: string[]): ClaudeCliOptions => {
    let inputPath: string | null = null;
    let outputPath: string | null = null;
    let outputFormat: ExportFormat = 'md';
    let includeTools = false;

    for (let index = 0; index < argv.length; index += 1) {
        const nextIndex = applyClaudeCliArg(argv, index, {
            includeTools,
            inputPath,
            outputFormat,
            outputPath,
        });

        includeTools = nextIndex.state.includeTools;
        inputPath = nextIndex.state.inputPath;
        outputFormat = nextIndex.state.outputFormat;
        outputPath = nextIndex.state.outputPath;
        index = nextIndex.index;
    }

    if (!inputPath) {
        throw new CliUsageError('A Claude export path is required.');
    }

    return {
        includeTools,
        inputPath,
        outputFormat,
        outputPath,
    };
};

type ClaudeCliState = {
    inputPath: string | null;
    outputPath: string | null;
    outputFormat: ExportFormat;
    includeTools: boolean;
};

type ClaudeCliNext = {
    index: number;
    state: ClaudeCliState;
};

const applyClaudeCliArg = (argv: string[], index: number, state: ClaudeCliState): ClaudeCliNext => {
    const arg = argv[index];

    if (arg === '--input' || arg === '-i') {
        return {
            index: index + 1,
            state: {
                ...state,
                inputPath: expandHome(requireValue(argv[index + 1], arg)),
            },
        };
    }

    if (arg === '--output' || arg === '-o') {
        return {
            index: index + 1,
            state: {
                ...state,
                outputPath: expandHome(requireValue(argv[index + 1], arg)),
            },
        };
    }

    if (arg === '--tools') {
        return {
            index,
            state: {
                ...state,
                includeTools: true,
            },
        };
    }

    if (arg.startsWith('--output-format=')) {
        return {
            index,
            state: {
                ...state,
                outputFormat: parseExportFormat(arg.slice('--output-format='.length)),
            },
        };
    }

    if (arg === '--output-format') {
        return {
            index: index + 1,
            state: {
                ...state,
                outputFormat: parseExportFormat(requireValue(argv[index + 1], '--output-format')),
            },
        };
    }

    if (!arg.startsWith('-') && !state.inputPath) {
        return {
            index,
            state: {
                ...state,
                inputPath: expandHome(arg),
            },
        };
    }

    if (!arg.startsWith('-') && !state.outputPath) {
        return {
            index,
            state: {
                ...state,
                outputPath: expandHome(arg),
            },
        };
    }

    throw new CliUsageError(`Unknown argument: ${arg}`);
};

export const getClaudeHelpText = (): string => {
    return [
        'Export a Claude Code transcript JSONL to Markdown or TXT.',
        '',
        'Usage:',
        '  codex-chats-claude --input PATH [--output PATH] [--output-format md|txt] [--tools]',
        '  codex-chats-claude PATH [OUTPUT_PATH]',
        '',
        'Input:',
        '  PATH can be either the exported Claude .jsonl file or the export directory that contains metadata.json.',
        '',
        'Options:',
        '  --input, -i      Claude transcript file or export directory',
        '  --output, -o     Output file path, or output directory when no .md/.txt extension is supplied',
        '  --output-format  Output file format: md or txt (default: md)',
        '  --tools          Include Bash tool calls and their outputs',
        '  --help, -h       Show this help text',
        '',
        'Default output:',
        `  ${DEFAULT_OUTPUT_DIR}/<session-id>.md`,
    ].join('\n');
};

export const runClaudeExport = async (options: ClaudeCliOptions): Promise<ClaudeExportResult> => {
    const source = await resolveClaudeSource(options.inputPath);
    const outputPath = await resolveOutputPath(source, options);
    const content = await convertClaudeTranscript(source, outputPath, options);

    if (!content) {
        throw new Error(`No transcript content found in ${source.jsonlPath}`);
    }

    await writeExportFile(outputPath, content);

    return {
        outputPath,
        sourcePath: source.jsonlPath,
    };
};

const resolveClaudeSource = async (inputPath: string): Promise<ClaudeSource> => {
    const resolvedInput = path.resolve(inputPath);
    const stats = await lstat(resolvedInput).catch(() => null);

    if (!stats) {
        throw new Error(`Input path does not exist: ${resolvedInput}`);
    }

    if (stats.isFile()) {
        return await resolveClaudeFileSource(resolvedInput);
    }

    if (!stats.isDirectory()) {
        throw new Error(`Unsupported input path: ${resolvedInput}`);
    }

    return await resolveClaudeDirectorySource(resolvedInput);
};

const findMetadataPathForJsonl = async (jsonlPath: string): Promise<string | null> => {
    const parentMetadataPath = path.join(path.dirname(jsonlPath), 'metadata.json');
    return (await fileExists(parentMetadataPath)) ? parentMetadataPath : null;
};

const readClaudeMetadata = async (metadataPath: string | null): Promise<ClaudeExportMetadata | null> => {
    if (!metadataPath) {
        return null;
    }

    try {
        const raw = await Bun.file(metadataPath).text();
        return parseClaudeMetadata(JSON.parse(raw) as Record<string, JsonValue>);
    } catch {
        return null;
    }
};

const resolveOutputPath = async (source: ClaudeSource, options: ClaudeCliOptions): Promise<string> => {
    const fileName = `${source.outputBaseName}.${options.outputFormat}`;

    if (!options.outputPath) {
        return path.join(DEFAULT_OUTPUT_DIR, fileName);
    }

    const resolvedOutput = path.resolve(options.outputPath);
    const extension = path.extname(resolvedOutput).toLowerCase();

    if (extension === '.md' || extension === '.txt') {
        return resolvedOutput;
    }

    const stats = await lstat(resolvedOutput).catch(() => null);
    if (stats?.isDirectory()) {
        return path.join(resolvedOutput, fileName);
    }

    return path.join(resolvedOutput, fileName);
};

const convertClaudeTranscript = async (
    source: ClaudeSource,
    outputPath: string,
    options: ClaudeCliOptions,
): Promise<string | null> => {
    const sessionMeta: ClaudeSessionMeta = {
        cwd: source.metadata?.cwd ?? source.metadata?.originCwd,
        model: source.metadata?.model,
        sessionId: source.metadata?.cliSessionId ?? source.metadata?.sessionId,
    };
    const state: ConvertState = {
        bashCallsById: new Map(),
        firstUserText: null,
    };
    const sections: string[] = [];

    try {
        for await (const parsed of readJsonlObjects(source.jsonlPath)) {
            captureClaudeSessionMeta(parsed, sessionMeta);
            sections.push(...extractClaudeBlocks(parsed, options, state));
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read Claude transcript ${source.jsonlPath}: ${message}`);
    }

    if (sections.length === 0) {
        return null;
    }

    const title = getTitle(source, state, sessionMeta);
    const metadata = buildMetadataEntries(source, outputPath, sessionMeta);
    const parts = [
        renderDocumentTitle(title, options.outputFormat),
        '',
        renderMetadataBlock(metadata, options.outputFormat),
        ...sections,
    ].filter(Boolean);

    return parts.join('\n').trimEnd() + '\n';
};

const resolveClaudeFileSource = async (resolvedInput: string): Promise<ClaudeSource> => {
    if (!resolvedInput.endsWith('.jsonl')) {
        throw new Error(`Expected a .jsonl file, got: ${resolvedInput}`);
    }

    const metadataPath = await findMetadataPathForJsonl(resolvedInput);
    const metadata = await readClaudeMetadata(metadataPath);

    return {
        jsonlPath: resolvedInput,
        metadata,
        metadataPath,
        outputBaseName: metadata?.cliSessionId ?? path.basename(resolvedInput, '.jsonl'),
    };
};

const resolveClaudeDirectorySource = async (resolvedInput: string): Promise<ClaudeSource> => {
    const metadataPathCandidate = path.join(resolvedInput, 'metadata.json');
    const metadataPath = (await fileExists(metadataPathCandidate)) ? metadataPathCandidate : null;
    const metadata = await readClaudeMetadata(metadataPath);
    const jsonlPath = await findClaudeJsonlPath(resolvedInput, metadata);

    return {
        jsonlPath,
        metadata,
        metadataPath,
        outputBaseName: metadata?.cliSessionId ?? path.basename(jsonlPath, '.jsonl'),
    };
};

const findClaudeJsonlPath = async (resolvedInput: string, metadata: ClaudeExportMetadata | null): Promise<string> => {
    if (metadata?.cliSessionId) {
        const metadataJsonlPath = path.join(resolvedInput, `${metadata.cliSessionId}.jsonl`);
        if (await fileExists(metadataJsonlPath)) {
            return metadataJsonlPath;
        }
    }

    const files = (await readdir(resolvedInput, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
        .map((entry) => path.join(resolvedInput, entry.name))
        .sort();

    if (files.length === 1) {
        return files[0] ?? resolvedInput;
    }

    if (files.length > 1) {
        throw new Error(
            `Multiple top-level .jsonl files found in ${resolvedInput}; pass the specific transcript file instead.`,
        );
    }

    throw new Error(`No top-level Claude transcript .jsonl found in ${resolvedInput}`);
};

const parseClaudeMetadata = (parsed: Record<string, JsonValue>): ClaudeExportMetadata => ({
    ...buildClaudeMetadataIdentity(parsed),
    ...buildClaudeMetadataContext(parsed),
    ...buildClaudeMetadataActivity(parsed),
    ...buildClaudeMetadataProject(parsed),
});

const buildClaudeMetadataIdentity = (
    parsed: Record<string, JsonValue>,
): Pick<ClaudeExportMetadata, 'cliSessionId' | 'sessionId'> => ({
    cliSessionId: asString(parsed.cliSessionId) ?? undefined,
    sessionId: asString(parsed.sessionId) ?? undefined,
});

const buildClaudeMetadataContext = (
    parsed: Record<string, JsonValue>,
): Pick<
    ClaudeExportMetadata,
    'cwd' | 'originCwd' | 'model' | 'effort' | 'permissionMode' | 'title' | 'titleSource'
> => ({
    cwd: asString(parsed.cwd) ?? undefined,
    effort: asString(parsed.effort) ?? undefined,
    model: asString(parsed.model) ?? undefined,
    originCwd: asString(parsed.originCwd) ?? undefined,
    permissionMode: asString(parsed.permissionMode) ?? undefined,
    title: asString(parsed.title) ?? undefined,
    titleSource: asString(parsed.titleSource) ?? undefined,
});

const buildClaudeMetadataActivity = (
    parsed: Record<string, JsonValue>,
): Pick<ClaudeExportMetadata, 'completedTurns' | 'createdAt' | 'lastActivityAt' | 'isArchived'> => ({
    completedTurns: asNumber(parsed.completedTurns) ?? undefined,
    createdAt: asNumber(parsed.createdAt) ?? undefined,
    isArchived: typeof parsed.isArchived === 'boolean' ? parsed.isArchived : undefined,
    lastActivityAt: asNumber(parsed.lastActivityAt) ?? undefined,
});

const buildClaudeMetadataProject = (
    parsed: Record<string, JsonValue>,
): Pick<ClaudeExportMetadata, 'prNumber' | 'prRepository' | 'prState' | 'prUrl'> => ({
    prNumber: asNumber(parsed.prNumber) ?? undefined,
    prRepository: asString(parsed.prRepository) ?? undefined,
    prState: asString(parsed.prState) ?? undefined,
    prUrl: asString(parsed.prUrl) ?? undefined,
});

const captureClaudeSessionMeta = (parsed: Record<string, JsonValue>, meta: ClaudeSessionMeta) => {
    meta.sessionId = asString(parsed.sessionId) ?? meta.sessionId;
    meta.cwd = asString(parsed.cwd) ?? meta.cwd;
    meta.entrypoint = asString(parsed.entrypoint) ?? meta.entrypoint;
    meta.version = asString(parsed.version) ?? meta.version;
    meta.gitBranch = asString(parsed.gitBranch) ?? meta.gitBranch;

    const timestamp = asString(parsed.timestamp);
    if (timestamp) {
        meta.firstTimestamp = meta.firstTimestamp && meta.firstTimestamp < timestamp ? meta.firstTimestamp : timestamp;
        meta.lastTimestamp = meta.lastTimestamp && meta.lastTimestamp > timestamp ? meta.lastTimestamp : timestamp;
    }

    const message = asObject(parsed.message);
    meta.model = asString(message?.model ?? null) ?? meta.model;
};

const extractClaudeBlocks = (
    parsed: Record<string, JsonValue>,
    options: ClaudeCliOptions,
    state: ConvertState,
): string[] => {
    if (asBoolean(parsed.isCompactSummary)) {
        return [];
    }

    const type = asString(parsed.type);
    if (type === 'assistant') {
        return extractAssistantBlocks(parsed, options, state);
    }

    if (type === 'user') {
        return extractUserBlocks(parsed, options, state);
    }

    return [];
};

const extractAssistantBlocks = (
    parsed: Record<string, JsonValue>,
    options: ClaudeCliOptions,
    state: ConvertState,
): string[] => {
    const message = asObject(parsed.message);
    if (!message || asString(message.role) !== 'assistant') {
        return [];
    }

    return extractBlocksFromContentSequence('assistant', message.content, options, state);
};

const extractUserBlocks = (
    parsed: Record<string, JsonValue>,
    options: ClaudeCliOptions,
    state: ConvertState,
): string[] => {
    const message = asObject(parsed.message);
    if (!message || asString(message.role) !== 'user') {
        return [];
    }

    return extractBlocksFromContentSequence('user', message.content, options, state);
};

const extractBlocksFromContentSequence = (
    role: 'user' | 'assistant',
    content: JsonValue,
    options: ClaudeCliOptions,
    state: ConvertState,
): string[] => {
    const items = Array.isArray(content) ? content : [content];
    const blocks: string[] = [];
    const textParts: string[] = [];

    const flushText = () => {
        const text = cleanExtractedText(textParts.join('\n\n')).trim();
        textParts.length = 0;

        if (!text) {
            return;
        }

        if (role === 'user' && !state.firstUserText) {
            state.firstUserText = text;
        }

        blocks.push(renderSection(role === 'user' ? 'User' : 'Assistant', text, options.outputFormat));
    };

    for (const item of items) {
        appendClaudeContentItem(item, options, state, blocks, textParts, flushText);
    }

    flushText();
    return blocks;
};

const appendClaudeContentItem = (
    item: JsonValue,
    options: ClaudeCliOptions,
    state: ConvertState,
    blocks: string[],
    textParts: string[],
    flushText: () => void,
) => {
    if (typeof item === 'string') {
        textParts.push(item);
        return;
    }

    const contentItem = asObject(item);
    if (!contentItem) {
        return;
    }

    appendClaudeStructuredContentItem(contentItem, options, state, blocks, textParts, flushText);
};

const appendClaudeStructuredContentItem = (
    contentItem: Record<string, JsonValue>,
    options: ClaudeCliOptions,
    state: ConvertState,
    blocks: string[],
    textParts: string[],
    flushText: () => void,
) => {
    const type = asString(contentItem.type);
    if (isClaudeTextContentType(type)) {
        appendClaudeTextContentItem(contentItem, textParts);
        return;
    }

    if (type === 'thinking') {
        flushText();
        return;
    }

    if (type === 'tool_use') {
        appendClaudeToolUseContentItem(contentItem, options, state, blocks, flushText);
        return;
    }

    if (type === 'tool_result') {
        appendClaudeToolResultContentItem(contentItem, options, state, blocks, flushText);
        return;
    }

    appendClaudeFallbackContentItem(contentItem, textParts);
};

const appendClaudeTextContentItem = (contentItem: Record<string, JsonValue>, textParts: string[]) => {
    const text = asString(contentItem.text);
    if (text) {
        textParts.push(text);
    }
};

const appendClaudeToolUseContentItem = (
    contentItem: Record<string, JsonValue>,
    options: ClaudeCliOptions,
    state: ConvertState,
    blocks: string[],
    flushText: () => void,
) => {
    flushText();
    captureBashToolCall(contentItem, state);

    if (options.includeTools) {
        const block = renderToolCallBlock(contentItem, options.outputFormat);
        if (block) {
            blocks.push(block);
        }
    }
};

const appendClaudeToolResultContentItem = (
    contentItem: Record<string, JsonValue>,
    options: ClaudeCliOptions,
    state: ConvertState,
    blocks: string[],
    flushText: () => void,
) => {
    flushText();

    if (options.includeTools) {
        const block = renderToolResultBlock(contentItem, state, options.outputFormat);
        if (block) {
            blocks.push(block);
        }
    }
};

const appendClaudeFallbackContentItem = (contentItem: Record<string, JsonValue>, textParts: string[]) => {
    const fallbackText = asString(contentItem.text);
    if (fallbackText) {
        textParts.push(fallbackText);
    }
};

const isClaudeTextContentType = (type: string | null): boolean =>
    type === 'text' || type === 'input_text' || type === 'output_text';

const captureBashToolCall = (contentItem: Record<string, JsonValue>, state: ConvertState) => {
    if (asString(contentItem.name) !== 'Bash') {
        return;
    }

    const toolId = asString(contentItem.id);
    const input = asObject(contentItem.input);
    const command = asString(input?.command ?? null);

    if (!toolId || !command) {
        return;
    }

    state.bashCallsById.set(toolId, {
        command,
        id: toolId,
    });
};

const renderToolCallBlock = (contentItem: Record<string, JsonValue>, outputFormat: ExportFormat): string => {
    if (asString(contentItem.name) !== 'Bash') {
        return '';
    }

    const input = asObject(contentItem.input);
    const command = asString(input?.command ?? null)?.trim();
    if (!command) {
        return '';
    }

    return renderSection('Tool', `Command: ${formatInlineLiteral(command, outputFormat)}`, outputFormat);
};

const renderToolResultBlock = (
    contentItem: Record<string, JsonValue>,
    state: ConvertState,
    outputFormat: ExportFormat,
): string => {
    const toolUseId = asString(contentItem.tool_use_id);
    if (!toolUseId || !state.bashCallsById.has(toolUseId)) {
        return '';
    }

    const outputText = cleanExtractedText(extractClaudeText(contentItem.content)).trim();
    if (!outputText) {
        return '';
    }

    const lines: string[] = [];
    if (asBoolean(contentItem.is_error)) {
        lines.push('Error: true', '');
    }
    lines.push(renderCodeBlock(outputText, outputFormat));

    return renderSection('Tool Output', lines.join('\n'), outputFormat);
};

const getTitle = (source: ClaudeSource, state: ConvertState, sessionMeta: ClaudeSessionMeta): string => {
    if (source.metadata?.title) {
        return cleanInlineTitle(source.metadata.title);
    }

    if (state.firstUserText) {
        return cleanInlineTitle(state.firstUserText);
    }

    return source.metadata?.cliSessionId ?? sessionMeta.sessionId ?? path.basename(source.jsonlPath, '.jsonl');
};

const buildMetadataEntries = (
    source: ClaudeSource,
    outputPath: string,
    sessionMeta: ClaudeSessionMeta,
): MetadataEntry[] => {
    return [
        { key: 'exported_from', value: 'claude_code_session_export_jsonl' },
        ...buildClaudeSourceMetadataEntries(source, outputPath),
        ...buildClaudeTimelineMetadataEntries(source, sessionMeta),
        ...buildClaudePullRequestMetadataEntries(source),
    ];
};

const buildClaudeSourceMetadataEntries = (source: ClaudeSource, outputPath: string): MetadataEntry[] => {
    return [
        {
            key: 'session_id',
            value: source.metadata?.cliSessionId ?? source.metadata?.sessionId ?? null,
        },
        { key: 'title', value: source.metadata?.title ?? null },
        { key: 'source_transcript_path', value: source.jsonlPath },
        { key: 'source_metadata_path', value: source.metadataPath },
        { key: 'output_path', value: outputPath },
    ];
};

const buildClaudeTimelineMetadataEntries = (source: ClaudeSource, sessionMeta: ClaudeSessionMeta): MetadataEntry[] => {
    return [
        {
            key: 'cwd',
            value: source.metadata?.cwd ?? source.metadata?.originCwd ?? sessionMeta.cwd ?? null,
        },
        { key: 'entrypoint', value: sessionMeta.entrypoint ?? null },
        { key: 'model', value: source.metadata?.model ?? sessionMeta.model ?? null },
        { key: 'effort', value: source.metadata?.effort ?? null },
        { key: 'permission_mode', value: source.metadata?.permissionMode ?? null },
        { key: 'is_archived', value: source.metadata?.isArchived ?? null },
        { key: 'completed_turns', value: source.metadata?.completedTurns ?? null },
        { key: 'created_at_unix_ms', value: source.metadata?.createdAt ?? null },
        { key: 'created_at_iso', value: formatUnixMillis(source.metadata?.createdAt ?? null) },
        {
            key: 'last_activity_at_unix_ms',
            value: source.metadata?.lastActivityAt ?? null,
        },
        {
            key: 'last_activity_at_iso',
            value: formatUnixMillis(source.metadata?.lastActivityAt ?? null),
        },
        { key: 'first_event_at_iso', value: sessionMeta.firstTimestamp ?? null },
        { key: 'last_event_at_iso', value: sessionMeta.lastTimestamp ?? null },
        { key: 'version', value: sessionMeta.version ?? null },
        { key: 'git_branch', value: sessionMeta.gitBranch ?? null },
    ];
};

const buildClaudePullRequestMetadataEntries = (source: ClaudeSource): MetadataEntry[] => {
    return [
        { key: 'pr_number', value: source.metadata?.prNumber ?? null },
        { key: 'pr_url', value: source.metadata?.prUrl ?? null },
        { key: 'pr_repository', value: source.metadata?.prRepository ?? null },
        { key: 'pr_state', value: source.metadata?.prState ?? null },
    ];
};

const formatUnixMillis = (value: number | null): string | null => {
    if (value === null || value === undefined) {
        return null;
    }

    return new Date(value).toISOString();
};

const extractClaudeText = (content: JsonValue): string => {
    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        return content
            .map((item) => extractClaudeContentPart(item))
            .filter((part) => part.length > 0)
            .join('\n\n');
    }

    const object = asObject(content);
    if (!object) {
        return '';
    }

    const type = asString(object.type);
    const text = asString(object.text);

    if ((type === 'text' || type === 'input_text' || type === 'output_text') && text) {
        return text;
    }

    return text ?? '';
};

const extractClaudeContentPart = (value: JsonValue): string => {
    if (typeof value === 'string') {
        return value;
    }

    const object = asObject(value);
    if (!object) {
        return '';
    }

    const type = asString(object.type);
    const text = asString(object.text);

    if ((type === 'text' || type === 'input_text' || type === 'output_text') && text) {
        return text;
    }

    return text ?? '';
};

const fileExists = async (targetPath: string): Promise<boolean> => {
    try {
        await access(targetPath);
        return true;
    } catch {
        return false;
    }
};

const requireValue = (value: string | undefined, flag: string): string => {
    if (!value || value.startsWith('--')) {
        throw new CliUsageError(`Missing value for ${flag}`);
    }

    return value;
};

const parseExportFormat = (value: string): ExportFormat => {
    if (value === 'md' || value === 'txt') {
        return value;
    }

    throw new CliUsageError(`Unsupported output format: ${value}`);
};
