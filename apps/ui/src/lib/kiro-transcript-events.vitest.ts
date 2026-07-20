import type { ThreadEvent } from '@spiracha/lib/codex-browser-types';
import type { KiroSessionTranscript } from '@spiracha/lib/kiro-exporter-types';
import { describe, expect, it } from 'vitest';
import { getKiroThreadTranscriptStats, kiroTranscriptToThreadEvents } from './kiro-transcript-events';

const transcript: KiroSessionTranscript = {
    entries: [
        {
            entryId: 'u1',
            entryType: 'message',
            executionId: null,
            parts: [
                { raw: { text: 'Hello' }, text: 'Hello', type: 'text' },
                {
                    imageUrl: 'data:image/png;base64,AAA',
                    raw: { type: 'imageUrl' },
                    text: 'Image attachment',
                    type: 'image',
                },
            ],
            promptLogCount: 0,
            raw: { message: { role: 'user' } },
            role: 'user',
            timestamp: null,
        },
        {
            entryId: 'a1',
            entryType: 'message',
            executionId: 'execution-a',
            parts: [{ raw: { content: 'Done' }, text: 'Done', type: 'text' }],
            promptLogCount: 1,
            raw: { message: { role: 'assistant' } },
            role: 'assistant',
            timestamp: null,
        },
    ],
    executionEntries: [],
    historyEntries: [],
    rawExecutions: [],
    rawHistory: [],
    rawSession: { sessionId: 'session-a' },
    renderablePartCount: 3,
    session: {
        assistantMessageCount: 1,
        autonomyMode: 'Autopilot',
        createdAtIso: '2026-06-01T10:00:00.000Z',
        createdAtMs: 1_780_307_200_000,
        defaultModelTitle: 'Agent',
        filePath: '/tmp/session-a.json',
        imageCount: 1,
        lastActiveAtIso: '2026-06-01T10:00:02.000Z',
        lastActiveAtMs: 1_780_307_202_000,
        messageCount: 2,
        promptLogCount: 1,
        renderablePartCount: 3,
        selectedModel: 'claude-sonnet-4.5',
        selectedProfileId: 'local',
        sessionId: 'session-a',
        sessionType: 'spec',
        title: 'Hello',
        userMessageCount: 1,
        workspaceDirectory: '/workspace/project',
        workspaceKey: 'workspace:project',
        workspaceLabel: 'project',
        workspacePath: '/workspace/project',
        worktree: '/workspace/project',
    },
};

