import type { ThreadEvent } from '@spiracha/lib/codex-browser-types';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./transcript-view', () => ({
    TranscriptView: ({ events }: { events: ThreadEvent[] }) => (
        <div data-testid="tool-activity-events">{events.map((event) => event.kind).join(',')}</div>
    ),
}));

import { ThreadToolsPanel } from './thread-tools-panel';

const baseEvent = {
    raw: {},
    sequence: 1,
    timestamp: '2026-07-18T12:00:00.000Z',
};

const events: ThreadEvent[] = [
    {
        ...baseEvent,
        isHiddenByDefault: false,
        kind: 'message',
        memoryCitation: null,
        model: null,
        phase: 'final_answer',
        role: 'assistant',
        text: 'Done',
        variant: 'agent_message',
    },
    {
        ...baseEvent,
        argumentsParseFailed: false,
        argumentsText: '{}',
        callId: 'call-1',
        command: null,
        kind: 'tool_call',
        name: 'read_thread_terminal',
        sequence: 2,
        workdir: null,
    },
    {
        ...baseEvent,
        callId: 'call-1',
        exitCode: 0,
        kind: 'tool_output',
        outputText: 'ready',
        sequence: 3,
        summary: 'ready',
        wallTime: null,
    },
    {
        ...baseEvent,
        action: null,
        callId: 'search-1',
        kind: 'web_search',
        phase: 'call',
        query: 'Spiracha',
        sequence: 4,
        status: null,
    },
];

describe('ThreadToolsPanel', () => {
    afterEach(cleanup);

    it('should show available definitions and only tool-focused transcript activity', () => {
        render(
            <ThreadToolsPanel
                assistantModel="gpt-5.6"
                availableTools={[
                    {
                        deferLoading: false,
                        description: 'Read the current terminal output.',
                        inputSchema: { additionalProperties: false, type: 'object' },
                        name: 'read_thread_terminal',
                        namespace: 'codex_app',
                    },
                ]}
                events={events}
                projectPath="/workspace/spiracha"
                showRawJson={false}
                sortOrder="earliest"
                transcriptState="available"
            />,
        );

        expect(screen.getByRole('heading', { name: 'Available tools' })).toBeTruthy();
        expect(screen.getByText('read_thread_terminal')).toBeTruthy();
        expect(screen.getByText('Read the current terminal output.')).toBeTruthy();
        expect(screen.getByText('codex_app')).toBeTruthy();
        expect(screen.getByTestId('tool-activity-events').textContent).toBe('tool_call,tool_output,web_search');
    });

    it('should let deferred tool activity request a full transcript load', () => {
        const onLoadTranscript = vi.fn();

        render(
            <ThreadToolsPanel
                assistantModel={null}
                availableTools={[]}
                events={null}
                projectPath={null}
                showRawJson={false}
                sortOrder="earliest"
                transcriptState="deferred"
                onLoadTranscript={onLoadTranscript}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Load tool activity' }));
        expect(onLoadTranscript).toHaveBeenCalledOnce();
    });

    it('should deduplicate logically identical tool schemas with different key order', () => {
        render(
            <ThreadToolsPanel
                assistantModel={null}
                availableTools={[
                    {
                        deferLoading: false,
                        description: 'Run a command.',
                        inputSchema: { properties: { cmd: { type: 'string' } }, type: 'object' },
                        name: 'exec_command',
                        namespace: 'codex',
                    },
                    {
                        deferLoading: false,
                        description: 'Run a command.',
                        inputSchema: { properties: { cmd: { type: 'string' } }, type: 'object' },
                        name: 'exec_command',
                        namespace: 'codex',
                    },
                ]}
                events={[]}
                projectPath={null}
                showRawJson={false}
                sortOrder="earliest"
                transcriptState="available"
            />,
        );

        expect(screen.getAllByText('exec_command')).toHaveLength(1);
    });
});
