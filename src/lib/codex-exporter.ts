import path from 'node:path';
import {
    buildExportTargets,
    findJsonlFiles,
    loadThreadData,
    shouldScanFallbackSessionFiles,
} from './codex-exporter-db';
import { convertSessionFile } from './codex-exporter-transcript';
import type { CodexCliOptions, CodexExportedFile, CodexExportRunResult } from './codex-exporter-types';
import { writeExportFile } from './shared';

export {
    getCodexHelpText,
    parseCodexCliArgs,
    parseThreadSelectionArg,
    resolveDefaultOutputDir,
} from './codex-exporter-cli';
export {
    buildExportTargets,
    buildSpawnEdgeQuery,
    buildThreadQuery,
    findJsonlFiles,
    loadThreadData,
    matchesFilters,
    shouldScanFallbackSessionFiles,
    toCodexRelativePath,
    toOutputRelativePath,
} from './codex-exporter-db';
export {
    compactMessageText,
    convertSessionFile,
    formatToolOutputSummary,
    parseExecCommandArguments,
} from './codex-exporter-transcript';
export {
    type CodexCliOptions,
    type CodexExportedFile,
    type CodexExportRunResult,
    DEFAULT_CODEX_DIR,
    DEFAULT_DB_PATH,
    DEFAULT_INPUT_DIR,
    DEFAULT_OUTPUT_DIR,
    type ExportTarget,
    type MessageRecord,
    type SessionMeta,
    type SpawnEdgeRow,
    type ThreadData,
    type ThreadRelations,
    type ThreadRow,
    type ToolRecord,
} from './codex-exporter-types';

export const runCodexExport = async (options: CodexCliOptions): Promise<CodexExportRunResult> => {
    const threadData = loadThreadData(options.dbPath, options);
    const sessionFiles = shouldScanFallbackSessionFiles(options) ? await findJsonlFiles(options.inputDir) : [];

    if (threadData.threadsById.size === 0 && sessionFiles.length === 0) {
        throw new Error(`No threads found in ${options.dbPath} and no .jsonl files found in ${options.inputDir}`);
    }

    const exportTargets = buildExportTargets(threadData, sessionFiles, options);
    const files = await writeCodexExportTargets(exportTargets, options);
    const missingThreadIds = options.threadIds.filter((threadId) => !threadData.threadsById.has(threadId));

    if (shouldThrowNoMatchError(options, files.length)) {
        throw new Error(buildNoMatchErrorMessage(options));
    }

    return {
        exportedCount: files.length,
        files,
        missingThreadIds,
        outputDir: options.outputDir,
    };
};

const writeCodexExportTargets = async (
    exportTargets: ReturnType<typeof buildExportTargets>,
    options: CodexCliOptions,
): Promise<CodexExportedFile[]> => {
    const files: CodexExportedFile[] = [];

    for (const target of exportTargets) {
        const content = await convertSessionFile(target, options);
        if (!content) {
            continue;
        }

        const outputPath = path.join(options.outputDir, target.outputRelativePath);
        await writeExportFile(outputPath, content);
        files.push({
            outputPath,
            sourcePath: target.sessionFile,
            threadId: target.thread?.id ?? null,
        });
    }

    return files;
};

const shouldThrowNoMatchError = (options: CodexCliOptions, exportedCount: number): boolean => {
    return (
        exportedCount === 0 &&
        (options.threadIds.length > 0 || options.cwdFilter !== null || options.projectFilter !== null)
    );
};

const buildNoMatchErrorMessage = (options: CodexCliOptions): string => {
    const filters = [
        options.cwdFilter ? `cwd=${options.cwdFilter}` : null,
        options.projectFilter ? `project=${options.projectFilter}` : null,
        options.threadIds.length > 0 ? `threadIds=${options.threadIds.join(',')}` : null,
    ].filter(Boolean);

    return `No chats matched the requested filters (${filters.join('; ')})`;
};
