import type { ClaudeCodeSessionTranscript } from '@spiracha/lib/claude-code-exporter-types';
import { describe, expect, it } from 'vitest';
import {
    claudeCodeTranscriptToThreadEvents,
    getClaudeCodeThreadTranscriptStats,
} from './claude-code-transcript-events';

const transcript: ClaudeCodeSessionTranscript = {
    entries: [
        {
            cwd: '/workspace/project',
            entryId: 'u1',
            parts: [{ raw: { text: 'Hello' }, text: 'Hello', type: 'text' }],
            raw: { type: 'user' },
            role: 'user',
            timestamp: '2026-06-01T10:00:00.000Z',
            type: 'user',
        },
        {
            cwd: '/workspace/project',
            entryId: 'a1',
            model: 'claude-sonnet-4-5',
            parts: [
                { raw: { thinking: 'Plan' }, text: 'Plan', type: 'thinking' },
                {
                    argumentsText: '{\n  "command": "pwd"\n}',
                    raw: { name: 'Bash' },
                    toolName: 'Bash',
                    toolUseId: 'toolu_1',
                    type: 'tool_use',
                },
                { raw: { text: 'Done' }, text: 'Done', type: 'text' },
            ],
            raw: { type: 'assistant' },
            role: 'assistant',
            timestamp: '2026-06-01T10:00:01.000Z',
            type: 'assistant',
        },
        {
            cwd: '/workspace/project',
            entryId: 'u2',
            parts: [
                {
                    isError: false,
                    outputText: '/workspace/project',
                    raw: { tool_use_id: 'toolu_1' },
                    toolUseId: 'toolu_1',
                    type: 'tool_result',
                },
            ],
            raw: { type: 'user' },
            role: 'user',
            timestamp: '2026-06-01T10:00:02.000Z',
            type: 'user',
        },
    ],
    rawEvents: [],
    renderablePartCount: 5,
    session: {
        assistantMessageCount: 1,
        attachmentCount: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        createdAtIso: '2026-06-01T10:00:00.000Z',
        createdAtMs: 1_780_307_200_000,
        cwd: '/workspace/project',
        filePath: '/tmp/session-a.jsonl',
        gitBranch: null,
        inputTokens: 5,
        lastActiveAtIso: '2026-06-01T10:00:02.000Z',
        lastActiveAtMs: 1_780_307_202_000,
        mergedSessionIds: ['session-a'],
        messageCount: 3,
        model: 'claude-sonnet-4-5',
        outputTokens: 8,
        renderablePartCount: 5,
        sessionId: 'session-a',
        title: 'Hello',
        toolCallCount: 1,
        toolResultCount: 1,
        totalTokens: 13,
        userMessageCount: 2,
        version: '2.1.148',
        workspaceKey: 'project:-workspace-project',
        workspaceLabel: 'project',
        worktree: '/workspace/project',
    },
};

