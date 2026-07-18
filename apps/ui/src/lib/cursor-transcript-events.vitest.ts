import type { CursorThreadTranscript } from '@spiracha/lib/cursor-exporter-types';
import { describe, expect, it } from 'vitest';
import { cursorTranscriptToThreadEvents, getCursorThreadTranscriptStats } from './cursor-transcript-events';

const buildTranscript = (): CursorThreadTranscript => ({
    bubbles: [
        {
            bubbleId: 'u1',
            createdAtMs: 1_700_000_000_000,
            kind: 'user',
            text: 'Please inspect the repo',
            thinking: null,
            toolCall: null,
        },
        {
            bubbleId: 'a1',
            createdAtMs: 1_700_000_001_000,
            kind: 'assistant',
            text: 'I found the issue',
            thinking: 'I should read the file first',
            toolCall: {
                argumentsText: '{"path":"src/index.ts"}',
                callId: 'call-1',
                name: 'read_file',
                resultText: 'file contents',
                status: 'completed',
            },
        },
    ],
    head: {
        composerId: 'thread-1',
        createdAtMs: 1_700_000_000_000,
        lastUpdatedAtMs: 1_700_000_001_000,
        mode: 'agent',
        name: 'Demo Cursor thread',
        orderedBubbleIds: ['u1', 'a1'],
        totalBubbleHeaders: 2,
    },
    omittedBubbleCount: 0,
    renderableBubbleCount: 2,
});

const buildMultiStepTranscript = (): CursorThreadTranscript => ({
    bubbles: [
        {
            bubbleId: 'u1',
            createdAtMs: 1_700_000_000_000,
            kind: 'user',
            text: 'Fix the UI bug',
            thinking: null,
            toolCall: null,
        },
        {
            bubbleId: 'a1',
            createdAtMs: 1_700_000_001_000,
            kind: 'assistant',
            text: 'I will inspect the component first.',
            thinking: null,
            toolCall: {
                argumentsText: '{"cmd":"sed -n 1,160p apps/ui/src/components/export-dialog.tsx"}',
                callId: 'call-1',
                name: 'exec_command',
                resultText: 'component source',
                status: 'completed',
            },
        },
        {
            bubbleId: 'a2',
            createdAtMs: 1_700_000_002_000,
            kind: 'assistant',
            text: 'Fixed the dialog styling and export behavior.',
            thinking: null,
            toolCall: null,
        },
    ],
    head: {
        composerId: 'thread-1',
        createdAtMs: 1_700_000_000_000,
        lastUpdatedAtMs: 1_700_000_002_000,
        mode: 'agent',
        name: 'Demo Cursor thread',
        orderedBubbleIds: ['u1', 'a1', 'a2'],
        totalBubbleHeaders: 3,
    },
    omittedBubbleCount: 0,
    renderableBubbleCount: 3,
});

