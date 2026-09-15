import { describe, expect, it } from 'vitest';
import { createCodexThreadLiveStreamUrl } from './codex-thread-live-url';

describe('live stream URL construction', () => {
    it.each([
        ['http://localhost:3000/threads/a', '127.0.0.1', 'http:', '3000'],
        ['https://127.0.0.1:8443/threads/a', 'localhost', 'https:', '8443'],
        ['http://[::1]:3000/threads/a', 'localhost', 'http:', '3000'],
    ])('should switch the loopback alias while retaining the scheme and port for %s', (base, host, scheme, port) => {
        const url = new URL(createCodexThreadLiveStreamUrl(['one'], base));
        expect(url.hostname).toBe(host);
        expect(url.protocol).toBe(scheme);
        expect(url.port).toBe(port);
        expect(url.pathname).toBe('/api/v1/codex/threads/events');
    });

    it('should round-trip reserved characters and Unicode without inheriting page parameters', () => {
        const ids = ['one & two', '会/話?x=#value', 'a+b%20'];
        const url = new URL(createCodexThreadLiveStreamUrl(ids, 'http://localhost:3000/threads/a?secret=old#tab'));
        expect(url.searchParams.getAll('threadId')).toEqual(ids);
        expect([...url.searchParams.keys()]).toEqual(ids.map(() => 'threadId'));
        expect(url.hash).toBe('');
    });

    it('should leave input IDs unchanged and retain an empty selection for route-side validation', () => {
        const ids = Object.freeze(['one', 'two']);
        expect(
            new URL(createCodexThreadLiveStreamUrl(ids, 'http://localhost')).searchParams.getAll('threadId'),
        ).toEqual(['one', 'two']);
        expect(new URL(createCodexThreadLiveStreamUrl([], 'http://localhost')).search).toBe('');
    });
});
