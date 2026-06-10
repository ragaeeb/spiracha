import path from 'node:path';
import {
    findCursorWorkspaceGroups,
    listCursorThreadsForGroup,
    listCursorWorkspaceGroups,
    readCursorThreadHead,
    readCursorThreadTranscriptWithAgentFiles,
} from './cursor-db';
import {
    type CursorCliOptions,
    type CursorExportedFile,
    type CursorExportRunResult,
    type CursorThreadSummary,
    type CursorWorkspaceGroup,
    getCursorGlobalDbPath,
    resolveCursorUserDir,
} from './cursor-exporter-types';
import { renderCursorTranscript } from './cursor-transcript';
import { CliUsageError, type ExportFormat, expandHome, writeExportFile } from './shared';

export const DEFAULT_CURSOR_OUTPUT_DIR = path.join(process.cwd(), 'exports', 'cursor');

const resolveSingleGroup = (groups: CursorWorkspaceGroup[], query: string): CursorWorkspaceGroup => {
    const matched = findCursorWorkspaceGroups(groups, query);
    if (matched.length === 0) {
        throw new Error(`No Cursor workspace matched query: ${query}`);
    }

    if (matched.length > 1) {
        const keys = matched.map((group) => `  - ${group.key}`).join('\n');
        throw new Error(
            `Query "${query}" matched multiple Cursor workspaces. Refine it to a folder path or .code-workspace file:\n${keys}`,
        );
    }

    return matched[0]!;
};

const collectThreadsToExport = async (
    options: CursorCliOptions,
): Promise<{ threads: CursorThreadSummary[]; missingThreadIds: string[] }> => {
    if (options.threadIds.length > 0) {
        return collectThreadsById(options);
    }

    if (!options.workspaceQuery) {
        throw new CliUsageError('Provide a workspace (--workspace) or one or more --thread ids to export.');
    }

    const groups = await listCursorWorkspaceGroups(options.userDir);
    const group = resolveSingleGroup(groups, options.workspaceQuery);
    const threads = await listCursorThreadsForGroup(group, options.userDir);
    return { missingThreadIds: [], threads: threads.filter((thread) => thread.bubbleCount > 0) };
};

// Export by id reads the global head record directly so we avoid scanning every workspace bucket.
const collectThreadsById = async (
    options: CursorCliOptions,
): Promise<{ threads: CursorThreadSummary[]; missingThreadIds: string[] }> => {
    const globalDbPath = getCursorGlobalDbPath(options.userDir);
    const threads: CursorThreadSummary[] = [];
    const missingThreadIds: string[] = [];

    for (const threadId of options.threadIds) {
        const head = readCursorThreadHead(globalDbPath, threadId);
        if (!head) {
            missingThreadIds.push(threadId);
            continue;
        }

        threads.push({
            bubbleBytes: 0,
            bubbleCount: head.orderedBubbleIds.length,
            bucketId: null,
            composerId: head.composerId,
            createdAtMs: head.createdAtMs,
            lastUpdatedAtMs: head.lastUpdatedAtMs,
            mode: head.mode,
            name: head.name ?? '(untitled)',
            transcriptDirs: [],
            workspaceKey: '',
            workspaceLabel: '',
        });
    }

    return { missingThreadIds, threads };
};

export const runCursorExport = async (options: CursorCliOptions): Promise<CursorExportRunResult> => {
    const globalDbPath = getCursorGlobalDbPath(options.userDir);
    const outputDir = options.outputDir ?? DEFAULT_CURSOR_OUTPUT_DIR;
    const { threads, missingThreadIds } = await collectThreadsToExport(options);
    const files: CursorExportedFile[] = [];

    for (const thread of threads) {
        const exported = await exportSingleThread(thread, globalDbPath, outputDir, options);
        if (exported) {
            files.push(exported);
        } else {
            missingThreadIds.push(thread.composerId);
        }
    }

    return {
        exportedCount: files.length,
        files,
        missingThreadIds,
        outputDir,
    };
};

const exportSingleThread = async (
    thread: CursorThreadSummary,
    globalDbPath: string,
    outputDir: string,
    options: CursorCliOptions,
): Promise<CursorExportedFile | null> => {
    const transcript = await readCursorThreadTranscriptWithAgentFiles(globalDbPath, thread.composerId, options.userDir);
    if (!transcript) {
        return null;
    }

    const content = renderCursorTranscript(transcript, options);
    if (!content) {
        return null;
    }

    const outputPath = path.join(outputDir, `${thread.composerId}.${options.outputFormat}`);
    await writeExportFile(outputPath, content);

    return { composerId: thread.composerId, outputPath };
};

