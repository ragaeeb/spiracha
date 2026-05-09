#!/usr/bin/env bun

import { runExportChatsCli } from './export-chats';
import { runExportClaudeCli } from './export-claude';

type SpirachaCommandKind = 'codex' | 'claude' | 'help';

type SpirachaInvocation = {
    kind: SpirachaCommandKind;
    argv: string[];
};

export const resolveSpirachaInvocation = (argv: string[]): SpirachaInvocation => {
    const [firstArg, ...rest] = argv;

    if (firstArg === 'claude') {
        return { argv: rest, kind: 'claude' };
    }

    if (firstArg === 'codex') {
        return { argv: rest, kind: 'codex' };
    }

    if (firstArg === '--help' || firstArg === '-h' || firstArg === 'help') {
        return { argv: [], kind: 'help' };
    }

    return { argv, kind: 'codex' };
};

export const getSpirachaHelpText = (): string => {
    return [
        'spiracha - export Codex chats and Claude transcripts',
        '',
        'Usage:',
        '  spiracha',
        '  spiracha codex [Codex options]',
        '  spiracha claude [Claude options]',
        '',
        'Commands:',
        '  codex   Export Codex chats (default when no subcommand is provided)',
        '  claude  Export a Claude transcript file or export directory',
        '',
        'Aliases:',
        '  codex-chats',
        '  codex-chats-claude',
        '',
        'For command-specific help:',
        '  spiracha codex --help',
        '  spiracha claude --help',
    ].join('\n');
};

export const runSpirachaCli = async (argv = process.argv.slice(2)): Promise<void> => {
    const invocation = resolveSpirachaInvocation(argv);

    if (invocation.kind === 'help') {
        console.log(getSpirachaHelpText());
        return;
    }

    if (invocation.kind === 'claude') {
        await runExportClaudeCli(invocation.argv);
        return;
    }

    await runExportChatsCli(invocation.argv);
};

if (import.meta.main) {
    await runSpirachaCli();
}
