import { describe, expect, it } from 'bun:test';
import { createProductionUiFetch } from './production-ui-server';

describe('production server redirect responses', () => {
    it('should add security headers without mutating immutable application headers', async () => {
        const handler = createProductionUiFetch({
            appFetch: () => Response.redirect('http://localhost:3000/codex', 302),
            clientDirectory: '/nonexistent-spiracha-test-client',
        });
        const response = await handler(new Request('http://localhost:3000/'));
        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe('http://localhost:3000/codex');
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });
});
