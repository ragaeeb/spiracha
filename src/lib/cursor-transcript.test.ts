import { describe, expect, it } from 'bun:test';
import type { CursorExportOptions, CursorThreadTranscript } from './cursor-exporter-types';
import { renderCursorBubble, renderCursorToolCall, renderCursorTranscript } from './cursor-transcript';

const options = (overrides: Partial<CursorExportOptions> = {}): CursorExportOptions => ({
    includeCommentary: false,
    includeMetadata: true,
    includeTools: false,
    outputFormat: 'md',
    ...overrides,
});

const buildTranscript = (overrides: Partial<CursorThreadTranscript> = {}): CursorThreadTranscript => ({
    bubbles: [
        {
            bubbleId: 'b1',
            createdAtMs: null,
            kind: 'user',
            text: 'Please fix the bug',
            thinking: null,
            toolCall: null,
        },
        {
            bubbleId: 'b2',
            createdAtMs: null,
            kind: 'assistant',
            text: 'Here is the fix',
            thinking: 'I should inspect the file first',
            toolCall: {
                argumentsText: '{"path":"src/index.ts"}',
                callId: 'call-1',
                name: 'read_file',
                resultText: 'export const x = 1;',
                status: 'completed',
            },
        },
    ],
    head: {
        composerId: 'thread-1',
        createdAtMs: 1000,
        lastUpdatedAtMs: 2000,
        mode: 'agent',
        name: 'Bug fix thread',
        orderedBubbleIds: ['b1', 'b2'],
        totalBubbleHeaders: 2,
    },
    omittedBubbleCount: 0,
    renderableBubbleCount: 2,
    ...overrides,
});

describe('renderCursorBubble', () => {
    it('should render a user bubble as a User section', () => {
        const [block] = renderCursorBubble(buildTranscript().bubbles[0]!, options());
        expect(block).toContain('## User');
        expect(block).toContain('Please fix the bug');
    });

    it('should omit reasoning unless commentary is enabled', () => {
        const blocks = renderCursorBubble(buildTranscript().bubbles[1]!, options());
        expect(blocks.join('\n')).not.toContain('## Reasoning');
    });

    it('should include reasoning when commentary is enabled', () => {
        const blocks = renderCursorBubble(buildTranscript().bubbles[1]!, options({ includeCommentary: true }));
        expect(blocks.join('\n')).toContain('## Reasoning');
        expect(blocks.join('\n')).toContain('inspect the file first');
    });

    it('should omit tool calls unless tools are enabled', () => {
        const blocks = renderCursorBubble(buildTranscript().bubbles[1]!, options());
        expect(blocks.join('\n')).not.toContain('Tool Call');
    });

    it('should not render unknown bubbles as assistant messages', () => {
        const blocks = renderCursorBubble(
            {
                bubbleId: 'unknown-1',
                createdAtMs: null,
                kind: 'unknown',
                text: 'internal cursor payload',
                thinking: null,
                toolCall: null,
            },
            options(),
        );

        expect(blocks).toEqual([]);
    });
});

describe('renderCursorToolCall', () => {
    it('should render name, arguments, and result', () => {
        const block = renderCursorToolCall(buildTranscript().bubbles[1]!.toolCall!, 'md');
        expect(block).toContain('Tool Call');
        expect(block).toContain('read_file');
        expect(block).toContain('Call ID: call-1');
        expect(block).toContain('src/index.ts');
        expect(block).toContain('export const x = 1;');
    });
});

describe('renderCursorTranscript', () => {
    it('should render a full transcript with metadata header', () => {
        const content = renderCursorTranscript(
            buildTranscript(),
            options({ includeCommentary: true, includeTools: true }),
        );
        expect(content).toContain('# Bug fix thread');
        expect(content).toContain('exported_from: "cursor_global_storage_bubbles"');
        expect(content).toContain('## User');
        expect(content).toContain('## Reasoning');
        expect(content).toContain('## Assistant');
        expect(content).toContain('Tool Call');
    });

    it('should include a truncation note when messages were omitted', () => {
        const content = renderCursorTranscript(buildTranscript({ omittedBubbleCount: 2579 }), options());
        expect(content).toContain('## Note');
        expect(content).toContain('most recent');
    });

    it('should return null when there is nothing renderable', () => {
        const content = renderCursorTranscript(buildTranscript({ bubbles: [] }), options());
        expect(content).toBeNull();
    });

    it('should omit invalid timestamp metadata instead of throwing', () => {
        const transcript = buildTranscript({
            head: {
                ...buildTranscript().head,
                createdAtMs: Number.POSITIVE_INFINITY,
                lastUpdatedAtMs: 9_000_000_000_000_000,
            },
        });

        const content = renderCursorTranscript(transcript, options());

        expect(content).toContain('created_at_unix_ms: Infinity');
        expect(content).not.toContain('created_at_iso');
        expect(content).not.toContain('last_updated_at_iso');
    });

    it('should omit intermediate assistant progress when commentary is disabled', () => {
        const transcript = buildTranscript({
            bubbles: [
                buildTranscript().bubbles[0]!,
                {
                    ...buildTranscript().bubbles[1]!,
                    text: 'I will inspect the component first.',
                },
                {
                    bubbleId: 'b3',
                    createdAtMs: null,
                    kind: 'assistant',
                    text: 'Fixed the dialog styling and export behavior.',
                    thinking: null,
                    toolCall: null,
                },
            ],
        });

        const content = renderCursorTranscript(transcript, options({ includeCommentary: false }));

        expect(content).not.toContain('I will inspect the component first.');
        expect(content).toContain('Fixed the dialog styling and export behavior.');
    });
});
