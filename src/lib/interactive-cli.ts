import { Database } from 'bun:sqlite';
import { access, lstat } from 'node:fs/promises';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface, type Interface } from 'node:readline/promises';
import { checkbox } from '@inquirer/prompts';
import { type ClaudeCliOptions, runClaudeExport } from './claude-exporter';
import { resolveCodexThreadDbPath } from './codex-browser-db';
import { type CodexCliOptions, runCodexExport } from './codex-exporter';
import { DEFAULT_INPUT_DIR } from './codex-exporter-types';
import { type ExportFormat, expandHome, getPortablePathBasename } from './shared';

type InteractiveTargetKind =
    | 'codex_threads'
    | 'codex_project'
    | 'codex_projects_multi'
    | 'codex_cwd'
    | 'claude_path'
    | 'unknown';

type InteractiveInference = {
    kind: InteractiveTargetKind;
    value: string | null;
};

export type InteractiveExportResult =
    | {
          mode: 'codex';
          outputDir: string;
          exportedCount: number;
          missingThreadIds: string[];
          files: { sourcePath: string; outputPath: string; threadId: string | null }[];
      }
    | {
          mode: 'claude';
          outputPath: string;
          sourcePath: string;
      };

export const runInteractiveExport = async (): Promise<InteractiveExportResult> => {
    const rl = createPromptInterface();

    try {
        output.write('Interactive export mode\n\n');

        const initial = (
            await rl.question(
                'Paste a Codex deeplink/thread id, project name, cwd path, or Claude export path.\nLeave blank to pick from a menu.\n> ',
            )
        ).trim();

        const inferred = await inferInteractiveTarget(initial);
        const selection = inferred.kind === 'unknown' ? await promptForTargetKind(rl) : inferred.kind;

        switch (selection) {
            case 'codex_threads':
                return await runInteractiveCodexThreads(rl, inferred);
            case 'codex_project':
                return await runInteractiveCodexProject(rl, inferred);
            case 'codex_projects_multi':
                return await runInteractiveCodexProjectsMulti(rl);
            case 'codex_cwd':
                return await runInteractiveCodexCwd(rl, inferred);
            case 'claude_path':
                return await runInteractiveClaude(rl, inferred);
            default:
                throw new Error('Unsupported interactive selection');
        }
    } finally {
        rl.close();
    }
};

export const inferInteractiveTarget = async (value: string): Promise<InteractiveInference> => {
    const trimmed = value.trim();
    if (!trimmed) {
        return { kind: 'unknown', value: null };
    }

    const expanded = expandHome(trimmed);
    const pathStats = await lstat(expanded).catch(() => null);

    if (pathStats) {
        return await inferInteractiveTargetFromPath(expanded, pathStats);
    }

    return inferInteractiveTargetFromText(trimmed, expanded);
};

const inferInteractiveTargetFromPath = async (
    expanded: string,
    pathStats: Awaited<ReturnType<typeof lstat>>,
): Promise<InteractiveInference> => {
    if (pathStats.isDirectory()) {
        const metadataExists = await access(path.join(expanded, 'metadata.json'))
            .then(() => true)
            .catch(() => false);
        return {
            kind: metadataExists ? 'claude_path' : 'codex_cwd',
            value: expanded,
        };
    }

    if (pathStats.isFile()) {
        return {
            kind: expanded.endsWith('.jsonl') ? 'claude_path' : 'unknown',
            value: expanded,
        };
    }

    return { kind: 'unknown', value: expanded };
};

const inferInteractiveTargetFromText = (trimmed: string, expanded: string): InteractiveInference => {
    if (trimmed.startsWith('codex://threads/') || isRawThreadId(trimmed)) {
        return { kind: 'codex_threads', value: trimmed };
    }

    if (trimmed.includes(path.sep) || trimmed.startsWith('~')) {
        return { kind: 'codex_cwd', value: expanded };
    }

    return { kind: 'codex_project', value: trimmed };
};

const promptForTargetKind = async (rl: Interface): Promise<Exclude<InteractiveTargetKind, 'unknown'>> => {
    output.write(
        [
            '',
            'What do you want to export?',
            '1. Specific Codex thread(s)',
            '2. Codex project name',
            '3. Exact Codex cwd path',
            '4. Claude transcript file or export directory',
            '5. Select one or more Codex projects',
            '',
        ].join('\n'),
    );

    while (true) {
        const choice = (await rl.question('Choose 1-5: ')).trim();
        if (choice === '1') {
            return 'codex_threads';
        }
        if (choice === '2') {
            return 'codex_project';
        }
        if (choice === '3') {
            return 'codex_cwd';
        }
        if (choice === '4') {
            return 'claude_path';
        }
        if (choice === '5') {
            return 'codex_projects_multi';
        }

        output.write('Please enter 1, 2, 3, 4, or 5.\n');
    }
};

