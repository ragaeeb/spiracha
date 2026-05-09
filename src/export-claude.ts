#!/usr/bin/env bun

import { getClaudeHelpText, parseClaudeCliArgs, runClaudeExport } from './lib/claude-exporter';
import { CliUsageError } from './lib/shared';

export const runExportClaudeCli = async (argv = process.argv.slice(2)): Promise<void> => {
    if (argv.includes('--help') || argv.includes('-h')) {
        console.log(getClaudeHelpText());
        return;
    }

    try {
        const options = parseClaudeCliArgs(argv);
        const result = await runClaudeExport(options);

        console.log(`Exported ${result.sourcePath} -> ${result.outputPath}`);
    } catch (error) {
        if (error instanceof CliUsageError) {
            console.error(error.message);
            console.error('');
            console.error(getClaudeHelpText());
            process.exit(1);
        }

        if (error instanceof Error) {
            console.error(error.message);
            process.exit(1);
        }

        throw error;
    }
};

if (import.meta.main) {
    await runExportClaudeCli();
}
