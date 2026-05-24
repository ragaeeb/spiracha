import { describe, expect, it } from 'bun:test';
import { applyPathTransforms } from './path-transforms';

describe('applyPathTransforms', () => {
    it('should convert project paths before redacting remaining usernames on macOS paths', () => {
        const text = [
            'Project file: /Users/user/workspace/spiracha/src/index.ts',
            'External file: /Users/other/Desktop/notes.md',
        ].join('\n');

        expect(
            applyPathTransforms(text, {
                convertToProjectRoot: true,
                projectPath: '/Users/user/workspace/spiracha',
                redactUsername: true,
            }),
        ).toBe(['Project file: src/index.ts', 'External file: ~/Desktop/notes.md'].join('\n'));
    });

    it('should render the exact project root as a dot instead of an empty string', () => {
        expect(
            applyPathTransforms('/Users/user/workspace/spiracha', {
                convertToProjectRoot: true,
                projectPath: '/Users/user/workspace/spiracha',
                redactUsername: true,
            }),
        ).toBe('.');
    });

    it('should handle Windows-style project paths and redact remaining Windows usernames', () => {
        const text = [
            'Project file: C:\\Users\\user\\workspace\\spiracha\\src\\index.ts',
            'External file: C:\\Users\\other\\Desktop\\notes.md',
        ].join('\n');

        expect(
            applyPathTransforms(text, {
                convertToProjectRoot: true,
                projectPath: 'C:\\Users\\user\\workspace\\spiracha',
                redactUsername: true,
            }),
        ).toBe(['Project file: src\\index.ts', 'External file: ~\\Desktop\\notes.md'].join('\n'));
    });

    it('should not rewrite sibling paths that only share the project-path prefix', () => {
        expect(
            applyPathTransforms('/Users/user/workspace/spiracha-docs/README.md', {
                convertToProjectRoot: true,
                projectPath: '/Users/user/workspace/spiracha',
                redactUsername: true,
            }),
        ).toBe('~/workspace/spiracha-docs/README.md');
    });
});
