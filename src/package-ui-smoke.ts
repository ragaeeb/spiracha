#!/usr/bin/env bun

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type PackageManifest = {
    name: string;
    version: string;
};

type SpawnedCommandResult = {
    exitCode: number;
    stderrText: string;
    stdoutText: string;
};

const SMOKE_HOST = '127.0.0.1';
const SMOKE_PORT = 43139;
const STARTUP_TIMEOUT_MS = 20_000;

export const getPackedTarballPath = (cwd: string, packageName: string, version: string) => {
    return path.join(cwd, `${packageName}-${version}.tgz`);
};

const readPackageManifest = async (cwd: string): Promise<PackageManifest> => {
    return Bun.file(path.join(cwd, 'package.json')).json();
};

const runCommand = async (
    argv: string[],
    cwd: string,
    label: string,
    timeoutMs = STARTUP_TIMEOUT_MS,
): Promise<SpawnedCommandResult> => {
    const proc = Bun.spawn(argv, {
        cwd,
        stderr: 'pipe',
        stdout: 'pipe',
    });
    const stdoutPromise = new Response(proc.stdout).text();
    const stderrPromise = new Response(proc.stderr).text();

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
        const exitCode = await Promise.race([
            proc.exited,
            new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => {
                    proc.kill();
                    reject(new Error(`${label} timed out after ${timeoutMs}ms`));
                }, timeoutMs);
            }),
        ]);

        const [stdoutText, stderrText] = await Promise.all([stdoutPromise, stderrPromise]);
        return {
            exitCode,
            stderrText,
            stdoutText,
        };
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        if (proc.exitCode === null) {
            proc.kill();
            await proc.exited.catch(() => undefined);
        }
    }
};

const assertSuccessfulCommand = async (argv: string[], cwd: string, label: string, timeoutMs = STARTUP_TIMEOUT_MS) => {
    const result = await runCommand(argv, cwd, label, timeoutMs);
    if (result.exitCode !== 0) {
        throw new Error(
            [
                `${label} failed with exit code ${result.exitCode}`,
                result.stdoutText.trim() ? `stdout:\n${result.stdoutText}` : '',
                result.stderrText.trim() ? `stderr:\n${result.stderrText}` : '',
            ]
                .filter(Boolean)
                .join('\n\n'),
        );
    }
};

const waitForServer = async (url: string, timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    let lastError: string | null = null;

    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                return;
            }
            lastError = `HTTP ${response.status}`;
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }

        await Bun.sleep(250);
    }

    throw new Error(`Timed out waiting for packaged UI at ${url}${lastError ? ` (${lastError})` : ''}`);
};

const startPackagedUi = async (packageTgz: string, cwd: string, port: number) => {
    const proc = Bun.spawn(['bunx', '--package', packageTgz, 'spiracha', 'ui', '--port', String(port), '--no-open'], {
        cwd,
        stderr: 'pipe',
        stdout: 'pipe',
    });

    const stdoutPromise = new Response(proc.stdout).text();
    const stderrPromise = new Response(proc.stderr).text();
    const url = `http://${SMOKE_HOST}:${port}/settings`;

    try {
        await waitForServer(url, STARTUP_TIMEOUT_MS);
        return {
            proc,
            stderrPromise,
            stdoutPromise,
            url,
        };
    } catch (error) {
        proc.kill();
        const [stdoutText, stderrText] = await Promise.all([
            stdoutPromise.catch(() => ''),
            stderrPromise.catch(() => ''),
            proc.exited.catch(() => undefined),
        ]);

        throw new Error(
            [
                error instanceof Error ? error.message : String(error),
                stdoutText.trim() ? `stdout:\n${stdoutText}` : '',
                stderrText.trim() ? `stderr:\n${stderrText}` : '',
            ]
                .filter(Boolean)
                .join('\n\n'),
        );
    }
};

export const runPackagedUiSmokeTest = async (cwd = process.cwd()) => {
    const manifest = await readPackageManifest(cwd);
    const packageTgz = getPackedTarballPath(cwd, manifest.name, manifest.version);
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'spiracha-packaged-ui-smoke-'));

    try {
        console.log('Building package artifacts...');
        await assertSuccessfulCommand(['bun', 'run', 'build'], cwd, 'bun run build', 120_000);

        console.log('Packing tarball...');
        await assertSuccessfulCommand(['bun', 'pm', 'pack'], cwd, 'bun pm pack', 120_000);
        await Bun.write(path.join(tempDir, 'package.json'), '{"name":"spiracha-smoke","private":true}\n');

        console.log('Checking packaged command help...');
        await assertSuccessfulCommand(
            ['bunx', '--package', packageTgz, 'spiracha', 'ui', '--help'],
            tempDir,
            'bunx --package <tgz> spiracha ui --help',
        );

        console.log('Launching packaged UI...');
        const runningUi = await startPackagedUi(packageTgz, tempDir, SMOKE_PORT);

        try {
            console.log(`Packaged UI responded at ${runningUi.url}`);
        } finally {
            runningUi.proc.kill();
            await Promise.all([
                runningUi.proc.exited.catch(() => undefined),
                runningUi.stdoutPromise.catch(() => ''),
                runningUi.stderrPromise.catch(() => ''),
            ]);
        }
    } finally {
        await rm(tempDir, { force: true, recursive: true });
    }
};

if (import.meta.main) {
    await runPackagedUiSmokeTest();
}
