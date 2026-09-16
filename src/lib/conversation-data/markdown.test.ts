import { describe, expect, it } from 'bun:test';
import { toCanonicalMessage } from './adapter-helpers';
import { renderConversationMarkdown } from './markdown';
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

describe('normalized Markdown export contract', () => {
    it('should render all roles with one terminal newline and a deterministic fallback title', () => {
        const messages = [
            message({ id: 'system', order: 0, phase: 'unknown', role: 'system', text: 'system body' }),
            message({ id: 'user', order: 1, phase: 'unknown', role: 'user', text: 'user body' }),
            message({ id: 'assistant', order: 2, text: 'assistant body' }),
            message({ id: 'tool', order: 3, phase: 'tool_output', role: 'tool', text: 'tool body' }),
            message({ id: 'unknown', order: 4, phase: 'unknown', role: 'unknown', text: 'unknown body' }),
        ];
        expect(renderConversationMarkdown({ messages, title: '   ' })).toBe(
            '# Conversation\n\n## System\n\nsystem body\n\n## User\n\nuser body\n\n' +
                '## Assistant · Final answer\n\nassistant body\n\n## Tool output\n\ntool body\n\n## Unknown\n\nunknown body\n',
        );
    });

    it('should preserve Markdown code fences, Unicode and internal line breaks without reserialization', () => {
        const text = 'Before\n\n```json\n{"emoji":"🔥", "path":"C:\\\\repo"}\n```\n\nAfter';
        const conversation = { messages: [message({ text })], title: '  Exact export  ' };
        const before = structuredClone(conversation);
        expect(renderConversationMarkdown(conversation)).toBe(
            `# Exact export\n\n## Assistant · Final answer\n\n${text}\n`,
        );
        expect(conversation).toEqual(before);
        expect(renderConversationMarkdown(conversation)).toBe(renderConversationMarkdown(conversation));
    });

    it('should use a message model before the conversation model', () => {
        const markdown = renderConversationMarkdown({
            messages: [message({ model: 'openai/gpt-5' }), message({ id: 'fallback', order: 1 })],
            model: 'anthropic/claude-sonnet-4-5',
            title: null,
        });
        expect(markdown).toContain('## Assistant · Final answer · GPT 5');
        expect(markdown).toContain('## Assistant · Final answer · Claude Sonnet 4.5');
    });

    it('should not silently substitute commentary when no final answer exists', () => {
        const conversation = { messages: [message({ phase: 'commentary' })], title: 'No final' };
        expect(renderConversationMarkdown(conversation, { messageSelector: 'last_final_answer' })).toBe(
            '# No final\n\n_No messages selected._\n',
        );
        expect(renderConversationMarkdown(conversation, { messageSelector: 'last_assistant' })).toContain('Answer');
    });

    it('should select the greatest message order rather than the last array position', () => {
        const conversation = {
            messages: [message({ order: 9, text: 'Latest' }), message({ id: 'older', order: 1, text: 'Earlier' })],
            title: 'Selected',
        };
        const markdown = renderConversationMarkdown(conversation, { messageSelector: 'last_final_answer' });
        expect(markdown).toContain('Latest');
        expect(markdown).not.toContain('Earlier');
    });

    it('should keep an empty selected body instead of substituting placeholder copy', () => {
        expect(renderConversationMarkdown({ messages: [], title: null })).toContain('_No messages selected._');
        expect(renderConversationMarkdown({ messages: [message({ text: ' \n ' })], title: null })).toBe(
            '# Conversation\n\n## Assistant · Final answer\n\n \n \n',
        );
    });
});
