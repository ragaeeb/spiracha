#!/usr/bin/env bun

type SpirachaCommandKind = 'codex' | 'claude' | 'cursor' | 'help' | 'ui' | 'version';

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

    if (firstArg === 'cursor') {
        return { argv: rest, kind: 'cursor' };
    }

    if (firstArg === 'ui') {
        return { argv: rest, kind: 'ui' };
    }

    if (firstArg === '--help' || firstArg === '-h' || firstArg === 'help') {
        return { argv: [], kind: 'help' };
    }

    if (firstArg === '--version' || firstArg === '-v' || firstArg === 'version') {
        return { argv: [], kind: 'version' };
    }

    return { argv, kind: 'codex' };
};

export const readSpirachaPackageVersion = async (): Promise<string> => {
    const manifest = (await Bun.file(new URL('../package.json', import.meta.url)).json()) as { version?: unknown };
    if (typeof manifest.version !== 'string' || !manifest.version) {
        throw new Error('Unable to read Spiracha version from package.json.');
    }

    return manifest.version;
};

export const getSpirachaHelpText = (): string => {
    return [
        'spiracha - export local assistant transcripts and browse local history',
        '',
        'Usage:',
        '  spiracha',
        '  spiracha codex [Codex options]',
        '  spiracha claude [Claude options]',
        '  spiracha cursor [Cursor options]',
        '  spiracha ui [UI options]',
        '',
        'Commands:',
        '  codex   Export Codex chats (default when no subcommand is provided)',
        '  claude  Export a Claude transcript file or export directory',
        '  cursor  Export, recover, and prune local Cursor Agent/Composer threads',
        '  ui      Launch the local browser UI for Codex, Cursor, and Antigravity history',
        '',
        'Aliases:',
        '  codex-chats',
        '  codex-chats-claude',
        '',
        'For command-specific help:',
        '  spiracha codex --help',
        '  spiracha claude --help',
        '  spiracha cursor --help',
        '  spiracha ui --help',
        '  spiracha --version',
    ].join('\n');
};

export const runSpirachaCli = async (argv = process.argv.slice(2)): Promise<void> => {
    const invocation = resolveSpirachaInvocation(argv);

    if (invocation.kind === 'help') {
        console.log(getSpirachaHelpText());
        return;
    }

    if (invocation.kind === 'version') {
        console.log(await readSpirachaPackageVersion());
        return;
    }

    if (invocation.kind === 'claude') {
        const { runExportClaudeCli } = await import('./export-claude');
        await runExportClaudeCli(invocation.argv);
        return;
    }

    if (invocation.kind === 'cursor') {
        const { runExportCursorCli } = await import('./export-cursor');
        await runExportCursorCli(invocation.argv);
        return;
    }

    if (invocation.kind === 'ui') {
        const { runUiCli } = await import('./ui-cli');
        await runUiCli(invocation.argv);
        return;
    }

    const { runExportChatsCli } = await import('./export-chats');
    await runExportChatsCli(invocation.argv);
};

if (import.meta.main) {
    await runSpirachaCli();
}
