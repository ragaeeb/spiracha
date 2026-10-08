// nginx's "client closed request" status; nobody reads the response, it only keeps logs accurate.
const CLIENT_CLOSED_REQUEST_STATUS = 499;

// h3 logs every thrown error that is not an HTTPError (matched by name) as an unhandled 500.
class ClientClosedRequestError extends Error {
    override name = 'HTTPError';
    readonly status = CLIENT_CLOSED_REQUEST_STATUS;
    readonly statusText = 'Client Closed Request';

    constructor() {
        super('Client closed request');
    }

    toJSON() {
        return { message: this.message, status: this.status };
    }
}

/**
 * TanStack Start rethrows `request.signal.reason` when the browser abandons a request mid-SSR
 * (for example a refresh during a slow loader). Forward a request whose signal aborts with a
 * handled HTTP error so the work is still cancelled without logging a spurious 500.
 */
export const withClientDisconnectHandling =
    <Args extends unknown[]>(fetch: (request: Request, ...args: Args) => Promise<Response> | Response) =>
    (request: Request, ...args: Args): Promise<Response> | Response => {
        const controller = new AbortController();
        const abort = () => controller.abort(new ClientClosedRequestError());
        if (request.signal.aborted) {
            abort();
        } else {
            request.signal.addEventListener('abort', abort, { once: true });
        }
        // Copy fields explicitly: adapter requests (srvx NodeRequest) are not native Request instances.
        const init: RequestInit & { duplex?: 'half' } = {
            headers: request.headers,
            method: request.method,
            signal: controller.signal,
        };
        if (request.body) {
            init.body = request.body;
            init.duplex = 'half';
        }
        return fetch(new Request(request.url, init), ...args);
    };
