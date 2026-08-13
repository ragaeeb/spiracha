#!/usr/bin/env bun

import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createCodexBrowserFixture } from './lib/codex-test-helpers';

type PackageManifest = {
    name: string;
    version: string;
};

type PackagedUiProbe = {
    bodyText: string;
    contentType: string | null;
    ok: boolean;
};

const HOST = '127.0.0.1';
const STARTUP_TIMEOUT_MS = 30_000;

export const buildPackagedUiProcessEnv = (
    environment: NodeJS.ProcessEnv,
    port: number,
    codexDbPath: string,
): NodeJS.ProcessEnv => ({
    ...environment,
    PORT: String(port),
    SPIRACHA_CODEX_DB: codexDbPath,
});

export const getPackedTarballPath = (directory: string, packageName: string, version: string) =>
    path.join(directory, `${packageName}-${version}.tgz`);

export const isPackagedUiHealthyResponse = (probe: PackagedUiProbe) =>
    probe.ok &&
    probe.contentType?.toLowerCase().includes('text/html') === true &&
    /<html[\s>]/iu.test(probe.bodyText) &&
    probe.bodyText.includes('Spiracha') &&
    !probe.bodyText.includes('Welcome to Bun!');

const getAvailablePort = async () => {
    const server = createServer();
    server.unref();

    return new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, HOST, () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Failed to find a free port for the package smoke test.')));
                return;
            }

            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve(address.port);
            });
        });
    });
};

const runCommand = async (argv: string[], cwd: string) => {
    const proc = Bun.spawn(argv, {
        cwd,
        stderr: 'pipe',
        stdout: 'pipe',
    });
    const stdoutPromise = new Response(proc.stdout).text();
    const stderrPromise = new Response(proc.stderr).text();
    const timeoutId = setTimeout(() => proc.kill(), STARTUP_TIMEOUT_MS);

    try {
        const [exitCode, stdoutText, stderrText] = await Promise.all([proc.exited, stdoutPromise, stderrPromise]);

        if (exitCode !== 0) {
            throw new Error(
                [
                    `Command failed with exit code ${exitCode}: ${argv.join(' ')}`,
                    stdoutText.trim() ? `stdout:\n${stdoutText}` : '',
                    stderrText.trim() ? `stderr:\n${stderrText}` : '',
                ]
                    .filter(Boolean)
                    .join('\n\n'),
            );
        }
    } finally {
        clearTimeout(timeoutId);
    }
};

const waitForServer = async (url: string): Promise<PackagedUiProbe> => {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    let lastError = 'no response';

    while (Date.now() < deadline) {
        const remainingMs = Math.max(1, deadline - Date.now());
        const startupSignal = AbortSignal.timeout(remainingMs);
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), remainingMs);
        const signal = AbortSignal.any([startupSignal, abortController.signal]);

        try {
            const response = await fetch(url, { signal });
            if (response.ok) {
                clearTimeout(timeoutId);
                return {
                    bodyText: await response.text(),
                    contentType: response.headers.get('content-type'),
                    ok: response.ok,
                };
            }

            lastError = `HTTP ${response.status}`;
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        } finally {
            clearTimeout(timeoutId);
            abortController.abort();
        }

        await Bun.sleep(250);
    }

    throw new Error(`Timed out waiting for packaged Spiracha at ${url} (${lastError}).`);
};

const readPackageManifest = async (cwd: string): Promise<PackageManifest> =>
    Bun.file(path.join(cwd, 'package.json')).json();

export const runPackagedUiSmokeTest = async (cwd = process.cwd()) => {
    const manifest = await readPackageManifest(cwd);
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'spiracha-package-smoke-'));
    const port = await getAvailablePort();
    const packageTgz = getPackedTarballPath(tempDirectory, manifest.name, manifest.version);

    try {
        const codexFixtureRoot = await mkdtemp(path.join(tempDirectory, 'codex-fixture-'));
        const codexFixture = await createCodexBrowserFixture(codexFixtureRoot);
        await runCommand([process.execPath, 'pm', 'pack', '--destination', tempDirectory], cwd);
        await Bun.write(path.join(tempDirectory, 'package.json'), '{"name":"spiracha-smoke","private":true}\n');

        const bunx = Bun.which('bunx') ?? 'bunx';
        const proc = Bun.spawn([bunx, '--package', packageTgz, 'spiracha'], {
            cwd: tempDirectory,
            env: buildPackagedUiProcessEnv(process.env, port, codexFixture.dbPath),
            stderr: 'pipe',
            stdout: 'pipe',
        });
        const stdoutPromise = new Response(proc.stdout).text();
        const stderrPromise = new Response(proc.stderr).text();
        const url = `http://${HOST}:${port}/`;

        try {
            const probe = await waitForServer(url);
            if (!isPackagedUiHealthyResponse(probe)) {
                throw new Error(`Packaged Spiracha returned an unhealthy response at ${url}.`);
            }
        } catch (error) {
            proc.kill('SIGTERM');
            const [stdoutText, stderrText] = await Promise.all([stdoutPromise, stderrPromise]);
            throw new Error(
                [
                    error instanceof Error ? error.message : String(error),
                    stdoutText.trim() ? `stdout:\n${stdoutText}` : '',
                    stderrText.trim() ? `stderr:\n${stderrText}` : '',
                ]
                    .filter(Boolean)
                    .join('\n\n'),
            );
        } finally {
            proc.kill('SIGTERM');
            await Promise.all([
                proc.exited.catch(() => undefined),
                stdoutPromise.catch(() => ''),
                stderrPromise.catch(() => ''),
            ]);
        }
    } finally {
        await rm(tempDirectory, { force: true, recursive: true });
    }
};

if (import.meta.main) {
    await runPackagedUiSmokeTest();
}
