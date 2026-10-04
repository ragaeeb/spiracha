import { describe, expect, it } from 'vitest';
import { withClientDisconnectHandling } from './client-disconnect';

describe('withClientDisconnectHandling', () => {
    it('should abort the forwarded request with a handled 499 error when the client disconnects', async () => {
        const controller = new AbortController();
        let forwarded: Request | null = null;
        const handler = withClientDisconnectHandling(async (request: Request) => {
            forwarded = request;
            controller.abort();
            return new Response('late');
        });

        await handler(new Request('http://localhost/', { signal: controller.signal }));
        const reason = (forwarded as Request | null)?.signal.reason as {
            name: string;
            status: number;
            toJSON: () => unknown;
        };

        expect((forwarded as Request | null)?.signal.aborted).toBe(true);
        expect(reason).toBeInstanceOf(Error);
        expect(reason.name).toBe('HTTPError');
        expect(reason.status).toBe(499);
        expect(reason.toJSON()).toEqual({ message: 'Client closed request', status: 499 });
    });

    it('should forward method, headers, and body unchanged', async () => {
        const handler = withClientDisconnectHandling(
            async (request: Request) =>
                new Response(`${request.method} ${request.headers.get('x-test')} ${await request.text()}`),
        );

        const response = await handler(
            new Request('http://localhost/_serverFn', {
                body: 'payload',
                headers: { 'x-test': 'yes' },
                method: 'POST',
            }),
        );

        expect(await response.text()).toBe('POST yes payload');
    });

    it('should forward an already-disconnected request as aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        let aborted = false;
        const handler = withClientDisconnectHandling(async (request: Request) => {
            aborted = request.signal.aborted;
            return new Response(null);
        });

        await handler(new Request('http://localhost/', { signal: controller.signal }));

        expect(aborted).toBe(true);
    });

    it('should forward method and body from non-native request objects such as the srvx Node adapter', async () => {
        const native = new Request('http://localhost/api', { body: '{"a":1}', method: 'POST' });
        const requestLike = {
            body: native.body,
            headers: native.headers,
            method: native.method,
            signal: native.signal,
            url: native.url,
        } as unknown as Request;
        const handler = withClientDisconnectHandling(
            async (request: Request) => new Response(`${request.method} ${await request.text()}`),
        );

        const response = await handler(requestLike);

        expect(await response.text()).toBe('POST {"a":1}');
    });
});
