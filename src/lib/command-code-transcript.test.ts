import { describe, expect, it } from 'bun:test';
import type { CommandCodeSessionTranscript } from './command-code-exporter-types';
import { renderCommandCodeTranscript } from './command-code-transcript';

const transcript: CommandCodeSessionTranscript = {
    messages: [
        {
            createdAtMs: 1_700_000_000_000,
            id: 'user-1',
            metadata: {},
            order: 0,
            phase: 'unknown',
            role: 'user',
            text: 'Review the exporter.',
            toolEvidence: null,
        },
        {
            createdAtMs: 1_700_000_001_000,
            id: 'assistant-progress',
            metadata: {},
            model: 'meta/muse-spark-1.3-contributor',
            order: 1,
            phase: 'commentary',
            role: 'assistant',
            text: 'Inspecting the export path.',
            toolEvidence: null,
        },
        {
            createdAtMs: 1_700_000_002_000,
            id: 'reasoning-1',
            metadata: {},
            model: 'meta/muse-spark-1.3-contributor',
            order: 2,
            phase: 'reasoning',
            role: 'assistant',
            text: 'The export should preserve tool order.',
            toolEvidence: null,
        },
        {
            createdAtMs: 1_700_000_003_000,
            id: 'tool-call-1',
            metadata: {},
            order: 3,
            phase: 'tool_call',
            role: 'tool',
            text: 'read_file\n{"path":"AGENTS.md"}',
            toolEvidence: {
                callId: 'call-1',
                command: null,
                durationMs: null,
                exitCode: null,
                inputText: '{"path":"AGENTS.md"}',
                name: 'read_file',
                namespace: null,
                outputText: null,
                status: 'unknown',
                workdir: null,
            },
        },
        {
            createdAtMs: 1_700_000_004_000,
            id: 'tool-output-1',
            metadata: {},
            order: 4,
            phase: 'tool_output',
            role: 'tool',
            text: 'export const fixed = true;',
            toolEvidence: {
                callId: 'call-1',
                command: null,
                durationMs: null,
                exitCode: 0,
                inputText: null,
                name: 'read_file',
                namespace: null,
                outputText: 'export const fixed = true;',
                status: 'succeeded',
                workdir: null,
            },
        },
        {
            createdAtMs: 1_700_000_005_000,
            id: 'assistant-final',
            metadata: {},
            model: 'meta/muse-spark-1.3-contributor',
            order: 5,
            phase: 'final_answer',
            role: 'assistant',
            text: 'The export path is fixed.',
            toolEvidence: null,
        },
    ],
    rawRecords: [],
    session: {
        assistantMessageCount: 3,
        createdAtMs: 1_700_000_000_000,
        cwd: '/workspace/project',
        filePath: '/tmp/command-code/session-1.jsonl',
        lastActiveAtMs: 1_700_000_005_000,
        messageCount: 6,
        model: 'meta/muse-spark-1.3-contributor',
        modelLabel: 'Muse Spark 1.3 Contributor',
        recordCount: 7,
        renderableMessageCount: 6,
        sessionId: 'session-1',
        title: 'Export audit',
        toolCallCount: 1,
        toolOutputCount: 1,
        userMessageCount: 1,
        workspaceKey: 'command-code:workspace',
        workspaceLabel: 'project',
        worktree: '/workspace/project',
    },
};

describe('renderCommandCodeTranscript', () => {
    it('should render metadata, commentary, tools, and final messages when enabled', () => {
        const markdown = renderCommandCodeTranscript(transcript, {
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
        });

        expect(markdown).toContain('# Export audit');
        expect(markdown).toContain('exported_from: "command_code_sessions"');
        expect(markdown).toContain('Inspecting the export path.');
        expect(markdown).toContain('The export should preserve tool order.');
        expect(markdown).toContain('Tool: `read_file`');
        expect(markdown).toContain('export const fixed = true;');
        expect(markdown).toContain('The export path is fixed.');
    });

    it('should omit commentary, metadata, and tools when disabled', () => {
        const markdown = renderCommandCodeTranscript(transcript, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'md',
        });

        expect(markdown).toContain('Review the exporter.');
        expect(markdown).toContain('The export path is fixed.');
        expect(markdown).not.toContain('Inspecting the export path.');
        expect(markdown).not.toContain('The export should preserve tool order.');
        expect(markdown).not.toContain('exported_from');
        expect(markdown).not.toContain('read_file');
        expect(markdown).not.toContain('export const fixed = true;');
    });

    it('should render plain text output', () => {
        const text = renderCommandCodeTranscript(transcript, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'txt',
        });

        expect(text).toContain('Export audit\n============');
        expect(text).toContain('Muse Spark 1.3 Contributor\n--------------------------\nThe export path is fixed.');
        expect(text).not.toContain('#');
        expect(text).not.toContain('`');
    });
});