const runInteractiveCodexThreads = async (
    rl: Interface,
    inferred: InteractiveInference,
): Promise<InteractiveExportResult> => {
    const dbPath = resolveInteractiveDbPath();
    const raw =
        inferred.kind === 'codex_threads' && inferred.value
            ? inferred.value
            : (
                  await rl.question(
                      'Enter one or more Codex deeplinks or raw thread ids, separated by commas or spaces:\n> ',
                  )
              ).trim();

    const threadIds = normalizeInteractiveThreadSelections(raw);
    if (threadIds.length === 0) {
        throw new Error('At least one Codex thread id or deeplink is required.');
    }

    const options = await promptForCommonCodexOptions(rl, dbPath, {
        cwdFilter: null,
        projectFilter: null,
        threadIds,
    });
    const result = await runCodexExport(options);
    return { mode: 'codex', ...result };
};

const runInteractiveCodexProject = async (
    rl: Interface,
    inferred: InteractiveInference,
): Promise<InteractiveExportResult> => {
    const dbPath = resolveInteractiveDbPath();
    const project = (
        inferred.kind === 'codex_project' && inferred.value
            ? inferred.value
            : (await rl.question('Enter the Codex project name (cwd basename):\n> ')).trim()
    ).trim();

    if (!project) {
        throw new Error('A project name is required.');
    }

    const options = await promptForCommonCodexOptions(rl, dbPath, {
        cwdFilter: null,
        projectFilter: project,
        threadIds: [],
    });
    const result = await runCodexExport(options);
    return { mode: 'codex', ...result };
};

const runInteractiveCodexProjectsMulti = async (rl: Interface): Promise<InteractiveExportResult> => {
    const dbPath = resolveInteractiveDbPath();
    const projects = listCodexProjects(dbPath);
    if (projects.length === 0) {
        throw new Error(`No Codex projects found in ${dbPath}.`);
    }

    output.write('Use Space to toggle projects, and Enter to confirm.\n');
    // Inquirer manages the TTY directly; reopen readline afterwards for follow-up prompts.
    rl.close();
    const selectedProjects = await checkbox({
        choices: projects.map((project) => ({ name: project, value: project })),
        message: 'Select Codex project(s) to export:',
        pageSize: 15,
    });

    if (selectedProjects.length === 0) {
        throw new Error('At least one project must be selected.');
    }

    const threadIds = listThreadIdsForProjects(dbPath, selectedProjects);
    if (threadIds.length === 0) {
        throw new Error('No threads found for the selected projects.');
    }

    const followupRl = createPromptInterface();
    try {
        const options = await promptForCommonCodexOptions(followupRl, dbPath, {
            cwdFilter: null,
            projectFilter: null,
            threadIds,
        });
        const result = await runCodexExport(options);
        return { mode: 'codex', ...result };
    } finally {
        followupRl.close();
    }
};

const runInteractiveCodexCwd = async (
    rl: Interface,
    inferred: InteractiveInference,
): Promise<InteractiveExportResult> => {
    const dbPath = resolveInteractiveDbPath();
    const cwdInput =
        inferred.kind === 'codex_cwd' && inferred.value
            ? inferred.value
            : (await rl.question('Enter the exact Codex cwd path:\n> ')).trim();
    const cwdFilter = expandHome(cwdInput);

    if (!cwdFilter) {
        throw new Error('A cwd path is required.');
    }

    const options = await promptForCommonCodexOptions(rl, dbPath, {
        cwdFilter,
        projectFilter: null,
        threadIds: [],
    });
    const result = await runCodexExport(options);
    return { mode: 'codex', ...result };
};

const runInteractiveClaude = async (
    rl: Interface,
    inferred: InteractiveInference,
): Promise<InteractiveExportResult> => {
    const inputPath = expandHome(
        inferred.kind === 'claude_path' && inferred.value
            ? inferred.value
            : (await rl.question('Enter the Claude transcript .jsonl file or export directory:\n> ')).trim(),
    );

    if (!inputPath) {
        throw new Error('A Claude transcript path is required.');
    }

    const outputFormat = await promptForOutputFormat(rl);
    const includeTools = await promptYesNo(rl, 'Include tool output? [y/N]: ', false);
    const outputPath = await promptOptionalPath(rl, 'Optional output path or directory (leave blank for default):\n> ');

    const result = await runClaudeExport({
        includeTools,
        inputPath,
        outputFormat,
        outputPath,
    } satisfies ClaudeCliOptions);

    return { mode: 'claude', ...result };
};

