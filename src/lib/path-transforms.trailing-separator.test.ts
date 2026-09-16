import { describe, expect, it } from 'bun:test';
import { applyPathTransforms } from './path-transforms';

describe('project roots with trailing separators', () => {
    it('should relativize paths when the configured workspace ends in a separator', () => {
        for (const projectPath of ['/home/alice/project/', '/home/alice/project///']) {
            expect(
                applyPathTransforms('/home/alice/project/src/main.ts', {
                    convertToProjectRoot: true,
                    projectPath,
                    redactUsername: false,
                }),
            ).toBe('src/main.ts');
        }
        expect(
            applyPathTransforms('C:\\work\\project\\src\\main.ts', {
                convertToProjectRoot: true,
                projectPath: 'C:\\work\\project\\',
                redactUsername: false,
            }),
        ).toBe('src\\main.ts');
    });
});
