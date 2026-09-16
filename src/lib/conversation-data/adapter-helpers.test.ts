import { describe, expect, it } from 'bun:test';
import {
    canonicalRolePhaseIssues,
    classifyCanonicalInclusionBucket,
    conversationReadFields,
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
            toolEvidence: {
                durationMs: 0,
                exitCode: 0,
                inputContentState: null,
                outputContentState: { representation: 'full', state: 'available' },
                outputText: '',
                status: 'succeeded',
            },
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

    it('should attach available-full content state, native provenance, and normal visibility', () => {
        const [message] = createTextMessage({
            createdAtMs: 1,
            id: 'rec-1',
            order: 0,
            phase: 'final_answer',
            role: 'assistant',
            sourceConversationId: 'session-1',
            text: '',
            toolEvidence: {
                callId: 'call-1',
                command: null,
                durationMs: null,
                exitCode: null,
                inputText: null,
                name: 'read',
                namespace: null,
                outputText: null,
                status: 'unknown',
                workdir: null,
            },
        });

        expect(message).toMatchObject({
            contentState: { representation: 'full', state: 'available' },
            provenance: {
                blockIndex: null,
                branchId: null,
                origin: 'native',
                parentMessageId: null,
                sourceConversationId: 'session-1',
                sourceRecordId: 'rec-1',
            },
            text: '',
            visibility: 'normal',
        });
    });

    it('should classify canonical inclusion buckets by phase then role', () => {
        expect(classifyCanonicalInclusionBucket({ phase: 'tool_call', role: 'assistant' })).toBe('tool_call');
        expect(classifyCanonicalInclusionBucket({ phase: 'tool_output', role: 'user' })).toBe('tool_output');
        expect(classifyCanonicalInclusionBucket({ phase: 'reasoning', role: 'assistant' })).toBe('reasoning');
        expect(classifyCanonicalInclusionBucket({ phase: 'final_answer', role: 'assistant' })).toBe('assistant_final');
        expect(classifyCanonicalInclusionBucket({ phase: 'commentary', role: 'assistant' })).toBe(
            'assistant_commentary',
        );
        expect(classifyCanonicalInclusionBucket({ phase: 'unknown', role: 'user' })).toBe('user');
        expect(classifyCanonicalInclusionBucket({ phase: 'unknown', role: 'system' })).toBe('system');
        expect(classifyCanonicalInclusionBucket({ phase: 'unknown', role: 'assistant' })).toBe('unknown');
        expect(classifyCanonicalInclusionBucket({ phase: 'final_answer', role: 'tool' })).toBe('unknown');
    });

    it('should report impossible known role and phase combinations without repairing them', () => {
        expect(canonicalRolePhaseIssues({ phase: 'tool_call', role: 'user' })).toEqual([
            'tool_phase_requires_tool_role',
        ]);
        expect(canonicalRolePhaseIssues({ phase: 'tool_output', role: 'assistant' })).toEqual([
            'tool_phase_requires_tool_role',
        ]);
        expect(canonicalRolePhaseIssues({ phase: 'reasoning', role: 'user' })).toEqual([
            'reasoning_phase_requires_assistant_role',
        ]);
        expect(canonicalRolePhaseIssues({ phase: 'final_answer', role: 'tool' })).toEqual([
            'assistant_prose_phase_requires_assistant_role',
        ]);
        expect(canonicalRolePhaseIssues({ phase: 'unknown', role: 'assistant' })).toEqual([]);
        expect(canonicalRolePhaseIssues({ phase: 'tool_call', role: 'tool' })).toEqual([]);
        expect(canonicalRolePhaseIssues({ phase: 'final_answer', role: 'assistant' })).toEqual([]);
    });

    it('should report list rows as selected and detail reads as full', () => {
        expect(conversationReadFields({ includeMessages: false })).toEqual({});
        expect(conversationReadFields({ includeMessages: true, messageSelector: 'all' })).toEqual({
            bodyAvailability: 'full',
        });
        expect(conversationReadFields({ includeMessages: true, messageSelector: 'last_final_answer' })).toEqual({
            bodyAvailability: 'selected',
        });
    });
});
