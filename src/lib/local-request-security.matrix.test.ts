import { describe, expect, it } from 'bun:test';
import { isAllowedLocalRequestOrigin, isLocalLoopbackHostname } from './local-request-security';

const requestUrl = 'http://127.0.0.1:3000/api/v1/conversations/delete';

describe('local request origin rejection matrix', () => {
    it.each([
        'null',
        '',
        'http://evil.example',
        'http://localhost.evil.example:3000',
        'http://127.0.0.1.evil.example:3000',
        'http://localhost:3001',
        'https://localhost:3000',
        'http://localhost:3000/',
        'http://localhost:3000/path',
        'http://localhost:3000?query=1',
        'http://localhost:3000#fragment',
        'http://user:password@localhost:3000',
        'http://localhost:3000 http://evil.example',
        'http://localhost:3000, http://evil.example',
        'not a URL',
        'file://localhost',
        'https://[::1]:3000',
    ])('should reject the untrusted or non-canonical Origin %s', (origin) => {
        expect(isAllowedLocalRequestOrigin(requestUrl, origin)).toBe(false);
    });

    it.each(['localhost', '127.0.0.1', '[::1]'])('should allow the canonical loopback alias %s', (hostname) => {
        expect(isAllowedLocalRequestOrigin(requestUrl, `http://${hostname}:3000`)).toBe(true);
        expect(isLocalLoopbackHostname(hostname)).toBe(true);
    });

    it.each(['example.com', '0.0.0.0', '127.0.0.2', '[::]', 'localhost.example.com'])(
        'should reject a non-allowlisted request host even without an Origin: %s',
        (hostname) => {
            expect(isAllowedLocalRequestOrigin(`http://${hostname}:3000/api/v1/sources`, null)).toBe(false);
            expect(isLocalLoopbackHostname(hostname)).toBe(false);
        },
    );

    it('should return false rather than throw for malformed request URLs', () => {
        for (const url of ['', '/api/v1/sources', 'http://[not-ipv6]:3000', '://']) {
            expect(isAllowedLocalRequestOrigin(url, null)).toBe(false);
        }
    });

    it('should compare default ports by their normalized origins', () => {
        expect(isAllowedLocalRequestOrigin('http://127.0.0.1/api/v1/sources', 'http://localhost')).toBe(true);
        expect(isAllowedLocalRequestOrigin('https://127.0.0.1/api/v1/sources', 'https://localhost')).toBe(true);
        expect(isAllowedLocalRequestOrigin('https://127.0.0.1/api/v1/sources', 'http://localhost')).toBe(false);
    });
});
