import { describe, expect, it } from 'vitest';
import { isCodexThreadId } from './thread-id';

describe('isCodexThreadId', () => {
    it('should accept UUID-shaped Codex thread ids', () => {
        expect(isCodexThreadId('019d709b-502d-7302-8e7e-0e6833556521')).toBe(true);
    });

    it('should reject non-thread route segments', () => {
        expect(isCodexThreadId('projects')).toBe(false);
        expect(isCodexThreadId('analytics')).toBe(false);
        expect(isCodexThreadId('not-a-thread-id')).toBe(false);
    });
});