describe('claudeCodeTranscriptToThreadEvents', () => {
    it('should adapt Claude Code messages, reasoning, tool calls, and tool outputs', () => {
        const events = claudeCodeTranscriptToThreadEvents(transcript);

        expect(events.map((event) => event.kind)).toEqual([
            'message',
            'reasoning',
            'tool_call',
            'message',
            'tool_output',
        ]);
        expect(events[0]).toMatchObject({ kind: 'message', phase: null, role: 'user', text: 'Hello' });
        expect(events[1]).toMatchObject({ kind: 'reasoning', summary: ['Plan'] });
        expect(events[2]).toMatchObject({
            callId: 'toolu_1',
            command: 'Bash\n{\n  "command": "pwd"\n}',
            kind: 'tool_call',
            name: 'Bash',
            workdir: '/workspace/project',
        });
        expect(events[3]).toMatchObject({
            kind: 'message',
            model: 'claude-sonnet-4-5',
            phase: 'final_answer',
            role: 'assistant',
            text: 'Done',
        });
        expect(events[4]).toMatchObject({
            callId: 'toolu_1',
            kind: 'tool_output',
            outputText: '/workspace/project',
        });

        expect(getClaudeCodeThreadTranscriptStats(events)).toMatchObject({
            assistantMessageCount: 1,
            execCommandCount: 1,
            finalAnswerCount: 1,
            messageCount: 2,
            toolCallCount: 1,
            toolOutputCount: 1,
            userMessageCount: 1,
        });
    });

    it('should classify assistant tool-use lead-ins as commentary and end turns as final answers', () => {
        const events = claudeCodeTranscriptToThreadEvents({
            ...transcript,
            entries: [
                {
                    cwd: '/workspace/project',
                    entryId: 'u1',
                    parts: [{ raw: { text: 'Review the roadmap' }, text: 'Review the roadmap', type: 'text' }],
                    raw: { type: 'user' },
                    role: 'user',
                    timestamp: '2026-06-01T10:00:00.000Z',
                    type: 'user',
                },
                {
                    cwd: '/workspace/project',
                    entryId: 'a1',
                    model: 'claude-opus-4-8',
                    parts: [
                        {
                            raw: { text: "I'll start by reading the roadmap" },
                            text: "I'll start by reading the roadmap",
                            type: 'text',
                        },
                        {
                            argumentsText: '{\n  "file_path": "MILESTONE-ROADMAP.md"\n}',
                            raw: { name: 'Read' },
                            toolName: 'Read',
                            toolUseId: 'toolu_roadmap',
                            type: 'tool_use',
                        },
                    ],
                    raw: { message: { stop_reason: 'tool_use' }, type: 'assistant' },
                    role: 'assistant',
                    timestamp: '2026-06-01T10:00:01.000Z',
                    type: 'assistant',
                },
                {
                    cwd: '/workspace/project',
                    entryId: 'a2',
                    model: 'claude-opus-4-8',
                    parts: [
                        {
                            raw: { text: 'Now let me read the rest' },
                            text: 'Now let me read the rest',
                            type: 'text',
                        },
                    ],
                    raw: { message: { stop_reason: 'tool_use' }, type: 'assistant' },
                    role: 'assistant',
                    timestamp: '2026-06-01T10:00:02.000Z',
                    type: 'assistant',
                },
                {
                    cwd: '/workspace/project',
                    entryId: 'a3',
                    model: 'claude-opus-4-8',
                    parts: [
                        {
                            raw: { text: 'All four proposals are written...' },
                            text: 'All four proposals are written...',
                            type: 'text',
                        },
                    ],
                    raw: { message: { stop_reason: 'end_turn' }, type: 'assistant' },
                    role: 'assistant',
                    timestamp: '2026-06-01T10:00:03.000Z',
                    type: 'assistant',
                },
            ],
            renderablePartCount: 4,
        });

        expect(events.map((event) => event.kind)).toEqual(['message', 'message', 'tool_call', 'message', 'message']);
        expect(events[1]).toMatchObject({
            kind: 'message',
            phase: 'commentary',
            role: 'assistant',
            text: "I'll start by reading the roadmap",
        });
        expect(events[3]).toMatchObject({
            kind: 'message',
            phase: 'commentary',
            role: 'assistant',
            text: 'Now let me read the rest',
        });
        expect(events[4]).toMatchObject({
            kind: 'message',
            phase: 'final_answer',
            role: 'assistant',
            text: 'All four proposals are written...',
        });
        expect(getClaudeCodeThreadTranscriptStats(events)).toMatchObject({
            assistantMessageCount: 3,
            commentaryCount: 2,
            finalAnswerCount: 1,
            messageCount: 4,
            toolCallCount: 1,
            userMessageCount: 1,
        });
    });

    it('should assign unique monotonically increasing event sequences when entries have many parts', () => {
        const events = claudeCodeTranscriptToThreadEvents({
            ...transcript,
            entries: [
                {
                    cwd: '/workspace/project',
                    entryId: 'a-many',
                    parts: Array.from({ length: 11 }, (_, index) => ({
                        raw: { text: `part ${index}` },
                        text: `part ${index}`,
                        type: 'text' as const,
                    })),
                    raw: { message: { stop_reason: 'end_turn' }, type: 'assistant' },
                    role: 'assistant',
                    timestamp: null,
                    type: 'assistant',
                },
                {
                    cwd: '/workspace/project',
                    entryId: 'u-next',
                    parts: [{ raw: { text: 'next' }, text: 'next', type: 'text' }],
                    raw: { type: 'user' },
                    role: 'user',
                    timestamp: null,
                    type: 'user',
                },
            ],
        });

        expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index));
    });

    it('should not expose Claude compaction control entries as thread messages', () => {
        const events = claudeCodeTranscriptToThreadEvents({
            ...transcript,
            entries: [
                {
                    cwd: '/workspace/project',
                    entryId: 'compact-summary',
                    parts: [
                        {
                            raw: { text: 'This session is being continued from a previous conversation.' },
                            text: 'This session is being continued from a previous conversation.',
                            type: 'text',
                        },
                    ],
                    raw: { isCompactSummary: true, type: 'user' },
                    role: 'user',
                    timestamp: null,
                    type: 'user',
                },
                {
                    cwd: '/workspace/project',
                    entryId: 'compact-command',
                    parts: [
                        {
                            raw: { text: '<command-name>/compact</command-name>' },
                            text: '<command-name>/compact</command-name>',
                            type: 'text',
                        },
                    ],
                    raw: { type: 'user' },
                    role: 'user',
                    timestamp: null,
                    type: 'user',
                },
                ...transcript.entries,
            ],
        });

        expect(events.some((event) => event.kind === 'message' && event.text.includes('/compact'))).toBe(false);
        expect(events.some((event) => event.kind === 'message' && event.text.includes('being continued'))).toBe(false);
        expect(events.some((event) => event.kind === 'message' && event.text === 'Hello')).toBe(true);
    });
});
