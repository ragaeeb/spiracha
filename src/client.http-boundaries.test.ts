import { describe, expect, it } from 'bun:test';
import { type ConversationClient, createConversationClient, SpirachaClientError } from './client';

const withHttpServer = async (
    respond: (request: Request) => Response,
    assertion: (client: ConversationClient) => Promise<void>,
) => {
    const server = Bun.serve({ fetch: respond, hostname: '127.0.0.1', port: 0 });
    try {
        await assertion(createConversationClient({ baseUrl: server.url.href, mode: 'http' }));
    } finally {
        server.stop(true);
    }
};
const target = { id: 'conversation-1', source: 'codex' as const };

describe('HTTP client response boundaries', () => {
    for (const body of [null, [], 'text', 42, true]) {
        it(`should normalize a JSON ${JSON.stringify(body)} envelope into a typed client error`, async () => {
            await withHttpServer(
                () => Response.json(body),
                async (client) => {
                    await expect(client.listSources()).rejects.toMatchObject({
                        name: 'SpirachaClientError',
                        status: 200,
                    });
                    await expect(client.getConversation(target)).rejects.toBeInstanceOf(SpirachaClientError);
                },
            );
        });
    }

    it('should reject missing and null data rather than returning a falsely typed success', async () => {
        for (const body of [{}, { data: null }]) {
            await withHttpServer(
                () => Response.json(body),
                async (client) => {
                    await expect(client.listSources()).rejects.toBeInstanceOf(SpirachaClientError);
                    await expect(client.getConversation(target)).rejects.toBeInstanceOf(SpirachaClientError);
                },
            );
        }
    });

    it('should distinguish a missing conversation from a missing API route across read and download operations', async () => {
        const operations = [
            (client: ConversationClient) => client.getConversation(target),
            (client: ConversationClient) => client.exportConversationMarkdown(target),
            (client: ConversationClient) => client.exportConversationRaw(target),
            (client: ConversationClient) => client.exportConversationsZip({ ids: [target.id], source: target.source }),
        ];
        for (const operation of operations) {
            await withHttpServer(
                () => Response.json({ error: { code: 'conversation_not_found' } }, { status: 404 }),
                async (client) => expect(await operation(client)).toBeNull(),
            );
            await withHttpServer(
                () => Response.json({ error: { code: 'not_found', message: 'Route not found' } }, { status: 404 }),
                async (client) => {
                    await expect(operation(client)).rejects.toMatchObject({ name: 'SpirachaClientError', status: 404 });
                },
            );
        }
    });

    it('should reject an ordinary 405 instead of treating it as unsupported source deletion', async () => {
        await withHttpServer(
            () => Response.json({ error: { code: 'method_not_allowed' } }, { status: 405 }),
            async (client) => {
                await expect(client.deleteConversation(target)).rejects.toMatchObject({ status: 405 });
                await expect(client.deleteConversations({ ids: [target.id], source: target.source })).rejects.toMatchObject({
                    status: 405,
                });
            },
        );
    });

    it('should reject HTML or JSON returned successfully by a misrouted ZIP endpoint', async () => {
        for (const contentType of ['text/html', 'application/json', 'text/plain']) {
            await withHttpServer(
                () => new Response('not a ZIP', { headers: { 'Content-Type': contentType } }),
                async (client) => {
                    await expect(
                        client.exportConversationsZip({ ids: [target.id], source: target.source }),
                    ).rejects.toBeInstanceOf(SpirachaClientError);
                },
            );
        }
    });

    it('should prefer the UTF-8 filename over the legacy quoted filename and preserve raw bytes', async () => {
        const bytes = new Uint8Array([0, 13, 10, 255, 195, 169]);
        await withHttpServer(
            () =>
                new Response(bytes, {
                    headers: {
                        'Content-Disposition': 'attachment; filename="fallback.json"; filename*=UTF-8\'\'%E4%BC%9A.json',
                        'Content-Type': 'application/x-ndjson; charset=utf-8',
                    },
                }),
            async (client) => {
                const download = await client.exportConversationRaw(target);
                expect(download?.fileName).toBe('会.json');
                expect(download?.mimeType).toBe('application/x-ndjson');
                expect(new Uint8Array(await download!.blob.arrayBuffer())).toEqual(bytes);
            },
        );
    });

    it('should fall back safely when the encoded download filename is malformed', async () => {
        await withHttpServer(
            () =>
                new Response('{}', {
                    headers: {
                        'Content-Disposition': "attachment; filename*=UTF-8''%ZZ",
                        'Content-Type': 'application/json',
                    },
                }),
            async (client) => expect((await client.exportConversationRaw(target))?.fileName).toBe('conversation.json'),
        );
    });

    it('should clear base URL query and fragment while retaining its deployment path', async () => {
        let received: URL | undefined;
        const server = Bun.serve({
            fetch: (request) => {
                received = new URL(request.url);
                return Response.json({ data: [] });
            },
            hostname: '127.0.0.1',
            port: 0,
        });
        try {
            const client = createConversationClient({ baseUrl: `${server.url}prefix/?stale=1#hash`, mode: 'http' });
            await client.listSources();
            expect(received?.pathname).toBe('/prefix/api/v1/sources');
            expect(received?.search).toBe('');
            expect(received?.hash).toBe('');
        } finally {
            server.stop(true);
        }
    });
});
