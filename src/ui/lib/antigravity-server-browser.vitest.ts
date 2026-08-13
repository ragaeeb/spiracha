import { describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => {
    throw new Error('node:fs/promises must not load while hydrating Antigravity routes');
});

describe('antigravity-server browser boundary', () => {
    it('should not eagerly load filesystem-only export modules', async () => {
        await expect(import('./antigravity-server')).resolves.toBeDefined();
    });
});
