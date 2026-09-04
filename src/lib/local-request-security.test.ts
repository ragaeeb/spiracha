import { describe, expect, it } from 'bun:test';
import { isAllowedLocalRequestOrigin } from './local-request-security';

describe('local request security', () => {
    it('should reject a non-loopback request URL even when its origin matches', () => {
        expect(
            isAllowedLocalRequestOrigin('http://spiracha.local:3000/api/v1/sources', 'http://spiracha.local:3000'),
        ).toBe(false);
    });

    it('should allow loopback requests with no browser origin', () => {
        expect(isAllowedLocalRequestOrigin('http://localhost:3000/api/v1/sources', null)).toBe(true);
        expect(isAllowedLocalRequestOrigin('http://127.0.0.1:3000/api/v1/sources', null)).toBe(true);
    });
});
