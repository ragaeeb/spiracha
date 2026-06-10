import type { ThreadEvent } from '@spiracha/lib/codex-browser-types';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as settingsStore from '#/lib/settings-store';

const virtualizerCalls: Array<Record<string, unknown>> = [];

vi.mock('@tanstack/react-virtual', () => ({
    useVirtualizer: (options: Record<string, unknown>) => {
        virtualizerCalls.push(options);

        const count = Number(options.count ?? 0);

        return {
            getTotalSize: () => count * 160,
            getVirtualItems: () =>
                Array.from({ length: Math.min(count, 3) }, (_, index) => ({
                    index,
                    key: `virtual-${index}`,
                    start: index * 160,
                })),
            measureElement: vi.fn(),
        };
    },
}));

import { TranscriptView } from './transcript-view';

const messageEvent: Extract<ThreadEvent, { kind: 'message' }> = {
    isHiddenByDefault: false,
    kind: 'message',
    memoryCitation: null,
    model: null,
    phase: null,
    raw: { type: 'message' },
    role: 'user',
    sequence: 0,
    text: 'Build the UI',
    timestamp: '2026-05-17T16:49:28.109Z',
    variant: 'message',
};

const toolEvent: Extract<ThreadEvent, { kind: 'tool_call' }> = {
    argumentsParseFailed: false,
    argumentsText: '{"cmd":"rtk bun test"}',
    callId: 'call_1',
    command: 'rtk bun test',
    kind: 'tool_call',
    name: 'exec_command',
    raw: { type: 'function_call' },
    sequence: 1,
    timestamp: '2026-05-17T16:49:29.109Z',
    workdir: '/Users/example/workspace/spiracha',
};

