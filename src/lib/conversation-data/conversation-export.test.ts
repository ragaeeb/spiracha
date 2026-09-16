import { describe, expect, it } from 'bun:test';
import { toCanonicalMessage } from './adapter-helpers';
import { renderNormalizedExport, renderSelectedTranscriptExport, selectExportMessages } from './conversation-export';
import { CONVERSATION_ONLY_EXPORT_INCLUDE, expandNormalizedExportOptions } from './export-options';
import { IncompleteTranscriptError } from './operation-types';
import type { ConversationMessage } from './types';

const message = (overrides: Partial<ConversationMessage> = {}): ConversationMessage =>
    toCanonicalMessage({
        createdAtMs: null,
        id: 'message',
        metadata: {},
        order: 0,
        phase: 'final_answer',
        role: 'assistant',
        text: 'Answer',
        toolEvidence: null,
        ...overrides,
    });

describe('normalized conversation export', () => {
    it('should apply the message selector before independent include flags', () => {
        const conversation = {
            messages: [
                message({ id: 'user', order: 0, phase: 'unknown', role: 'user', text: 'Ask' }),
                message({ id: 'note', order: 1, phase: 'commentary', text: 'Working' }),
                message({ id: 'final', order: 2, text: 'Done' }),
            ],
            title: 'Review',
        };
        const selectedThenFiltered = selectExportMessages(
            conversation,
            expandNormalizedExportOptions({
                include: CONVERSATION_ONLY_EXPORT_INCLUDE,
                messageSelector: 'all',
            }),
        );
        expect(selectedThenFiltered.map((entry) => entry.id)).toEqual(['user', 'final']);
        expect(
            renderNormalizedExport(conversation, {
                include: CONVERSATION_ONLY_EXPORT_INCLUDE,
                messageSelector: 'last_final_answer',
            }),
        ).toBe('# Review\n\n## Assistant · Final answer\n\nDone\n');
    });

    it('should keep empty observed bodies and empty tool outputs without backfill', () => {
        const markdown = renderNormalizedExport({
            messages: [
                message({ id: 'user', order: 0, phase: 'unknown', role: 'user', text: '  keep  \n' }),
                message({
                    id: 'tool',
                    order: 1,
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
                        namespace: null,
                        outputText: '',
                        status: 'succeeded',
                        workdir: null,
                    },
                }),
            ],
            title: 'Empty tool',
        });
        expect(markdown).toBe(
            '# Empty tool\n\n## User\n\n  keep  \n\n## Tool output\n\nTool: exec\nCall ID: call-1\nStatus: succeeded\nExit code: 0\n',
        );
        expect(markdown).not.toContain('_No message content._');
    });

    it('should keep commentary, reasoning, and tools independent and omit bootstrap by default', () => {
        const markdown = renderNormalizedExport(
            {
                messages: [
                    message({
                        id: 'boot',
                        order: 0,
                        phase: 'unknown',
                        role: 'system',
                        text: 'bootstrap',
                        visibility: 'bootstrap',
                    }),
                    message({ id: 'think', order: 1, phase: 'reasoning', text: 'plan' }),
                    message({ id: 'note', order: 2, phase: 'commentary', text: 'status' }),
                    message({ id: 'final', order: 3, text: 'done' }),
                ],
                title: 'Flags',
            },
            { includeCommentary: false },
        );
        expect(markdown).toContain('## Reasoning');
        expect(markdown).toContain('plan');
        expect(markdown).not.toContain('status');
        expect(markdown).not.toContain('bootstrap');
        expect(markdown).toContain('done');
    });

    it('should append artifacts after selector filtering', () => {
        const markdown = renderNormalizedExport(
            {
                artifacts: [{ content: 'full artifact body', id: 'art-1', title: 'notes.md' }],
                messages: [
                    message({ id: 'user', order: 0, phase: 'unknown', role: 'user', text: 'Ask' }),
                    message({ id: 'final', order: 1, text: 'Done' }),
                ],
                title: 'With artifact',
            },
            { include: CONVERSATION_ONLY_EXPORT_INCLUDE, messageSelector: 'last_final_answer' },
        );
        expect(markdown).toContain('## Assistant · Final answer');
        expect(markdown).not.toContain('Ask');
        expect(markdown).toContain('## Artifact · notes.md');
        expect(markdown).toContain('full artifact body');
    });

    it('should reject selected or partial bodies when require_available_full is set', () => {
        expect(() =>
            renderNormalizedExport(
                {
                    bodyAvailability: 'selected',
                    messages: [message()],
                    title: 'List row',
                },
                { completeness: 'require_available_full' },
            ),
        ).toThrow(IncompleteTranscriptError);
        expect(() =>
            renderNormalizedExport(
                {
                    messages: [
                        message({
                            contentState: {
                                availableCharacters: 4,
                                reason: 'preview',
                                state: 'partial',
                                totalCharacters: 40,
                            },
                            text: 'prev',
                        }),
                    ],
                    title: 'Partial',
                },
                { completeness: 'require_available_full' },
            ),
        ).toThrow(IncompleteTranscriptError);
    });

    it('should prefer a source-provided author name in assistant headings', () => {
        expect(
            renderNormalizedExport({
                messages: [message({ metadata: { authorName: 'Kiwi' }, text: 'Answer' })],
                title: 'Chat',
            }),
        ).toBe('# Chat\n\n## Kiwi\n\nAnswer\n');
    });

    it('should return null when a compact transcript export has no selected messages', () => {
        expect(
            renderSelectedTranscriptExport(
                {
                    messages: [message({ phase: 'commentary', text: 'Working' })],
                    title: 'Notes',
                },
                { includeCommentary: false },
            ),
        ).toBeNull();
    });
});
