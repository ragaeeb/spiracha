import { describe, expect, it } from 'bun:test';
import { createConversationUiPath, createDeepLinks, decodeFileUri, isWithinUpdatedWindow } from './adapter-helpers';

describe('conversation adapter helpers', () => {
    it('should decode POSIX, Windows drive, and UNC file URIs', () => {
        expect(decodeFileUri('file:///Users/example/workspace/app')).toBe('/Users/example/workspace/app');
        expect(decodeFileUri('file:///C:/Users/example/workspace/app')).toBe('C:/Users/example/workspace/app');
        expect(decodeFileUri('file://server/share/project')).toBe('//server/share/project');
    });

    it('should preserve malformed percent encoding in file URIs', () => {
        expect(decodeFileUri('file:///Users/example/100%done')).toBe('/Users/example/100%done');
    });

    it('should apply updated time windows before transcript hydration', () => {
        expect(isWithinUpdatedWindow(200, { updatedAfterMs: 100, updatedBeforeMs: 300 })).toBe(true);
        expect(isWithinUpdatedWindow(50, { updatedAfterMs: 100 })).toBe(false);
        expect(isWithinUpdatedWindow(350, { updatedBeforeMs: 300 })).toBe(false);
        expect(isWithinUpdatedWindow(null, { updatedAfterMs: 1 })).toBe(false);
    });

    it('should encode conversation ids in portable and UI deep links', () => {
        const id = 'session/with spaces?#';

        expect(createConversationUiPath('grok-sessions', id)).toBe('/grok-sessions/session%2Fwith%20spaces%3F%23');
        expect(createDeepLinks('grok', id, createConversationUiPath('grok-sessions', id))).toEqual({
            native: null,
            spiracha: 'spiracha://conversation/grok/session%2Fwith%20spaces%3F%23',
            ui: '/grok-sessions/session%2Fwith%20spaces%3F%23',
        });
    });
});