const parseExportFormat = (value: string): ExportFormat => {
    if (value === 'md' || value === 'txt') {
        return value;
    }

    throw new CliUsageError(`Unsupported output format: ${value}`);
};

const requireValue = (value: string | undefined, flag: string): string => {
    if (!value || (value.startsWith('-') && value !== '-')) {
        throw new CliUsageError(`Missing value for ${flag}`);
    }

    return value;
};

export const parseCursorCliArgs = (argv: string[]): CursorCliOptions => {
    const state: CursorCliOptions = {
        includeCommentary: false,
        includeMetadata: true,
        includeTools: false,
        outputDir: null,
        outputFormat: 'md',
        threadIds: [],
        userDir: resolveCursorUserDir(),
        workspaceQuery: null,
    };

    for (let index = 0; index < argv.length; index += 1) {
        index = applyCursorCliArg(argv, index, state);
    }

    return state;
};

const applyCursorCliArg = (argv: string[], index: number, state: CursorCliOptions): number => {
    const arg = argv[index] as string;
    const flagIndex = applyCursorFlag(arg, state);
    if (flagIndex) {
        return index;
    }

    return applyCursorValueArg(argv, index, arg, state);
};

const applyCursorFlag = (arg: string, state: CursorCliOptions): boolean => {
    if (arg === '--tools') {
        state.includeTools = true;
        return true;
    }

    if (arg === '--commentary' || arg === '--reasoning') {
        state.includeCommentary = true;
        return true;
    }

    if (arg === '--no-metadata') {
        state.includeMetadata = false;
        return true;
    }

    return false;
};

const applyCursorValueArg = (argv: string[], index: number, arg: string, state: CursorCliOptions): number => {
    if (arg === '--workspace' || arg === '-w') {
        state.workspaceQuery = expandHome(requireValue(argv[index + 1], arg));
        return index + 1;
    }

    if (arg === '--thread' || arg === '-t') {
        state.threadIds.push(requireValue(argv[index + 1], arg));
        return index + 1;
    }

    if (arg === '--output' || arg === '-o') {
        state.outputDir = expandHome(requireValue(argv[index + 1], arg));
        return index + 1;
    }

    if (arg === '--user-dir') {
        state.userDir = expandHome(requireValue(argv[index + 1], arg));
        return index + 1;
    }

    if (arg.startsWith('--output-format=')) {
        state.outputFormat = parseExportFormat(arg.slice('--output-format='.length));
        return index;
    }

    if (arg === '--output-format') {
        state.outputFormat = parseExportFormat(requireValue(argv[index + 1], '--output-format'));
        return index + 1;
    }

    if (!arg.startsWith('-') && !state.workspaceQuery && state.threadIds.length === 0) {
        state.workspaceQuery = expandHome(arg);
        return index;
    }

    throw new CliUsageError(`Unknown argument: ${arg}`);
};

export const getCursorHelpText = (): string => {
    return [
        'Export, recover, and prune local Cursor Agent/Composer threads.',
        '',
        'Usage:',
        '  spiracha cursor list [query]',
        '  spiracha cursor export --workspace NAME [options]',
        '  spiracha cursor export --thread COMPOSER_ID [--thread ...] [options]',
        '  spiracha cursor recover <workspace> [--apply]',
        '  spiracha cursor prune --workspace NAME [--thread ID ...] [--apply]',
        '',
        'Export options:',
        '  --workspace, -w   Workspace folder name, path, or .code-workspace file',
        '  --thread, -t      Composer/thread id (repeatable)',
        '  --output, -o      Output directory (default: ./exports/cursor)',
        '  --output-format   md or txt (default: md)',
        '  --tools           Include tool calls and their results',
        '  --commentary      Include assistant reasoning blocks',
        '  --no-metadata     Omit the metadata header block',
        '  --user-dir        Override the Cursor User data directory',
        '',
        'Recover/prune:',
        '  --apply           Perform writes (default is a dry run). Quit Cursor first.',
        '',
        'Examples:',
        '  spiracha cursor list',
        '  spiracha cursor export --workspace gun-twizzle --tools --commentary',
        '  spiracha cursor recover gun-twizzle --apply',
    ].join('\n');
};
