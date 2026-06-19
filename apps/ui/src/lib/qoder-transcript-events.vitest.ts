import type { QoderSessionTranscript } from '@spiracha/lib/qoder-exporter-types';
import { describe, expect, it } from 'vitest';
import { getQoderThreadTranscriptStats, qoderTranscriptToThreadEvents } from './qoder-transcript-events';

const transcript: QoderSessionTranscript = {
    entries: [
        {
            entryId: 'history-1',
            entryType: 'message',
            parts: [
                {
                    raw: { title: 'Review this code\\n/workspace/project/src/index.ts' },
                    text: 'Review this code\n/workspace/project/src/index.ts',
                    type: 'text',
                },
            ],
            raw: { id: 'history-1' },
            requestId: null,
            role: 'user',
            timestamp: '2026-06-01T10:00:00.000Z',
        },
        {
            entryId: 'state:create:0',
            entryType: 'tool_call',
            parts: [
                {
                    raw: { toolName: 'create_file', type: 'qoderFileOperation' },
                    text: 'Create file: /workspace/project/src/index.ts',
                    type: 'text',
                },
            ],
            raw: { type: 'create' },
            requestId: 'request-a',
            role: 'tool',
            timestamp: null,
        },
        {
            entryId: 'state:edit:1',
            entryType: 'tool_call',
            parts: [
                {
                    raw: { toolName: 'edit_file', type: 'qoderFileOperation' },
                    text: 'Edit file: /workspace/project/src/index.ts\nEdits: 1',
                    type: 'text',
                },
            ],
            raw: { type: 'textEdit' },
            requestId: 'request-a',
            role: 'tool',
            timestamp: null,
        },
        {
            entryId: 'tool-output-1',
            entryType: 'tool_output',
            parts: [
                {
                    raw: { toolCallId: 'call-1', toolName: 'Read', type: 'tool_result' },
                    text: 'const value = 1;',
                    type: 'text',
                },
            ],
            raw: { type: 'tool_result' },
            requestId: 'request-a',
            role: 'tool',
            timestamp: '2026-06-01T10:00:01.000Z',
        },
    ],
    rawSession: { sourceStatePath: '/tmp/state.json' },
    renderablePartCount: 3,
    session: {
        agentClass: 'QuestAgent',
        assistantMessageCount: 0,
        createdAtIso: '2026-06-01T10:00:00.000Z',
        createdAtMs: 1_780_307_200_000,
        executionMode: 'agent',
        fileOperationCount: 2,
        historyIds: ['history-1'],
        lastActiveAtIso: '2026-06-01T10:00:02.000Z',
        lastActiveAtMs: 1_780_307_202_000,
        messageCount: 1,
        model: 'qwen-3.7-max',
        query: 'Review this code',
        renderablePartCount: 3,
        requestId: 'request-a',
        sessionId: 'task-a.session.execution',
        snapshotFileCount: 1,
        sourceStatePath: '/tmp/state.json',
        status: 'Completed',
        taskId: 'task-a',
        title: 'Review this code',
        userMessageCount: 1,
        workspaceKey: 'workspace:project',
        workspaceLabel: 'project',
        workspacePath: '/workspace/project',
        workspaceStorageId: 'ws-a',
        worktree: '/workspace/project',
    },
};

describe('qoderTranscriptToThreadEvents', () => {
    it('should adapt Qoder prompt and file-operation entries', () => {
        const events = qoderTranscriptToThreadEvents(transcript);

        expect(events.map((event) => event.kind)).toEqual(['message', 'tool_call', 'tool_call', 'tool_output']);
        expect(events[0]).toMatchObject({
            kind: 'message',
            model: 'qwen-3.7-max',
            phase: null,
            role: 'user',
            text: 'Review this code\n/workspace/project/src/index.ts',
        });
        expect(events[1]).toMatchObject({
            command: 'Create file: /workspace/project/src/index.ts',
            kind: 'tool_call',
            name: 'create_file',
            workdir: '/workspace/project',
        });
        expect(events[2]).toMatchObject({
            command: 'Edit file: /workspace/project/src/index.ts\nEdits: 1',
            kind: 'tool_call',
            name: 'edit_file',
        });
        expect(events[3]).toMatchObject({
            callId: 'call-1',
            kind: 'tool_output',
            outputText: 'const value = 1;',
        });
        expect(getQoderThreadTranscriptStats(events)).toMatchObject({
            assistantMessageCount: 0,
            execCommandCount: 0,
            finalAnswerCount: 0,
            messageCount: 1,
            toolCallCount: 2,
            toolOutputCount: 1,
            userMessageCount: 1,
        });
    });
});