describe('TranscriptView', () => {
    afterEach(() => {
        cleanup();
    });

    beforeEach(() => {
        virtualizerCalls.length = 0;
        vi.restoreAllMocks();
    });

    it('should hide and show tool calls based on the checkbox state passed in', () => {
        const { rerender } = render(
            <TranscriptView
                assistantModel={null}
                events={[messageEvent, toolEvent]}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary
                showExtraEvents={false}
                showRawJson={false}
                showToolCalls={false}
            />,
        );

        expect(screen.getByText('Build the UI')).toBeTruthy();
        expect(screen.queryByText('Tool call: exec_command')).toBeNull();

        rerender(
            <TranscriptView
                assistantModel={null}
                events={[messageEvent, toolEvent]}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary
                showExtraEvents={false}
                showRawJson={false}
                showToolCalls
            />,
        );

        expect(screen.getByText('Tool call: exec_command')).toBeTruthy();
    });

    it('should render message cards with wrapping constraints for long content', () => {
        render(
            <TranscriptView
                assistantModel={null}
                events={[
                    {
                        ...messageEvent,
                        role: 'assistant',
                        sequence: 2,
                        text: 'A'.repeat(400),
                    },
                ]}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary
                showExtraEvents={false}
                showRawJson={false}
                showToolCalls={false}
            />,
        );

        const messageBody = screen.getByText('A'.repeat(400));
        expect(messageBody.className).toContain('break-words');
        expect(messageBody.className).toContain('overflow-wrap:anywhere');

        const card = messageBody.closest('article');
        expect(card?.className).toContain('min-w-0');
    });

    it('should wrap long tool call commands without painting into adjacent cards', () => {
        render(
            <TranscriptView
                assistantModel={null}
                events={[
                    {
                        ...toolEvent,
                        command:
                            'rtk rg -n "' + 'very-long-token|'.repeat(40) + '" src/lib/codex-exporter-transcript.ts',
                        sequence: 3,
                    },
                ]}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary
                showExtraEvents={false}
                showRawJson={false}
                showToolCalls
            />,
        );

        const commandBody = screen.getByText(/rtk rg -n/);
        expect(commandBody.className).toContain('break-words');
        expect(commandBody.className).toContain('overflow-wrap:anywhere');
    });

    it('should configure virtualized transcript lists with dynamic measurement for variable-height cards', () => {
        render(
            <TranscriptView
                assistantModel={null}
                events={Array.from({ length: 41 }, (_, index) => ({
                    ...toolEvent,
                    command: `rtk rg -n "${'very-long-token|'.repeat(12)}" src/lib/file-${index}.ts`,
                    raw: { index, type: 'function_call' },
                    sequence: index,
                }))}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary
                showExtraEvents={false}
                showRawJson={false}
                showToolCalls
            />,
        );

        const latestCall = virtualizerCalls.at(-1);
        expect(latestCall?.measureElement).toBeTypeOf('function');
    });

    it('should hide and show commentary messages independently of other assistant messages', () => {
        const commentaryEvent: ThreadEvent = {
            isHiddenByDefault: false,
            kind: 'message',
            memoryCitation: null,
            model: 'gpt-5.4',
            phase: 'commentary',
            raw: { type: 'agent_message' },
            role: 'assistant',
            sequence: 4,
            text: 'I am working through the codebase now.',
            timestamp: '2026-05-17T16:49:30.109Z',
            variant: 'agent_message',
        };

        const finalAnswerEvent: ThreadEvent = {
            ...commentaryEvent,
            phase: 'final_answer',
            sequence: 5,
            text: 'Here is the final answer.',
        };

        const { rerender } = render(
            <TranscriptView
                assistantModel={null}
                events={[commentaryEvent, finalAnswerEvent]}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary={false}
                showExtraEvents={false}
                showRawJson={false}
                showToolCalls={false}
            />,
        );

        expect(screen.queryByText('I am working through the codebase now.')).toBeNull();
        expect(screen.getByText('Here is the final answer.')).toBeTruthy();
        expect(screen.getByText('Final Answer')).toBeTruthy();

        rerender(
            <TranscriptView
                assistantModel={null}
                events={[commentaryEvent, finalAnswerEvent]}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary
                showExtraEvents={false}
                showRawJson={false}
                showToolCalls={false}
            />,
        );

        expect(screen.getByText('I am working through the codebase now.')).toBeTruthy();
    });

    it('should hide user messages when user messages are disabled', () => {
        render(
            <TranscriptView
                assistantModel="gpt-5.4"
                events={[
                    messageEvent,
                    {
                        ...messageEvent,
                        role: 'assistant',
                        sequence: 6,
                        text: 'Implemented the requested dashboard update.',
                    },
                ]}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary
                showExtraEvents={false}
                showRawJson={false}
                showToolCalls={false}
                showUserMessages={false}
            />,
        );

        expect(screen.queryByText('Build the UI')).toBeNull();
        expect(screen.getByText('Implemented the requested dashboard update.')).toBeTruthy();
    });

    it('should label system messages as System instead of User', () => {
        render(
            <TranscriptView
                assistantModel={null}
                events={[
                    {
                        isHiddenByDefault: true,
                        kind: 'message',
                        memoryCitation: null,
                        model: null,
                        phase: null,
                        raw: {},
                        role: 'system',
                        sequence: 7,
                        text: 'Background event',
                        timestamp: null,
                        variant: 'message',
                    },
                ]}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary
                showExtraEvents
                showRawJson={false}
                showToolCalls={false}
            />,
        );

        expect(screen.getByRole('heading', { name: 'System' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'User' })).toBeNull();
    });

    it('should copy a single event as markdown from the per-card copy action', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, {
            clipboard: { writeText },
        });

        render(
            <TranscriptView
                assistantModel={null}
                events={[messageEvent]}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary
                showExtraEvents={false}
                showRawJson={false}
                showToolCalls={false}
            />,
        );

        fireEvent.click(screen.getAllByRole('button', { name: 'Copy message' })[0]!);

        expect(writeText).toHaveBeenCalledWith('## User\n\nBuild the UI');
    });

    it('should show copy failure feedback when the clipboard API is unavailable', async () => {
        const writeText = vi.fn().mockRejectedValue(new Error('clipboard unavailable'));
        Object.assign(navigator, {
            clipboard: { writeText },
        });

        render(
            <TranscriptView
                assistantModel={null}
                events={[messageEvent]}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary
                showExtraEvents={false}
                showRawJson={false}
                showToolCalls={false}
            />,
        );

        fireEvent.click(screen.getAllByRole('button', { name: 'Copy message' })[0]!);

        expect(await screen.findByText('Copy failed')).toBeTruthy();
    });

    it('should show the formatted model name for assistant messages and use it when copying', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, {
            clipboard: { writeText },
        });

        render(
            <TranscriptView
                assistantModel={null}
                events={[
                    {
                        ...messageEvent,
                        model: 'gpt-5.4',
                        role: 'assistant',
                        sequence: 6,
                        text: 'Implemented the export flow.',
                    },
                ]}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary
                showExtraEvents={false}
                showRawJson={false}
                showToolCalls={false}
            />,
        );

        expect(screen.getByRole('heading', { name: 'GPT 5.4' })).toBeTruthy();

        fireEvent.click(screen.getAllByRole('button', { name: 'Copy message' })[0]!);

        expect(writeText).toHaveBeenCalledWith('## GPT 5.4\n\nImplemented the export flow.');
    });

    it('should copy selected events as markdown separated by blank lines', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, {
            clipboard: { writeText },
        });

        render(
            <TranscriptView
                assistantModel={null}
                events={[
                    messageEvent,
                    {
                        ...toolEvent,
                        sequence: 2,
                    },
                ]}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary
                showExtraEvents={false}
                showRawJson={false}
                showToolCalls
            />,
        );

        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[1]!);
        fireEvent.click(checkboxes[2]!);
        fireEvent.click(screen.getAllByRole('button', { name: 'Copy selected messages' })[0]!);

        expect(writeText).toHaveBeenCalledWith(
            [
                '## User\n\nBuild the UI',
                '## Tool call: exec_command\n\nrtk bun test\n\n/Users/example/workspace/spiracha',
            ].join('\n\n'),
        );
    });

    it('should keep selection keys distinct for duplicate tool-call metadata', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, {
            clipboard: { writeText },
        });

        render(
            <TranscriptView
                assistantModel={null}
                events={[
                    {
                        ...toolEvent,
                        callId: null,
                        command: 'first command',
                        sequence: 12,
                        timestamp: null,
                    },
                    {
                        ...toolEvent,
                        callId: null,
                        command: 'second command',
                        sequence: 12,
                        timestamp: null,
                    },
                ]}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary={false}
                showExtraEvents={false}
                showRawJson={false}
                showToolCalls
            />,
        );

        fireEvent.click(screen.getAllByRole('checkbox', { name: /select tool call: exec_command/i })[0]!);
        fireEvent.click(screen.getAllByRole('button', { name: 'Copy selected messages' })[0]!);

        expect(writeText).toHaveBeenCalledWith(
            '## Tool call: exec_command\n\nfirst command\n\n/Users/example/workspace/spiracha',
        );
    });

    it('should fall back to the thread model label when an assistant message has no per-message model', () => {
        render(
            <TranscriptView
                assistantModel="gpt-5.4"
                events={[
                    {
                        ...messageEvent,
                        model: null,
                        role: 'assistant',
                        sequence: 8,
                        text: 'Fallback model label works.',
                    },
                ]}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary={false}
                showExtraEvents={false}
                showRawJson={false}
                showToolCalls={false}
            />,
        );

        expect(screen.getByRole('heading', { name: 'GPT 5.4' })).toBeTruthy();
    });

    it('should apply the same path transforms to copied markdown as the rendered transcript', async () => {
        vi.spyOn(settingsStore, 'useSettings').mockReturnValue({
            settings: {
                convertToProjectRoot: true,
                redactUsername: true,
            },
            updateSetting: vi.fn(),
        });

        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, {
            clipboard: { writeText },
        });

        render(
            <TranscriptView
                assistantModel={null}
                events={[
                    {
                        ...messageEvent,
                        sequence: 9,
                        text: [
                            'Project: /Users/example/workspace/spiracha/src/index.ts',
                            'External: /Users/other/Desktop/notes.md',
                        ].join('\n'),
                    },
                ]}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary={false}
                showExtraEvents={false}
                showRawJson={false}
                showToolCalls={false}
            />,
        );

        fireEvent.click(screen.getAllByRole('button', { name: 'Copy message' })[0]!);

        expect(writeText).toHaveBeenCalledWith(
            ['## User', '', 'Project: src/index.ts', 'External: ~/Desktop/notes.md'].join('\n'),
        );
    });

    it('should apply the same path transforms to bulk copied markdown as the rendered transcript', async () => {
        vi.spyOn(settingsStore, 'useSettings').mockReturnValue({
            settings: {
                convertToProjectRoot: true,
                redactUsername: true,
            },
            updateSetting: vi.fn(),
        });

        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, {
            clipboard: { writeText },
        });

        render(
            <TranscriptView
                assistantModel={null}
                events={[
                    {
                        ...messageEvent,
                        sequence: 10,
                        text: 'See /Users/example/workspace/spiracha/src/index.ts',
                    },
                    {
                        ...toolEvent,
                        sequence: 11,
                        workdir: 'C:\\Users\\other\\Desktop\\sandbox',
                    },
                ]}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary={false}
                showExtraEvents={false}
                showRawJson={false}
                showToolCalls
            />,
        );

        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[1]!);
        fireEvent.click(checkboxes[2]!);
        fireEvent.click(screen.getAllByRole('button', { name: 'Copy selected messages' })[0]!);

        expect(writeText).toHaveBeenCalledWith(
            ['## User\n\nSee src/index.ts', '## Tool call: exec_command\n\nrtk bun test\n\n~\\Desktop\\sandbox'].join(
                '\n\n',
            ),
        );
    });

    it('should render extra event kinds and raw json when those toggles are enabled', () => {
        render(
            <TranscriptView
                assistantModel="gpt-5.4"
                events={[
                    {
                        collaborationModeKind: 'default',
                        kind: 'task_started',
                        modelContextWindow: 123456,
                        raw: { type: 'task_started' },
                        sequence: 20,
                        startedAt: 1715964571109,
                        timestamp: '2026-05-17T16:49:31.109Z',
                        turnId: 'turn-1',
                    },
                    {
                        completedAt: 1715964572109,
                        durationMs: 55,
                        kind: 'task_complete',
                        lastAgentMessage: null,
                        raw: { type: 'task_complete' },
                        sequence: 21,
                        timestamp: '2026-05-17T16:49:32.109Z',
                        timeToFirstTokenMs: 7,
                        turnId: 'turn-1',
                    },
                    {
                        info: { bucket: 'primary' },
                        kind: 'token_count',
                        rateLimits: { primary: 1 },
                        raw: { type: 'token_count' },
                        sequence: 22,
                        timestamp: '2026-05-17T16:49:33.109Z',
                    },
                    {
                        content: { encrypted: true },
                        hasEncryptedContent: true,
                        kind: 'reasoning',
                        raw: { type: 'reasoning' },
                        sequence: 23,
                        summary: ['step', 'one'],
                        timestamp: '2026-05-17T16:49:34.109Z',
                    },
                    {
                        action: { engine: 'web' },
                        callId: 'search-1',
                        kind: 'web_search',
                        phase: 'call',
                        query: 'how to export codex chats',
                        raw: { type: 'web_search_call' },
                        sequence: 24,
                        status: 'running',
                        timestamp: '2026-05-17T16:49:35.109Z',
                    },
                ]}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary={false}
                showExtraEvents
                showRawJson
                showToolCalls={false}
            />,
        );

        expect(screen.getByText(/Context window: 123456/)).toBeTruthy();
        expect(screen.getByText(/Duration: 55 ms/)).toBeTruthy();
        expect(screen.getByText(/"primary": 1/)).toBeTruthy();
        expect(screen.getByText('Encrypted reasoning payload captured.')).toBeTruthy();
        expect(screen.getByText('how to export codex chats')).toBeTruthy();
        expect(screen.getAllByText(/"type":/).length).toBeGreaterThan(0);
    });

    it('should select all visible events from the sticky toolbar', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, {
            clipboard: { writeText },
        });

        render(
            <TranscriptView
                assistantModel={null}
                events={[messageEvent, { ...toolEvent, sequence: 30 }]}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary={false}
                showExtraEvents={false}
                showRawJson={false}
                showToolCalls
            />,
        );

        fireEvent.click(screen.getAllByRole('checkbox')[0]!);
        fireEvent.click(screen.getAllByRole('button', { name: 'Copy selected messages' })[0]!);

        expect(writeText).toHaveBeenCalledWith(
            [
                '## User\n\nBuild the UI',
                '## Tool call: exec_command\n\nrtk bun test\n\n/Users/example/workspace/spiracha',
            ].join('\n\n'),
        );
    });

    it('should discard hidden selections when filters hide previously selected events', () => {
        const { rerender } = render(
            <TranscriptView
                assistantModel={null}
                events={[messageEvent, toolEvent]}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary={false}
                showExtraEvents={false}
                showRawJson={false}
                showToolCalls
            />,
        );

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select Tool call: exec_command' }));
        expect(screen.getByText('1 selected')).toBeTruthy();

        rerender(
            <TranscriptView
                assistantModel={null}
                events={[messageEvent, toolEvent]}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary={false}
                showExtraEvents={false}
                showRawJson={false}
                showToolCalls={false}
            />,
        );

        expect(screen.getByText('0 selected')).toBeTruthy();

        rerender(
            <TranscriptView
                assistantModel={null}
                events={[messageEvent, toolEvent]}
                projectPath="/Users/example/workspace/spiracha"
                showCommentary={false}
                showExtraEvents={false}
                showRawJson={false}
                showToolCalls
            />,
        );

        expect(screen.getByText('0 selected')).toBeTruthy();
    });
});
