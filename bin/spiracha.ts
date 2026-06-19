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

export const runSpirachaDevServer = async (): Promise<number> => {
    const command = buildSpirachaDevServerCommand();
    const proc = Bun.spawn([process.execPath, ...command.args], {
        cwd: command.cwd,
        env: process.env,
        stderr: 'inherit',
        stdin: 'inherit',
        stdout: 'inherit',
    });

    return proc.exited;
};

if (import.meta.main) {
    process.exitCode = await runSpirachaDevServer();
}
