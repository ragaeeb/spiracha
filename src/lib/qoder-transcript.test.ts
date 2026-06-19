import { describe, expect, it } from 'bun:test';
import type { QoderSessionTranscript } from './qoder-exporter-types';
import { renderQoderTranscript } from './qoder-transcript';

const transcript: QoderSessionTranscript = {
    entries: [
        {
            entryId: 'history-1',
            entryType: 'message',
            parts: [
                {
                    raw: { title: 'Review wizard step 9' },
                    text: 'Review wizard step 9',
                    type: 'text',
                },
            ],
            raw: { id: 'history-1' },
            requestId: null,
            role: 'user',
            timestamp: '2026-06-01T10:00:00.000Z',
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
            timestamp: null,
        },
    ],
    rawSession: { sourceStatePath: '/tmp/state.json' },
    renderablePartCount: 2,
    session: {
        agentClass: 'QuestAgent',
        assistantMessageCount: 0,
        createdAtIso: '2026-06-01T10:00:00.000Z',
        createdAtMs: 1_780_307_200_000,
        executionMode: 'agent',
        fileOperationCount: 1,
        historyIds: ['history-1'],
        lastActiveAtIso: '2026-06-01T10:00:02.000Z',
        lastActiveAtMs: 1_780_307_202_000,
        messageCount: 1,
        model: 'qwen-3.7-max',
        query: 'Review wizard step 9',
        renderablePartCount: 2,
        requestId: 'request-a',
        sessionId: 'task-a.session.execution',
        snapshotFileCount: 1,
        sourceStatePath: '/tmp/state.json',
        status: 'Completed',
        taskId: 'task-a',
        title: 'Wizard Step 9 Split',
        userMessageCount: 1,
        workspaceKey: 'workspace:project',
        workspaceLabel: 'project',
        workspacePath: '/workspace/project',
        workspaceStorageId: 'ws-a',
        worktree: '/workspace/project',
    },
};

describe('renderQoderTranscript', () => {
    it('should render metadata, user prompts, and Qoder file operations as markdown', () => {
        const rendered = renderQoderTranscript(transcript, {
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
        });

        expect(rendered).toContain('# Wizard Step 9 Split');
        expect(rendered).toContain('exported_from: "qoder_local_history"');
        expect(rendered).toContain('task_id: "task-a"');
        expect(rendered).toContain('model: "qwen-3.7-max"');
        expect(rendered).toContain('## User');
        expect(rendered).toContain('Review wizard step 9');
        expect(rendered).toContain('## Tool call');
        expect(rendered).toContain('Edit file: /workspace/project/src/index.ts');
        expect(rendered).toContain('## Tool output');
        expect(rendered).toContain('const value = 1;');
    });

    it('should omit optional metadata and tool calls', () => {
        const rendered = renderQoderTranscript(transcript, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'md',
        });

        expect(rendered).not.toContain('exported_from');
        expect(rendered).not.toContain('Edit file:');
        expect(rendered).not.toContain('const value = 1;');
        expect(rendered).toContain('Review wizard step 9');
    });

    it('should render true plain text when requested', () => {
        const rendered = renderQoderTranscript(transcript, {
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'txt',
        });

        expect(rendered).toContain('Wizard Step 9 Split\n===================');
        expect(rendered).toContain('Tool call\n---------');
        expect(rendered).toContain('Tool output\n-----------');
        expect(rendered).not.toContain('```');
    });
});
