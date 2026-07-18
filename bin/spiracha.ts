#!/usr/bin/env bun
import path from 'node:path';
import process from 'node:process';

export type SpirachaDevServerCommand = {
    args: string[];
    cwd: string;
};

export const resolveSpirachaPackageRoot = (binDir = import.meta.dir): string => path.resolve(binDir, '..');

export const buildSpirachaDevServerCommand = (packageRoot = resolveSpirachaPackageRoot()): SpirachaDevServerCommand => ({
    args: ['--bun', 'vite', 'dev', '--host', '127.0.0.1', '--port', process.env.PORT || '3000'],
    cwd: path.join(packageRoot, 'apps', 'ui'),
});

type SpirachaChildProcess = {
    exited: Promise<number>;
    kill: (signal?: NodeJS.Signals | number) => void;
};

type SpirachaSignalEmitter = {
    off: (event: NodeJS.Signals, listener: () => void) => unknown;
    on: (event: NodeJS.Signals, listener: () => void) => unknown;
};

export const waitForSpirachaDevServer = async (
    child: SpirachaChildProcess,
    signalEmitter: SpirachaSignalEmitter = process,
): Promise<number> => {
    const forwardSigint = () => child.kill('SIGINT');
    const forwardSigterm = () => child.kill('SIGTERM');
    signalEmitter.on('SIGINT', forwardSigint);
    signalEmitter.on('SIGTERM', forwardSigterm);

    try {
        return await child.exited;
    } finally {
        signalEmitter.off('SIGINT', forwardSigint);
        signalEmitter.off('SIGTERM', forwardSigterm);
    }
};

export const runSpirachaDevServer = async (): Promise<number> => {
    const command = buildSpirachaDevServerCommand();
    const proc = Bun.spawn([process.execPath, ...command.args], {
        cwd: command.cwd,
        env: process.env,
        stderr: 'inherit',
        stdin: 'inherit',
        stdout: 'inherit',
    });

    return waitForSpirachaDevServer(proc);
};

if (import.meta.main) {
    process.exitCode = await runSpirachaDevServer();
}
