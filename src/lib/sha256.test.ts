import { expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { sha256Hex } from './sha256';

it('should preserve existing SHA-256 identities for UTF-8 input', async () => {
    for (const text of ['', 'abc', 'Gemini\0report', 'العربية 😀', '\ud800', 'x'.repeat(1024)]) {
        expect(await sha256Hex(text)).toBe(createHash('sha256').update(text).digest('hex'));
    }
});