const promptForCommonCodexOptions = async (
    rl: Interface,
    dbPath: string,
    target: Pick<CodexCliOptions, 'threadIds' | 'cwdFilter' | 'projectFilter'>,
): Promise<CodexCliOptions> => {
    const outputFormat = await promptForOutputFormat(rl);
    const optimized = await promptYesNo(rl, 'Use optimized output? [y/N]: ', false);
    const includeCommentary = await promptYesNo(rl, 'Include commentary messages? [y/N]: ', false);
    const includeTools = await promptYesNo(rl, 'Include tool logs? [y/N]: ', false);
    const flat = await promptYesNo(rl, 'Write to a flat output folder? [y/N]: ', false);
    const outputDir = await promptOptionalPath(rl, 'Optional output directory (leave blank for default):\n> ');

    return {
        cwdFilter: target.cwdFilter,
        dbPath,
        flat,
        includeCommentary,
        includeTools,
        inputDir: DEFAULT_INPUT_DIR,
        optimized,
        outputDir: outputDir ?? resolveInteractiveOutputDir(target.cwdFilter),
        outputFormat,
        projectFilter: target.projectFilter,
        threadIds: target.threadIds,
    };
};

const resolveInteractiveOutputDir = (cwdFilter: string | null) => {
    if (cwdFilter) {
        const basename = getPortablePathBasename(cwdFilter);
        if (basename) {
            return path.join(process.cwd(), basename);
        }
    }

    return path.join(process.cwd(), 'exports');
};

const promptForOutputFormat = async (rl: Interface): Promise<ExportFormat> => {
    output.write(['', 'Output format:', '1. Markdown (.md)', '2. Plain text (.txt)', ''].join('\n'));

    while (true) {
        const choice = (await rl.question('Choose 1-2 [1]: ')).trim();
        if (!choice || choice === '1') {
            return 'md';
        }
        if (choice === '2') {
            return 'txt';
        }

        output.write('Please enter 1 or 2.\n');
    }
};

const promptYesNo = async (rl: Interface, prompt: string, defaultValue: boolean): Promise<boolean> => {
    while (true) {
        const answer = (await rl.question(prompt)).trim().toLowerCase();
        if (!answer) {
            return defaultValue;
        }
        if (answer === 'y' || answer === 'yes') {
            return true;
        }
        if (answer === 'n' || answer === 'no') {
            return false;
        }

        output.write('Please answer y or n.\n');
    }
};

const promptOptionalPath = async (rl: Interface, prompt: string): Promise<string | null> => {
    const answer = (await rl.question(prompt)).trim();
    return answer ? expandHome(answer) : null;
};

const normalizeInteractiveThreadSelections = (value: string): string[] => {
    const rawTokens = value
        .split(/[,\s]+/)
        .map((token) => token.trim())
        .filter(Boolean);

    const threadIds = rawTokens.map((token) => {
        if (token.startsWith('codex://threads/')) {
            return token.replace(/^codex:\/\/threads\//u, '');
        }
        if (isRawThreadId(token)) {
            return token;
        }

        throw new Error(`Unsupported thread selection: ${token}`);
    });

    return [...new Set(threadIds)];
};

const listCodexProjects = (dbPath: string): string[] => {
    const db = new Database(dbPath, { readonly: true });
    try {
        const rows = db.query("SELECT DISTINCT cwd FROM threads WHERE cwd IS NOT NULL AND cwd != ''").all() as Array<{
            cwd: string;
        }>;
        return [...new Set(rows.map((row) => getPortablePathBasename(row.cwd)).filter(Boolean))].sort();
    } finally {
        db.close();
    }
};

const resolveInteractiveDbPath = (): string => {
    return resolveCodexThreadDbPath();
};

const listThreadIdsForProjects = (dbPath: string, projectNames: string[]): string[] => {
    if (projectNames.length === 0) {
        return [];
    }

    const db = new Database(dbPath, { readonly: true });
    try {
        const projectNameSet = new Set(projectNames);
        const rows = db
            .query("SELECT id, cwd FROM threads WHERE cwd IS NOT NULL AND cwd != '' ORDER BY updated_at DESC")
            .all() as Array<{ id: string; cwd: string }>;
        return rows.filter((row) => projectNameSet.has(getPortablePathBasename(row.cwd))).map((row) => row.id);
    } finally {
        db.close();
    }
};

const createPromptInterface = (): Interface => {
    return createInterface({ input, output });
};

const isRawThreadId = (value: string): boolean => {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
};
