import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConversationClient } from './client';
import { createCodexBrowserFixture } from './lib/codex-test-helpers';
import type { EvidenceLens } from './lib/conversation-data/types';

const SERVER_TIMEOUT_MS = 60_000;
const tempRoots: string[] = [];
const evidenceLens: EvidenceLens = {
    anchors: [{ kind: 'text', literals: ['Implemented'] }],
    budget: {
        commentaryCharactersPerEpisode: 300,
        failedOutputCharacters: 600,
        successfulOutputCharacters: 300,
        totalCharacters: 3000,
    },
    context: {
        commentaryAfter: 1,
        commentaryBefore: 1,
        followRetries: true,
        followWorkarounds: true,
        includeReasoningSummaries: true,
        maxOrderGap: 10,
    },
    name: 'UI API smoke lens',
};

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
    const deadlineMs = Date.now() + 45_000;
    while (Date.now() < deadlineMs) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
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

const fetchWithTimeout = (url: string, init?: RequestInit) => {
    return fetch(url, { ...init, signal: AbortSignal.timeout(5_000) });
};

const startUiDevServer = (port: number, env: NodeJS.ProcessEnv) => {
    const uiDirectory = path.join(process.cwd(), 'apps', 'ui');
    return Bun.spawn(['bun', '--bun', 'vite', 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
        cwd: uiDirectory,
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

                const savedSettings = encodeURIComponent(
                    JSON.stringify({
                        convertToProjectRoot: true,
                        exportDefaults: {
                            includeCommentary: true,
                            includeMetadata: true,
                            includeTools: true,
                            outputFormat: 'md',
                            zipArchive: false,
                        },
                        redactUsername: true,
                    }),
                );
                const settingsResponse = await fetchWithTimeout(`http://127.0.0.1:${port}/settings`, {
                    headers: {
                        Cookie: `spiracha-settings=${savedSettings}`,
                    },
                });
                expect(settingsResponse.status).toBe(200);
                const settingsHtml = await settingsResponse.text();
                const redactControl = settingsHtml.match(/<button(?=[^>]*id="redact-username")[^>]*>/)?.[0];
                const projectRootControl = settingsHtml.match(/<button(?=[^>]*id="convert-project-root")[^>]*>/)?.[0];
                expect(redactControl).toContain('data-state="checked"');
                expect(projectRootControl).toContain('data-state="checked"');

                const query = new URLSearchParams({
                    cwd: fixture.threads[0]!.cwd,
                    include_messages: 'true',
                    message_selector: 'last_final_answer',
                    source: 'codex',
                });
                const conversations = (await waitForJson(`http://127.0.0.1:${port}/api/v1/conversations?${query}`)) as {
                    data: Array<{ id: string; messages: Array<{ phase: string; role: string }>; source: string }>;
                    meta: { has_next: boolean; next_cursor: string | null };
                };
                expect(conversations.meta).toEqual({ has_next: false, next_cursor: null });
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

                const evidenceResponse = await fetchWithTimeout(
                    `http://127.0.0.1:${port}/api/v1/conversations/codex/${fixture.threads[0]!.threadId}/evidence`,
                    {
                        body: JSON.stringify({
                            generated_at: '2026-07-19T12:00:00.000Z',
                            lens: evidenceLens,
                        }),
                        headers: { 'Content-Type': 'application/json' },
                        method: 'POST',
                    },
                );
                expect(evidenceResponse.status).toBe(200);
                const evidencePayload = (await evidenceResponse.json()) as { data: { markdown: string } };
                const httpMarkdown = evidencePayload.data.markdown;
                expect(httpMarkdown).toContain('# Focused evidence: Implement the Spiracha UI');
                const localEvidence = await createConversationClient({
                    mode: 'local',
                }).exportConversationEvidenceMarkdown({
                    generatedAt: '2026-07-19T12:00:00.000Z',
                    id: fixture.threads[0]!.threadId,
                    lens: evidenceLens,
                    locations: { codexDbPath: fixture.dbPath },
                    source: 'codex',
                });
                expect(localEvidence?.markdown).toBe(httpMarkdown);

                const batchExportResponse = await fetchWithTimeout(
                    `http://127.0.0.1:${port}/api/v1/conversations/export`,
                    {
                        body: JSON.stringify({
                            ids: [fixture.threads[0]!.threadId, fixture.threads[1]!.threadId],
                            source: 'codex',
                        }),
                        headers: { 'Content-Type': 'application/json' },
                        method: 'POST',
                    },
                );
                expect(batchExportResponse.status).toBe(200);
                expect(batchExportResponse.headers.get('Content-Type')).toBe('application/zip');
                expect(batchExportResponse.headers.get('Content-Disposition')).toContain('codex-conversations-2.zip');
                const batchExportBytes = new Uint8Array(await batchExportResponse.arrayBuffer());
                expect(Array.from(batchExportBytes.slice(0, 2))).toEqual([0x50, 0x4b]);

                const batchDeleteResponse = await fetchWithTimeout(
                    `http://127.0.0.1:${port}/api/v1/conversations/delete`,
                    {
                        body: JSON.stringify({
                            ids: [fixture.threads[1]!.threadId],
                            source: 'codex',
                        }),
                        headers: { 'Content-Type': 'application/json' },
                        method: 'POST',
                    },
                );
                expect(batchDeleteResponse.status).toBe(200);
                await expect(batchDeleteResponse.json()).resolves.toMatchObject({
                    data: {
                        deletedFiles: [fixture.threads[1]!.sessionFile],
                        deletedIds: [fixture.threads[1]!.threadId],
                        missingIds: [],
                    },
                });
                expect(await Bun.file(fixture.threads[1]!.sessionFile).exists()).toBe(false);

                const deleteResponse = await fetchWithTimeout(
                    `http://127.0.0.1:${port}/api/v1/conversations/codex/${fixture.threads[0]!.threadId}`,
                    { method: 'DELETE' },
                );
                expect(deleteResponse.status).toBe(200);
                await expect(deleteResponse.json()).resolves.toEqual({
                    data: {
                        deletedFiles: [fixture.threads[0]!.sessionFile],
                        deletedIds: [fixture.threads[0]!.threadId],
                    },
                });
                expect(await Bun.file(fixture.threads[0]!.sessionFile).exists()).toBe(false);
            } finally {
                proc.kill();
                await proc.exited.catch(() => undefined);
                await Promise.all([stdoutPromise, stderrPromise]).catch(() => undefined);
            }
        },
        SERVER_TIMEOUT_MS,
    );
});