describe('kiroTranscriptToThreadEvents', () => {
    it('should adapt Kiro text and image message parts', () => {
        const events = kiroTranscriptToThreadEvents(transcript);

        expect(events.map((event) => event.kind)).toEqual(['message', 'message', 'message']);
        expect(events[0]).toMatchObject({ kind: 'message', phase: null, role: 'user', text: 'Hello' });
        expect(events[1]).toMatchObject({
            kind: 'message',
            phase: null,
            role: 'user',
            text: 'Image attachment',
        });
        expect(events[2]).toMatchObject({
            kind: 'message',
            model: 'claude-sonnet-4.5',
            phase: 'final_answer',
            role: 'assistant',
            text: 'Done',
        });

        expect(getKiroThreadTranscriptStats(events)).toMatchObject({
            assistantMessageCount: 1,
            finalAnswerCount: 1,
            messageCount: 3,
            toolCallCount: 0,
            toolOutputCount: 0,
            userMessageCount: 2,
        });
    });

    it('should preserve the already merged Kiro text part from the DB parser', () => {
        const events = kiroTranscriptToThreadEvents({
            ...transcript,
            entries: [
                {
                    entryId: 'u2',
                    entryType: 'message',
                    executionId: null,
                    parts: [
                        {
                            raw: { text: 'First read AGENTS.md.\n\nDev notes:\n\n**Problem Statement**' },
                            text: 'First read AGENTS.md.\n\nDev notes:\n\n**Problem Statement**',
                            type: 'text',
                        },
                    ],
                    promptLogCount: 0,
                    raw: { message: { role: 'user' } },
                    role: 'user',
                    timestamp: null,
                },
            ],
            renderablePartCount: 1,
        });

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            kind: 'message',
            role: 'user',
            text: 'First read AGENTS.md.\n\nDev notes:\n\n**Problem Statement**',
        });
    });

    it('should classify Kiro execution commentary and tool calls', () => {
        const events = kiroTranscriptToThreadEvents({
            ...transcript,
            entries: [
                {
                    entryId: 'u1',
                    entryType: 'message',
                    executionId: null,
                    parts: [{ raw: { text: 'Review this code' }, text: 'Review this code', type: 'text' }],
                    promptLogCount: 0,
                    raw: { message: { role: 'user' } },
                    role: 'user',
                    timestamp: null,
                },
                {
                    entryId: 'execution-a:read-file',
                    entryType: 'tool_call',
                    executionId: 'execution-a',
                    parts: [
                        {
                            raw: { toolName: 'read_file', type: 'toolCall' },
                            text: 'Read file: /workspace/src/hint-payload.ts:1800-2901',
                            type: 'text',
                        },
                    ],
                    promptLogCount: 0,
                    raw: { actionId: 'read-file' },
                    role: 'tool',
                    timestamp: null,
                },
                {
                    entryId: 'execution-a:assistant-1',
                    entryType: 'message',
                    executionId: 'execution-a',
                    parts: [
                        {
                            raw: { type: 'assistantMessage' },
                            text: "I'll conduct a comprehensive code review",
                            type: 'text',
                        },
                    ],
                    promptLogCount: 0,
                    raw: { actionId: 'assistant-1' },
                    role: 'assistant',
                    timestamp: null,
                },
                {
                    entryId: 'execution-a:search-code',
                    entryType: 'tool_call',
                    executionId: 'execution-a',
                    parts: [
                        {
                            raw: { toolName: 'search', type: 'toolCall' },
                            text: 'Search: Searching for the shortIdentifierScan retention implementation',
                            type: 'text',
                        },
                    ],
                    promptLogCount: 0,
                    raw: { actionId: 'search-code' },
                    role: 'tool',
                    timestamp: null,
                },
                {
                    entryId: 'execution-a:assistant-2',
                    entryType: 'message',
                    executionId: 'execution-a',
                    parts: [
                        {
                            raw: { type: 'assistantMessage' },
                            text: 'Based on my review of the code, here is the final analysis.',
                            type: 'text',
                        },
                    ],
                    promptLogCount: 0,
                    raw: { actionId: 'assistant-2' },
                    role: 'assistant',
                    timestamp: null,
                },
            ],
            renderablePartCount: 5,
        });

        expect(events.map((event) => event.kind)).toEqual(['message', 'tool_call', 'message', 'tool_call', 'message']);
        expect(events[1]).toMatchObject({
            command: 'Read file: /workspace/src/hint-payload.ts:1800-2901',
            kind: 'tool_call',
            name: 'read_file',
        });
        expect(events[2]).toMatchObject({
            kind: 'message',
            phase: 'commentary',
            role: 'assistant',
            text: "I'll conduct a comprehensive code review",
        });
        expect(events[3]).toMatchObject({
            command: 'Search: Searching for the shortIdentifierScan retention implementation',
            kind: 'tool_call',
            name: 'search',
        });
        expect(events[4]).toMatchObject({
            kind: 'message',
            phase: 'final_answer',
            role: 'assistant',
            text: 'Based on my review of the code, here is the final analysis.',
        });
        expect(getKiroThreadTranscriptStats(events)).toMatchObject({
            assistantMessageCount: 2,
            commentaryCount: 1,
            execCommandCount: 0,
            finalAnswerCount: 1,
            messageCount: 3,
            toolCallCount: 2,
            userMessageCount: 1,
        });
    });

    it('should classify the last assistant message before each user turn as a final answer', () => {
        const events = kiroTranscriptToThreadEvents({
            ...transcript,
            entries: [
                {
                    entryId: 'u1',
                    entryType: 'message',
                    executionId: null,
                    parts: [{ raw: { text: 'First task' }, text: 'First task', type: 'text' }],
                    promptLogCount: 0,
                    raw: { message: { role: 'user' } },
                    role: 'user',
                    timestamp: null,
                },
                {
                    entryId: 'a1-commentary',
                    entryType: 'message',
                    executionId: 'execution-a',
                    parts: [{ raw: { type: 'assistantMessage' }, text: 'Reading files', type: 'text' }],
                    promptLogCount: 0,
                    raw: { actionId: 'a1-commentary' },
                    role: 'assistant',
                    timestamp: null,
                },
                {
                    entryId: 'a1-final',
                    entryType: 'message',
                    executionId: 'execution-a',
                    parts: [{ raw: { type: 'assistantMessage' }, text: 'First task complete', type: 'text' }],
                    promptLogCount: 0,
                    raw: { actionId: 'a1-final' },
                    role: 'assistant',
                    timestamp: null,
                },
                {
                    entryId: 'u2',
                    entryType: 'message',
                    executionId: null,
                    parts: [{ raw: { text: 'Second task' }, text: 'Second task', type: 'text' }],
                    promptLogCount: 0,
                    raw: { message: { role: 'user' } },
                    role: 'user',
                    timestamp: null,
                },
                {
                    entryId: 'a2-commentary',
                    entryType: 'message',
                    executionId: 'execution-b',
                    parts: [{ raw: { type: 'assistantMessage' }, text: 'Checking context', type: 'text' }],
                    promptLogCount: 0,
                    raw: { actionId: 'a2-commentary' },
                    role: 'assistant',
                    timestamp: null,
                },
                {
                    entryId: 'a2-final',
                    entryType: 'message',
                    executionId: 'execution-b',
                    parts: [{ raw: { type: 'assistantMessage' }, text: 'Second task complete', type: 'text' }],
                    promptLogCount: 0,
                    raw: { actionId: 'a2-final' },
                    role: 'assistant',
                    timestamp: null,
                },
            ],
        });
        const assistantMessages = events.filter(
            (event): event is Extract<ThreadEvent, { kind: 'message' }> =>
                event.kind === 'message' && event.role === 'assistant',
        );

        expect(assistantMessages.map((event) => [event.text, event.phase])).toEqual([
            ['Reading files', 'commentary'],
            ['First task complete', 'final_answer'],
            ['Checking context', 'commentary'],
            ['Second task complete', 'final_answer'],
        ]);
        expect(getKiroThreadTranscriptStats(events)).toMatchObject({
            commentaryCount: 2,
            finalAnswerCount: 2,
        });
    });

    it('should count shell-like Kiro tool names as exec commands', () => {
        const events = kiroTranscriptToThreadEvents({
            ...transcript,
            entries: [
                {
                    entryId: 'execution-a:execute',
                    entryType: 'tool_call',
                    executionId: 'execution-a',
                    parts: [
                        {
                            raw: { toolName: 'execute_command', type: 'toolCall' },
                            text: 'pnpm test',
                            type: 'text',
                        },
                    ],
                    promptLogCount: 0,
                    raw: { actionId: 'execute' },
                    role: 'tool',
                    timestamp: null,
                },
            ],
        });

        expect(getKiroThreadTranscriptStats(events)).toMatchObject({
            execCommandCount: 1,
            toolCallCount: 1,
        });
    });
});
