import { describe, expect, it } from 'bun:test';
import { applyPathTransforms } from './path-transforms';

describe('username redaction boundaries', () => {
    it('should preserve prose and newlines after bare home-directory paths', () => {
        const settings = { convertToProjectRoot: false, redactUsername: true };
        for (const home of ['/home/alice', '/Users/alice', 'C:\\Users\\alice']) {
            expect(applyPathTransforms(`Home: ${home}\nKeep this answer.`, settings)).toBe(
                'Home: ~\nKeep this answer.',
            );
            expect(applyPathTransforms(`Home: ${home} and more text`, settings)).toBe('Home: ~ and more text');
            expect(applyPathTransforms(`Home: \`${home}\``, settings)).toBe('Home: `~`');
        }
    });

    it('should still redact spaced usernames in complete paths without swallowing adjacent prose', () => {
        const settings = { convertToProjectRoot: false, redactUsername: true };
        expect(applyPathTransforms('/home/Alice Smith/repo/file', settings)).toBe('~/repo/file');
        expect(applyPathTransforms('/Users/Alice Smith/repo/file', settings)).toBe('~/repo/file');
        expect(applyPathTransforms(String.raw`C:\Users\Alice Smith\repo\file`, settings)).toBe(String.raw`~\repo\file`);
        expect(applyPathTransforms('/home/alice and /home/bob', settings)).toBe('~ and ~');
        expect(applyPathTransforms('/Users/John Doe', settings)).toBe('~');
        expect(applyPathTransforms('/Users/John Doe.', settings)).toBe('~.');
        expect(applyPathTransforms(String.raw`C:\Users\Jane Smith`, settings)).toBe('~');
        expect(applyPathTransforms(String.raw`C:\Users\Jane Smith)`, settings)).toBe('~)');
    });
});
