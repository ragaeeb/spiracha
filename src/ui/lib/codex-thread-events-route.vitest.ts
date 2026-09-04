import { describe, expect, it } from 'vitest';
import { handleCodexThreadEventsRequest } from '../routes/api.v1.codex.threads.events';

describe('Codex thread events route', () => {
    it('should allow the intentional localhost to 127.0.0.1 loopback stream and return CORS headers', async () => {
        const response = await handleCodexThreadEventsRequest(
            new Request('http://127.0.0.1:3000/api/v1/codex/threads/events', {
                headers: { Origin: 'http://localhost:3000' },
            }),
        );

        expect(response.status).toBe(400);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
        expect(response.headers.get('Vary')).toContain('Origin');
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });
});
