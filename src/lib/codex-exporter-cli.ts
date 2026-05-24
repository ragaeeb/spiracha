import path from 'node:path';
import { type CodexCliOptions, DEFAULT_DB_PATH, DEFAULT_INPUT_DIR, DEFAULT_OUTPUT_DIR } from './codex-exporter-types';
import { CliUsageError, type ExportFormat, expandHome, getPortablePathBasename } from './shared';

export const parseCodexCliArgs = (argv: string[]): CodexCliOptions => {
    let dbPath = DEFAULT_DB_PATH;
    let inputDir = DEFAULT_INPUT_DIR;
    let outputDir: string | null = null;
    let cwdFilter: string | null = null;
    let projectFilter: string | null = null;
    let threadIds: string[] = [];
    let outputProvided = false;
    let optimized = false;
    let includeCommentary = true;
    let includeTools = false;
    let outputFormat: ExportFormat = 'md';
    let flat = false;

    for (let index = 0; index < argv.length; index += 1) {
        const nextIndex = applyCodexCliArg(argv, index, {
            cwdFilter,
            dbPath,
            flat,
            includeCommentary,
            includeTools,
            inputDir,
            optimized,
            outputDir,
            outputFormat,
            outputProvided,
            projectFilter,
            threadIds,
        });

        ({
            cwdFilter,
            dbPath,
            flat,
            includeCommentary,
            includeTools,
            inputDir,
            optimized,
            outputDir,
            outputFormat,
            outputProvided,
            projectFilter,
            threadIds,
        } = nextIndex.state);
        index = nextIndex.index;
    }

    if (!outputProvided) {
        outputDir = resolveDefaultOutputDir(cwdFilter);
    }

    return {
        cwdFilter,
        dbPath,
        flat,
        includeCommentary,
        includeTools,
        inputDir,
        optimized,
        outputDir: outputDir ?? DEFAULT_OUTPUT_DIR,
        outputFormat,
        projectFilter,
        threadIds: [...new Set(threadIds)],
    };
};

type CodexCliState = {
    cwdFilter: string | null;
    dbPath: string;
    flat: boolean;
    includeCommentary: boolean;
    includeTools: boolean;
    inputDir: string;
    optimized: boolean;
    outputDir: string | null;
    outputFormat: ExportFormat;
    outputProvided: boolean;
    projectFilter: string | null;
    threadIds: string[];
};

type CodexCliNext = {
    index: number;
    state: CodexCliState;
};

const applyCodexCliArg = (argv: string[], index: number, state: CodexCliState): CodexCliNext => {
    const arg = argv[index];

    if (arg === '--db') {
        return {
            index: index + 1,
            state: {
                ...state,
                dbPath: expandHome(requireValue(argv[index + 1], '--db')),
            },
        };
    }

    if (arg === '--input' || arg === '-i') {
        return {
            index: index + 1,
            state: {
                ...state,
                inputDir: expandHome(requireValue(argv[index + 1], arg)),
            },
        };
    }

    if (arg === '--output' || arg === '-o') {
        return {
            index: index + 1,
            state: {
                ...state,
                outputDir: expandHome(requireValue(argv[index + 1], arg)),
                outputProvided: true,
            },
        };
    }

    if (arg === '--cwd') {
        return {
            index: index + 1,
            state: {
                ...state,
                cwdFilter: expandHome(requireValue(argv[index + 1], '--cwd')),
            },
        };
    }

    if (arg === '--project') {
        return {
            index: index + 1,
            state: {
                ...state,
                projectFilter: requireValue(argv[index + 1], '--project').trim(),
            },
        };
    }

    if (arg === '--optimized') {
        return {
            index,
            state: {
                ...state,
                optimized: true,
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

    if (arg === '--flat') {
        return {
            index,
            state: {
                ...state,
                flat: true,
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

    if (!arg.startsWith('-')) {
        const threadId = parseThreadSelectionArg(arg);
        if (!threadId) {
            throw new CliUsageError(
                `Unsupported positional argument: ${arg}\nExpected a Codex thread deeplink like codex://threads/<thread-id>`,
            );
        }

        return {
            index,
            state: {
                ...state,
                threadIds: [...state.threadIds, threadId],
            },
        };
    }

    throw new CliUsageError(`Unknown argument: ${arg}`);
};

export const getCodexHelpText = (): string => {
    return [
        'Export Codex session JSONL files to Markdown or TXT.',
        'Run with no arguments to enter interactive mode.',
        '',
        'Usage:',
        '  codex-chats',
        '  codex-chats --interactive',
        '  codex-chats [--db FILE] [--input DIR] [--output DIR] [--cwd DIR] [--project NAME] [--optimized] [--tools] [--flat] [--output-format md|txt] [codex://threads/<thread-id> ...]',
        '',
        'Options:',
        `  --db            Thread database path (default: ${DEFAULT_DB_PATH})`,
        `  --input,  -i    Source sessions directory (default: ${DEFAULT_INPUT_DIR})`,
        '  --output, -o    Export directory (default: ./<cwd-basename> when --cwd is set, otherwise ./exports)',
        '  --cwd           Only export chats whose cwd matches this exact path',
        '  --project       Only export chats whose cwd basename matches this project name',
        '  codex://threads/<id>',
        '                  Only export the exact threads referenced by these Codex deeplinks',
        '  --optimized     Suppress metadata and apply token-saving text cleanup',
        '  --tools         Include tool-call logs such as exec_command invocations',
        '  --flat          Write all exports into one folder instead of nested subfolders',
        '  --output-format Output file format: md or txt (default: md)',
        '  --interactive   Start the interactive prompt flow',
        '  --help,   -h    Show this help text',
    ].join('\n');
};

export const parseThreadSelectionArg = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const match = /^codex:\/\/threads\/([^/?#]+)$/u.exec(trimmed);
    return match?.[1] ?? null;
};

export const resolveDefaultOutputDir = (cwdFilter: string | null): string => {
    if (cwdFilter) {
        const basename = getPortablePathBasename(cwdFilter);
        if (basename) {
            return path.join(process.cwd(), basename);
        }
    }

    return DEFAULT_OUTPUT_DIR;
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
