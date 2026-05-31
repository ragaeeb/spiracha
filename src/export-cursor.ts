#!/usr/bin/env bun

import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { findCursorWorkspaceGroups, listCursorThreadsForGroup, listCursorWorkspaceGroups } from './lib/cursor-db';
import { getCursorHelpText, parseCursorCliArgs, runCursorExport } from './lib/cursor-exporter';
import { type CursorThreadSummary, type CursorWorkspaceGroup, resolveCursorUserDir } from './lib/cursor-exporter-types';
import { isCursorRunning, pruneCursorThreads, recoverCursorWorkspaceGroup } from './lib/cursor-recovery';
import { CliUsageError } from './lib/shared';

type CursorSubcommand = 'list' | 'export' | 'recover' | 'prune';

const PRUNE_CONFIRM_PHRASE = 'delete permanently';

const resolveSubcommand = (argv: string[]): { subcommand: CursorSubcommand; rest: string[] } => {
    const [first, ...rest] = argv;
    if (first === 'list' || first === 'export' || first === 'recover' || first === 'prune') {
        return { rest, subcommand: first };
    }

    // Default to export so `spiracha cursor <workspace>` behaves like the other exporters.
    return { rest: argv, subcommand: 'export' };
};

const promptLine = async (question: string): Promise<string> => {
    const rl = createInterface({ input, output });
    try {
        return (await rl.question(question)).trim();
    } finally {
        rl.close();
    }
};

const ensureCursorClosed = async (): Promise<void> => {
    if (await isCursorRunning()) {
        throw new Error('Cursor is still running. Quit Cursor completely, then run again with --apply.');
    }
};

const runCursorList = async (argv: string[]): Promise<void> => {
    const query = argv.find((arg) => !arg.startsWith('-')) ?? null;
    const groups = await listCursorWorkspaceGroups();
    const filtered = query ? findCursorWorkspaceGroups(groups, query) : groups;

    if (filtered.length === 0) {
        console.log('No Cursor workspaces found.');
        return;
    }

    console.log(`Found ${filtered.length} Cursor workspace(s):\n`);
    for (const group of filtered) {
        const recover = group.needsRecovery ? '  [needs recovery]' : '';
        console.log(`${group.label}${recover}`);
        console.log(`  key: ${group.key}`);
        console.log(`  threads: ~${group.threadCount}  buckets: ${group.buckets.length}`);
    }
    console.log('\nExport with:  spiracha cursor export --workspace <name> --tools --commentary');
};

const runCursorExportCommand = async (argv: string[]): Promise<void> => {
    const options = parseCursorCliArgs(argv);
    const result = await runCursorExport(options);

    if (result.exportedCount === 0) {
        console.log('No threads were exported.');
    } else {
        console.log(`Exported ${result.exportedCount} thread(s) to ${result.outputDir}`);
        for (const file of result.files) {
            console.log(`  ${file.composerId} -> ${file.outputPath}`);
        }
    }

    if (result.missingThreadIds.length > 0) {
        console.log(`Skipped ${result.missingThreadIds.length} thread(s) with no exportable content.`);
    }
};

const resolveSingleGroupOrThrow = (groups: CursorWorkspaceGroup[], query: string): CursorWorkspaceGroup => {
    const matched = findCursorWorkspaceGroups(groups, query);
    if (matched.length === 0) {
        throw new Error(`No Cursor workspace matched query: ${query}`);
    }

    if (matched.length > 1) {
        const keys = matched.map((group) => `  - ${group.key}`).join('\n');
        throw new Error(`Query "${query}" matched multiple workspaces. Refine it:\n${keys}`);
    }

    return matched[0]!;
};

const runCursorRecover = async (argv: string[]): Promise<void> => {
    const apply = argv.includes('--apply');
    const query = argv.find((arg) => !arg.startsWith('-'));
    if (!query) {
        throw new CliUsageError('recover requires a workspace name or path.');
    }

    if (apply) {
        await ensureCursorClosed();
    }

    const group = resolveSingleGroupOrThrow(await listCursorWorkspaceGroups(), query);
    const result = await recoverCursorWorkspaceGroup(group, apply);

    console.log(`[${group.label}] merges ${result.mergedThreadCount} thread(s) into bucket ${result.activeBucketId}`);
    for (const thread of result.threads) {
        console.log(`  - ${thread.name} [${thread.composerId.slice(0, 8)}] bubbles=${thread.bubbleCount}`);
    }

    if (!apply) {
        console.log('\nDry run only. Re-run with --apply after quitting Cursor.');
        return;
    }

    console.log(
        `\nRecovery complete: relinked ${result.relinkedHeaderCount}, added ${result.addedHeaderCount} header(s).`,
    );
    console.log('Reopen the project in Cursor and check Chat History.');
};

