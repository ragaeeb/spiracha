#!/usr/bin/env bun

import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { getCodexHelpText, parseCodexCliArgs, runCodexExport } from './lib/codex-exporter';
import { runInteractiveExport } from './lib/interactive-cli';
import { openPathNatively } from './lib/native-open';
import { CliUsageError } from './lib/shared';

export const runExportChatsCli = async (argv = process.argv.slice(2)): Promise<void> => {
    if (argv.includes('--help') || argv.includes('-h')) {
        console.log(getCodexHelpText());
        return;
    }

    try {
        if (shouldRunInteractive(argv)) {
            await runInteractiveCliFlow();
            return;
        }

        await runCodexCliFlow(argv);
    } catch (error) {
        if (error instanceof CliUsageError) {
            console.error(error.message);
            console.error('');
            console.error(getCodexHelpText());
            process.exit(1);
        }

        if (error instanceof Error) {
            console.error(error.message);
            process.exit(1);
        }

        throw error;
    }
};

const shouldRunInteractive = (argv: string[]): boolean => {
    return argv.length === 0 || argv.includes('--interactive');
};

const runInteractiveCliFlow = async (): Promise<void> => {
    const result = await runInteractiveExport();
    const targetFolder = await printInteractiveExportResult(result);
    await maybeOpenExportFolder(targetFolder);
};

const runCodexCliFlow = async (argv: string[]): Promise<void> => {
    const options = parseCodexCliArgs(argv);
    const result = await runCodexExport(options);
    printCodexExportResult(result);
};

const printInteractiveExportResult = async (
    result: Awaited<ReturnType<typeof runInteractiveExport>>,
): Promise<string> => {
    if (result.mode === 'claude') {
        console.log(`Exported ${result.sourcePath} -> ${result.outputPath}`);
        return resolveExportFolder(result.outputPath);
    }

    printCodexExportFiles(result.files);
    printMissingThreadWarnings(result.missingThreadIds);
    console.log(`Done. Exported ${result.exportedCount} chat(s) to ${result.outputDir}`);
    return result.outputDir;
};

const printCodexExportResult = (result: Awaited<ReturnType<typeof runCodexExport>>): void => {
    printCodexExportFiles(result.files);
    printMissingThreadWarnings(result.missingThreadIds);
    console.log(`Done. Exported ${result.exportedCount} chat(s) to ${result.outputDir}`);
};

const printCodexExportFiles = (files: Awaited<ReturnType<typeof runCodexExport>>['files']): void => {
    for (const file of files) {
        console.log(`Exported ${file.sourcePath} -> ${file.outputPath}`);
    }
};

const printMissingThreadWarnings = (missingThreadIds: string[]): void => {
    if (missingThreadIds.length > 0) {
        console.warn(
            `Warning: ${missingThreadIds.length} requested thread(s) were not found: ${missingThreadIds.join(', ')}`,
        );
    }
};

const maybeOpenExportFolder = async (targetFolder: string): Promise<void> => {
    const rl = createInterface({ input, output });
    try {
        while (true) {
            const answer = (await rl.question('Open the exported folder now? [y/N]: ')).trim().toLowerCase();
            if (!answer || answer === 'n' || answer === 'no') {
                return;
            }
            if (answer === 'y' || answer === 'yes') {
                await openPathNatively(targetFolder);
                return;
            }
            console.log('Please answer y or n.');
        }
    } finally {
        rl.close();
    }
};

const resolveExportFolder = async (targetPath: string): Promise<string> => {
    const stats = await lstat(targetPath).catch(() => null);
    if (stats?.isDirectory()) {
        return targetPath;
    }
    return path.dirname(targetPath);
};

if (import.meta.main) {
    await runExportChatsCli();
}
