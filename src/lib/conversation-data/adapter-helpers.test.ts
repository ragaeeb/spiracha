import { describe, expect, it } from 'bun:test';
import {
    createConversationUiPath,
    createDeepLinks,
    createTextMessage,
    decodeFileUri,
    getToolNamespace,
    isWithinUpdatedWindow,
} from './adapter-helpers';

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

        expect(createConversationUiPath('grok', id)).toBe('/grok-sessions/session%2Fwith%20spaces%3F%23');
        expect(createDeepLinks('grok', id, createConversationUiPath('grok', id))).toEqual({
            native: null,
            spiracha: 'spiracha://conversation/grok/session%2Fwith%20spaces%3F%23',
            ui: '/grok-sessions/session%2Fwith%20spaces%3F%23',
        });
    });

    it('should extract a tool namespace without retaining the delimiter', () => {
        expect(getToolNamespace('workspace.read')).toBe('workspace');
        expect(getToolNamespace('read')).toBeNull();
    });

    it('should omit an unavailable canonical model from normalized messages', () => {
        const [message] = createTextMessage({
            createdAtMs: null,
            id: 'message-1',
            model: undefined,
            order: 0,
            phase: 'unknown',
            role: 'unknown',
            text: 'message',
        });

        expect(message).not.toHaveProperty('model');
    });

    it('should keep untrimmed bodies and empty observed tool outputs', () => {
        const [padded] = createTextMessage({
            createdAtMs: 10,
            id: 'u0',
            order: 0,
            phase: 'unknown',
            role: 'user',
            text: '  keep leading\r\nline two  \n',
        });
        const [emptyOutput] = createTextMessage({
            createdAtMs: null,
            id: 'to4',
            order: 4,
            phase: 'tool_output',
            role: 'tool',
            text: '',
            toolEvidence: {
                callId: 'call-1',
                command: null,
                durationMs: 0,
                exitCode: 0,
                inputText: null,
                name: 'exec',
                namespace: 'functions',
                outputText: '',
                status: 'succeeded',
                workdir: null,
            },
        });

        expect(padded?.text).toBe('  keep leading\r\nline two  \n');
        expect(emptyOutput).toMatchObject({
            id: 'to4',
            text: '',
            toolEvidence: { durationMs: 0, exitCode: 0, outputText: '', status: 'succeeded' },
        });
        expect(
            createTextMessage({
                createdAtMs: null,
                id: 'skip',
                order: 1,
                phase: 'unknown',
                role: 'unknown',
                text: '',
            }),
        ).toEqual([]);
        expect(
            createTextMessage({
                createdAtMs: null,
                id: 'skip-null',
                order: 1,
                phase: 'unknown',
                role: 'unknown',
                text: null,
            }),
        ).toEqual([]);
    });
});