const selectPruneThreads = async (argv: string[]): Promise<CursorThreadSummary[]> => {
    const threadIds = collectFlagValues(argv, ['--thread', '-t']);
    const query = collectFlagValues(argv, ['--workspace', '-w'])[0] ?? argv.find((arg) => !arg.startsWith('-'));
    const groups = await listCursorWorkspaceGroups();

    if (threadIds.length > 0) {
        const all = (await Promise.all(groups.map((group) => listCursorThreadsForGroup(group)))).flat();
        return all.filter(
            (thread) =>
                threadIds.includes(thread.composerId) || threadIds.some((id) => thread.composerId.startsWith(id)),
        );
    }

    if (!query) {
        throw new CliUsageError('prune requires a --workspace or one or more --thread ids.');
    }

    const group = resolveSingleGroupOrThrow(groups, query);
    return listCursorThreadsForGroup(group);
};

const collectFlagValues = (argv: string[], flags: string[]): string[] => {
    const values: string[] = [];
    for (let index = 0; index < argv.length; index += 1) {
        if (flags.includes(argv[index] as string)) {
            const value = argv[index + 1];
            if (value && !value.startsWith('-')) {
                values.push(value);
            }
        }
    }

    return values;
};

const runCursorPrune = async (argv: string[]): Promise<void> => {
    const apply = argv.includes('--apply');
    const threads = await selectPruneThreads(argv);

    if (threads.length === 0) {
        console.log('No matching threads to prune.');
        return;
    }

    console.log(`Prune target: ${threads.length} thread(s)`);
    for (const thread of threads) {
        console.log(`  - ${thread.name} [${thread.composerId.slice(0, 8)}] bubbles=${thread.bubbleCount}`);
    }

    if (!apply) {
        const preview = await pruneCursorThreads(threads, false);
        console.log(`\nDry run: would delete ${preview.bubblesDeleted} bubble(s) across ${threads.length} thread(s).`);
        console.log('Re-run with --apply after quitting Cursor.');
        return;
    }

    await ensureCursorClosed();
    console.log(`\nThis permanently deletes ${threads.length} thread(s) and their on-disk transcripts.`);
    const typed = await promptLine(`Type "${PRUNE_CONFIRM_PHRASE}" to confirm: `);
    if (typed !== PRUNE_CONFIRM_PHRASE) {
        console.log('Confirmation failed. Nothing was deleted.');
        return;
    }

    const result = await pruneCursorThreads(threads, true);
    console.log(
        `Deleted ${result.bubblesDeleted} bubble(s), ${result.headersRemoved} header(s), ` +
            `${result.transcriptDirsRemoved} transcript dir(s) across ${result.composerIds.length} thread(s).`,
    );
};

export const runExportCursorCli = async (argv = process.argv.slice(2)): Promise<void> => {
    if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
        console.log(getCursorHelpText());
        return;
    }

    const { subcommand, rest } = resolveSubcommand(argv);

    try {
        await dispatchCursorSubcommand(subcommand, rest);
    } catch (error) {
        if (error instanceof CliUsageError) {
            console.error(error.message);
            console.error('');
            console.error(getCursorHelpText());
            process.exit(1);
        }

        if (error instanceof Error) {
            console.error(error.message);
            process.exit(1);
        }

        throw error;
    }
};

const dispatchCursorSubcommand = async (subcommand: CursorSubcommand, rest: string[]): Promise<void> => {
    if (subcommand === 'list') {
        await runCursorList(rest);
        return;
    }

    if (subcommand === 'recover') {
        await runCursorRecover(rest);
        return;
    }

    if (subcommand === 'prune') {
        await runCursorPrune(rest);
        return;
    }

    await runCursorExportCommand(rest);
};

// Surfaces the resolved Cursor data dir for diagnostics in error messages.
export const getResolvedCursorUserDir = (): string => resolveCursorUserDir();

if (import.meta.main) {
    await runExportCursorCli();
}
