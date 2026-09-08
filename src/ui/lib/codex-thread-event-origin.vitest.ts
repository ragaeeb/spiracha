import { describe, expect, it } from 'vitest';
import { isAllowedCodexThreadEventOrigin } from './codex-thread-event-origin';

describe('isAllowedCodexThreadEventOrigin', () => {
    it('should allow same-origin and non-browser live streams', () => {
        const requestUrl = 'http://localhost:3000/api/v1/codex/threads/events';

        expect(isAllowedCodexThreadEventOrigin(requestUrl, null)).toBe(true);
        expect(isAllowedCodexThreadEventOrigin(requestUrl, 'http://localhost:3000')).toBe(true);
        expect(isAllowedCodexThreadEventOrigin(requestUrl, 'null')).toBe(false);
    });

    it('should reject unrelated, malformed, and wrong-port origins', () => {
        const requestUrl = 'http://localhost:3000/api/v1/codex/threads/events';

        expect(isAllowedCodexThreadEventOrigin(requestUrl, 'http://example.com:3000')).toBe(false);
        expect(isAllowedCodexThreadEventOrigin(requestUrl, 'http://127.0.0.1:4000')).toBe(false);
        expect(isAllowedCodexThreadEventOrigin(requestUrl, 'http://127.0.0.1:3000')).toBe(true);
        expect(isAllowedCodexThreadEventOrigin(requestUrl, 'not a URL')).toBe(false);
        expect(
            isAllowedCodexThreadEventOrigin(
                'http://spiracha.local:3000/api/v1/codex/threads/events',
                'http://spiracha.local:3000',
            ),
        ).toBe(false);
    });
});
