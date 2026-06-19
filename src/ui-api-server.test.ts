import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCodexBrowserFixture } from './lib/codex-test-helpers';

const SERVER_TIMEOUT_MS = 30_000;
const tempRoots: string[] = [];

const makeTempRoot = async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spiracha-ui-api-server-'));
    tempRoots.push(tempRoot);
    return tempRoot;
};

const getAvailablePort = () => {
    const server = Bun.serve({
        fetch: () => new Response('ok'),
        port: 0,
    });
    const port = server.port;
    server.stop(true);
    if (port === undefined) {
        throw new Error('Unable to allocate a temporary UI server port.');
    }
    return port;
};

const waitForJson = async (url: string) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                return response.json() as Promise<unknown>;
            }
            lastError = new Error(`${response.status} ${response.statusText}`);
        } catch (error) {
            lastError = error;
        }
        await Bun.sleep(100);
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const startUiDevServer = (port: number, env: NodeJS.ProcessEnv) => {
    const uiDir = path.join(process.cwd(), 'apps', 'ui');
    return Bun.spawn(['bun', '--bun', 'vite', 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
        cwd: uiDir,
        env,
        stderr: 'pipe',
        stdout: 'pipe',
    });
};

describe('UI API server routes', () => {
    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    it(
        'should serve the stable conversation API from the real TanStack server',
        async () => {
            const fixture = await createCodexBrowserFixture(await makeTempRoot());
            const port = getAvailablePort();
            const proc = startUiDevServer(port, {
                ...process.env,
                SPIRACHA_CODEX_DB: fixture.dbPath,
            });
            const stdoutPromise = new Response(proc.stdout).text();
            const stderrPromise = new Response(proc.stderr).text();

            try {
                const sources = await waitForJson(`http://127.0.0.1:${port}/api/v1/sources`);
                expect(sources).toEqual({
                    data: expect.arrayContaining([{ label: 'Codex', source: 'codex' }]),
                });

                const query = new URLSearchParams({
                    cwd: fixture.threads[0]!.cwd,
                    include_messages: 'true',
                    message_selector: 'last_final_answer',
                    source: 'codex',
                });
                const conversations = (await waitForJson(`http://127.0.0.1:${port}/api/v1/conversations?${query}`)) as {
                    data: Array<{ id: string; messages: Array<{ phase: string; role: string }>; source: string }>;
                    meta: { hasNext: boolean; next_cursor: string | null };
                };
                expect(conversations.meta).toEqual({ hasNext: false, next_cursor: null });
                expect(conversations.data[0]).toMatchObject({
                    id: fixture.threads[0]!.threadId,
                    messages: [
                        {
                            phase: 'final_answer',
                            role: 'assistant',
                        },
                    ],
                    source: 'codex',
                });
            } finally {
                proc.kill();
                await proc.exited.catch(() => undefined);
                await Promise.all([stdoutPromise, stderrPromise]).catch(() => undefined);
            }
        },
        SERVER_TIMEOUT_MS,
    );
});