describe('cursorTranscriptToThreadEvents', () => {
    it('should return no events for empty transcripts', () => {
        expect(
            cursorTranscriptToThreadEvents({
                bubbles: [],
                head: {
                    composerId: 'empty',
                    createdAtMs: null,
                    lastUpdatedAtMs: null,
                    mode: null,
                    name: null,
                    orderedBubbleIds: [],
                    totalBubbleHeaders: 0,
                },
                omittedBubbleCount: 0,
                renderableBubbleCount: 0,
            }),
        ).toEqual([]);
    });

    it('should classify a single assistant bubble as a final answer', () => {
        const events = cursorTranscriptToThreadEvents({
            bubbles: [
                {
                    bubbleId: 'a1',
                    createdAtMs: 1_700_000_001_000,
                    kind: 'assistant',
                    text: 'Done.',
                    thinking: null,
                    toolCall: null,
                },
            ],
            head: {
                composerId: 'thread-1',
                createdAtMs: 1_700_000_001_000,
                lastUpdatedAtMs: 1_700_000_001_000,
                mode: 'agent',
                name: 'Single bubble',
                orderedBubbleIds: ['a1'],
                totalBubbleHeaders: 1,
            },
            omittedBubbleCount: 0,
            renderableBubbleCount: 1,
        });

        expect(events).toContainEqual(
            expect.objectContaining({ kind: 'message', phase: 'final_answer', role: 'assistant', text: 'Done.' }),
        );
    });

    it('should flush assistant final-answer runs when unknown bubbles appear between assistant messages', () => {
        const events = cursorTranscriptToThreadEvents({
            bubbles: [
                {
                    bubbleId: 'a1',
                    createdAtMs: 1_700_000_001_000,
                    kind: 'assistant',
                    text: 'First completed response.',
                    thinking: null,
                    toolCall: null,
                },
                {
                    bubbleId: 'unknown',
                    createdAtMs: 1_700_000_001_500,
                    kind: 'unknown',
                    text: 'internal event',
                    thinking: null,
                    toolCall: null,
                },
                {
                    bubbleId: 'a2',
                    createdAtMs: 1_700_000_002_000,
                    kind: 'assistant',
                    text: 'Second completed response.',
                    thinking: null,
                    toolCall: null,
                },
            ],
            head: {
                composerId: 'thread-1',
                createdAtMs: 1_700_000_001_000,
                lastUpdatedAtMs: 1_700_000_002_000,
                mode: 'agent',
                name: 'Unknown separator',
                orderedBubbleIds: ['a1', 'unknown', 'a2'],
                totalBubbleHeaders: 3,
            },
            omittedBubbleCount: 0,
            renderableBubbleCount: 3,
        });
        const finalAnswerTexts = events
            .filter(
                (
                    event,
                ): event is Extract<ReturnType<typeof cursorTranscriptToThreadEvents>[number], { kind: 'message' }> =>
                    event.kind === 'message' && event.role === 'assistant' && event.phase === 'final_answer',
            )
            .map((event) => event.text);

        expect(finalAnswerTexts).toEqual(['First completed response.', 'Second completed response.']);
    });

    it('should adapt Cursor bubbles into transcript-view events', () => {
        const events = cursorTranscriptToThreadEvents(buildTranscript());

        expect(events.map((event) => event.kind)).toEqual([
            'message',
            'message',
            'message',
            'tool_call',
            'tool_output',
        ]);
        expect(events[0]).toMatchObject({ kind: 'message', role: 'user', text: 'Please inspect the repo' });
        expect(events[1]).toMatchObject({
            kind: 'message',
            phase: 'commentary',
            role: 'assistant',
            text: 'I should read the file first',
        });
        expect(events[3]).toMatchObject({
            argumentsText: '{"path":"src/index.ts"}',
            callId: 'call-1',
            kind: 'tool_call',
            name: 'read_file',
        });
        expect(events[4]).toMatchObject({ callId: 'call-1', kind: 'tool_output', outputText: 'file contents' });
        expect(events[0]?.raw).toMatchObject({ bubbleId: 'u1', source: 'cursor_bubble' });
    });

    it('should classify Cursor assistant progress as commentary and keep the final answer visible', () => {
        const events = cursorTranscriptToThreadEvents(buildMultiStepTranscript());
        const assistantMessages = events.filter(
            (event) => event.kind === 'message' && event.role === 'assistant' && event.text,
        );

        expect(assistantMessages).toHaveLength(2);
        expect(assistantMessages[0]).toMatchObject({
            phase: 'commentary',
            text: 'I will inspect the component first.',
            variant: 'agent_message',
        });
        expect(assistantMessages[1]).toMatchObject({
            phase: 'final_answer',
            text: 'Fixed the dialog styling and export behavior.',
            variant: 'agent_message',
        });
    });
});

describe('getCursorThreadTranscriptStats', () => {
    it('should count adapted Cursor transcript events for metadata panels', () => {
        const transcript = buildTranscript();
        transcript.bubbles[1]!.toolCall!.name = 'exec_command';
        const stats = getCursorThreadTranscriptStats(cursorTranscriptToThreadEvents(transcript));

        expect(stats).toMatchObject({
            assistantMessageCount: 2,
            commentaryCount: 1,
            execCommandCount: 1,
            finalAnswerCount: 1,
            messageCount: 3,
            toolCallCount: 1,
            toolOutputCount: 1,
            userMessageCount: 1,
        });
    });

    it('should trim adapted Cursor message text', () => {
        const transcript = buildTranscript();
        transcript.bubbles[0]!.text = '  Please inspect the repo  ';

        expect(cursorTranscriptToThreadEvents(transcript)[0]).toMatchObject({ text: 'Please inspect the repo' });
    });
});
