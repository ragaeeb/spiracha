import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { createConversationClient } from './client';
import { createCodexBrowserFixture } from './lib/codex-test-helpers';
import { handleConversationApiRequest } from './lib/conversation-api';
import { getConversation, getConversationRaw, listConversations } from './lib/conversation-data';

const withFixture = async (
    check: (input: {
        fixture: Awaited<ReturnType<typeof createCodexBrowserFixture>>;
        http: ReturnType<typeof createConversationClient>;
        local: ReturnType<typeof createConversationClient>;
    }) => Promise<void>,
) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-http-storage-'));
    let server: ReturnType<typeof Bun.serve> | undefined;
    try {
        const fixture = await createCodexBrowserFixture(root);
        const locations = { codexDbPath: fixture.dbPath };
        server = Bun.serve({
            fetch: (request) =>
                handleConversationApiRequest(request, {
                    getConversation: (options) => getConversation({ ...options, locations }),
                    getConversationRaw: (options) => getConversationRaw({ ...options, locations }),
                    listConversations: (options) => listConversations({ ...options, locations }),
                }),
            hostname: '127.0.0.1',
            port: 0,
        });
        await check({
            fixture,
            http: createConversationClient({ baseUrl: `http://127.0.0.1:${server.port}`, mode: 'http' }),
            local: createConversationClient({ locations, mode: 'local' }),
        });
    } finally {
        server?.stop(true);
        await rm(root, { force: true, recursive: true });
    }
};

describe('HTTP SDK through the real API and Codex storage', () => {
    it('should match the local SDK across keyset pages and message selectors', async () => {
        await withFixture(async ({ fixture, http, local }) => {
            const options = {
                cwd: fixture.threads[0].cwd,
                includeMessages: true,
                limit: 1,
                messageSelector: 'all' as const,
                sources: ['codex' as const],
            };
            const first = await http.listConversations(options);
            expect(first).toEqual(await local.listConversations(options));
            expect(first.meta.hasNext).toBe(true);
            expect(first.data).toHaveLength(1);
            const nextOptions = { ...options, cursor: first.meta.nextCursor };
            const second = await http.listConversations(nextOptions);
            expect(second).toEqual(await local.listConversations(nextOptions));
            expect(second.data[0].id).not.toBe(first.data[0].id);
            for (const messageSelector of ['all', 'last_assistant', 'last_final_answer'] as const) {
                const target = { id: fixture.threads[0].threadId, messageSelector, source: 'codex' as const };
                expect(await http.getConversation(target)).toEqual(await local.getConversation(target));
                expect(await http.exportConversationMarkdown(target)).toBe(
                    await local.exportConversationMarkdown(target),
                );
            }
        });
    });

    it('should preserve native rollout bytes through raw HTTP export', async () => {
        await withFixture(async ({ fixture, http }) => {
            const thread = fixture.threads[0];
            const result = await http.exportConversationRaw({ id: thread.threadId, source: 'codex' });
            expect(result).not.toBeNull();
            expect(result!.mimeType).toBe('application/x-ndjson');
            expect(new Uint8Array(await result!.blob.arrayBuffer())).toEqual(
                new Uint8Array(await Bun.file(thread.sessionFile).arrayBuffer()),
            );
        });
    });

    it('should deliver every selected Markdown body in an HTTP ZIP and fail atomically for a missing ID', async () => {
        await withFixture(async ({ fixture, http, local }) => {
            const ids = fixture.threads.map(({ threadId }) => threadId);
            const archive = await http.exportConversationsZip({ ids, messageSelector: 'all', source: 'codex' });
            expect(archive).not.toBeNull();
            const unpacked = unzipSync(new Uint8Array(await archive!.blob.arrayBuffer()));
            const expected = await Promise.all(
                ids.map(async (id) => {
                    const markdown = await local.exportConversationMarkdown({
                        id,
                        messageSelector: 'all',
                        source: 'codex',
                    });
                    expect(markdown).not.toBeNull();
                    return markdown as string;
                }),
            );
            expect(
                Object.values(unpacked)
                    .map((bytes) => strFromU8(bytes))
                    .toSorted(),
            ).toEqual(expected.toSorted());
            expect(await http.exportConversationsZip({ ids: [...ids, 'missing-thread'], source: 'codex' })).toBeNull();
        });
    });
});
