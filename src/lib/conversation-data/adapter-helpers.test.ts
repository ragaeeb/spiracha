import { describe, expect, it } from 'bun:test';
import { decodeFileUri } from './adapter-helpers';

describe('conversation adapter helpers', () => {
    it('should decode POSIX, Windows drive, and UNC file URIs', () => {
        expect(decodeFileUri('file:///Users/example/workspace/app')).toBe('/Users/example/workspace/app');
        expect(decodeFileUri('file:///C:/Users/example/workspace/app')).toBe('C:/Users/example/workspace/app');
        expect(decodeFileUri('file://server/share/project')).toBe('//server/share/project');
    });
});
