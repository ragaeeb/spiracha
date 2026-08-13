import { describe, expect, it } from 'vitest';
import { formatSandboxPolicy } from './thread-metadata';

describe('formatSandboxPolicy', () => {
    it('should surface the policy type from serialized Codex metadata', () => {
        expect(formatSandboxPolicy('{"type":"danger-full-access"}')).toBe('danger full access');
        expect(formatSandboxPolicy('"workspace-write"')).toBe('workspace write');
    });

    it('should preserve readable non-JSON policies and tolerate malformed metadata', () => {
        expect(formatSandboxPolicy('workspace-write')).toBe('workspace write');
        expect(formatSandboxPolicy('{invalid')).toBe('{invalid');
        expect(formatSandboxPolicy('')).toBe('n/a');
    });
});
