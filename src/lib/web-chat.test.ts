import { describe, expect, it } from 'bun:test';
import type { ThreadEvent } from './codex-browser-types';
import { parseWebChatFiles } from './web-chat';

const isAssistantMessage = (event: ThreadEvent): event is Extract<ThreadEvent, { kind: 'message' }> =>
    event.kind === 'message' && event.role === 'assistant';

const createMappingExport = (input: {
    assistantMetadata?: Record<string, unknown>;
    conversationId: string;
    model: string;
    title: string;
}) => ({
    conversation_id: input.conversationId,
    create_time: 1_700_000_000,
    current_node: 'assistant',
    default_model_slug: input.model,
    mapping: {
        assistant: {
            children: [],
            id: 'assistant',
            message: {
                author: { role: 'assistant' },
                content: { content_type: 'text', parts: ['Answer'] },
                create_time: 1_700_000_001,
                id: 'assistant-message',
                metadata: input.assistantMetadata ?? {},
            },
            parent: 'user',
        },
        root: { children: ['user'], id: 'root', message: null, parent: null },
        user: {
            children: ['assistant'],
            id: 'user',
            message: {
                author: { role: 'user' },
                content: { content_type: 'text', parts: ['Question'] },
                create_time: 1_700_000_000,
                id: 'user-message',
                metadata: {},
            },
            parent: 'root',
        },
    },
    title: input.title,
    update_time: 1_700_000_001,
});

describe('parseWebChatFiles', () => {
    it('should infer the attached mapping export providers at runtime', () => {
        const cases = [
            { assistantMetadata: { grok_mode: 'deepsearch' }, expected: 'Grok', model: 'Normal' },
            { expected: 'Gemini', model: 'gemini-3.1-pro-extended' },
            { assistantMetadata: { qwen_model: 'qwen3.8-max' }, expected: 'Qwen', model: 'qwen3.8-max' },
            { expected: 'Claude', model: 'claude-sonnet-5' },
            { expected: 'ChatGPT', model: 'gpt-5-6-pro' },
        ];

        for (const [index, testCase] of cases.entries()) {
            const result = parseWebChatFiles([
                {
                    content: JSON.stringify(
                        createMappingExport({
                            assistantMetadata: testCase.assistantMetadata,
                            conversationId: `conversation-${index}`,
                            model: testCase.model,
                            title: `${testCase.expected} research`,
                        }),
                    ),
                    name: `${testCase.expected.toLowerCase()}.json`,
                },
            ]);

            expect(result.errors).toEqual([]);
            expect(result.conversations).toHaveLength(1);
            const conversation = result.conversations[0]!;
            expect(conversation.platform).toBe(testCase.expected);
            expect(conversation.sourceConversationId).toBe(`conversation-${index}`);
            expect(conversation.events.filter((event) => event.kind === 'message').map((event) => event.text)).toEqual([
                'Question',
                'Answer',
            ]);
        }
    });

    it('should follow the selected mapping branch and preserve reasoning separately', () => {
        const base = createMappingExport({
            conversationId: 'branching-chat',
            model: 'gemini-3-pro',
            title: 'Branching chat',
        });
        const input = {
            ...base,
            mapping: {
                ...base.mapping,
                assistant: {
                    ...base.mapping.assistant,
                    message: {
                        ...base.mapping.assistant.message,
                        content: {
                            content_type: 'thoughts',
                            parts: [{ text: 'Final answer', type: 'text' }],
                            thoughts: [{ content: 'Private reasoning' }],
                        },
                    },
                },
                other: {
                    children: [],
                    id: 'other',
                    message: {
                        author: { role: 'assistant' },
                        content: { content_type: 'text', parts: ['Unselected answer'] },
                        create_time: 1_700_000_002,
                        id: 'other-message',
                        metadata: {},
                    },
                    parent: 'user',
                },
                user: { ...base.mapping.user, children: [...base.mapping.user.children, 'other'] },
            },
        };

        const result = parseWebChatFiles([{ content: JSON.stringify(input), name: 'branch.json' }]);
        const events = result.conversations[0]!.events;

        expect(events.map((event) => event.kind)).toEqual(['message', 'reasoning', 'message']);
        expect(events[1]).toMatchObject({ kind: 'reasoning', summary: ['Private reasoning'] });
        expect(events[2]).toMatchObject({ kind: 'message', text: 'Final answer' });
    });

    it('should prefer content provider hints over a misleading file name', () => {
        const input = createMappingExport({
            conversationId: 'misnamed-chat',
            model: 'gpt-5',
            title: 'Misnamed chat',
        });
        input.mapping.assistant.message.content = {
            content_type: 'reasoning_recap',
            parts: ['Reasoning stored in parts'],
        };

        const result = parseWebChatFiles([{ content: JSON.stringify(input), name: 'claude-export.json' }]);

        expect(result.conversations[0]!.platform).toBe('ChatGPT');
        expect(result.conversations[0]!.events.map((event) => event.kind)).toEqual(['message', 'reasoning']);
        expect(result.conversations[0]!.events[1]).toMatchObject({
            kind: 'reasoning',
            summary: ['Reasoning stored in parts'],
        });
    });

    it('should parse native Claude and Grok exports from one multi-file import', () => {
        const claude = {
            chat_messages: [
                {
                    content: [{ text: 'Claude question', type: 'text' }],
                    created_at: '2026-08-30T10:00:00Z',
                    sender: 'human',
                    uuid: 'c1',
                },
                {
                    content: [
                        { summaries: [{ summary: 'Claude reasoning' }], thinking: '', type: 'thinking' },
                        { text: 'Claude answer', type: 'text' },
                    ],
                    created_at: '2026-08-30T10:00:01Z',
                    sender: 'assistant',
                    uuid: 'c2',
                },
            ],
            created_at: '2026-08-30T10:00:00Z',
            model: 'claude-sonnet-4',
            name: 'Claude native',
            updated_at: '2026-08-30T10:00:01Z',
            uuid: 'claude-native',
        };
        const grok = {
            conversation: {
                create_time: '2026-08-30T11:00:00Z',
                id: 'grok-native',
                modify_time: '2026-08-30T11:00:01Z',
                title: 'Grok native',
            },
            responses: [
                { response: { _id: 'g1', message: 'Grok question', sender: 'human' } },
                {
                    response: {
                        _id: 'g2',
                        agent_thinking_traces: [{ thinking_trace: 'Grok reasoning' }],
                        message: 'Grok answer',
                        metadata: { request_metadata: { model: 'grok-4' } },
                        sender: 'assistant',
                    },
                },
            ],
        };

        const result = parseWebChatFiles([
            { content: JSON.stringify(claude), name: 'claude.json' },
            { content: JSON.stringify(grok), name: 'grok.json' },
        ]);

        expect(result.errors).toEqual([]);
        expect(result.conversations.map((conversation) => conversation.platform)).toEqual(['Claude', 'Grok']);
        expect(result.conversations.map((conversation) => conversation.events.length)).toEqual([3, 3]);
        expect(
            result.conversations.map((conversation) => conversation.events.findLast(isAssistantMessage)?.phase),
        ).toEqual(['final_answer', 'final_answer']);
    });

    it('should split arrays of conversations and parse generic GLM role-content messages', () => {
        const first = createMappingExport({
            conversationId: 'first',
            model: 'gpt-5',
            title: 'First',
        });
        const second = {
            id: 'second',
            messages: [
                { content: 'GLM question', role: 'user' },
                { content: 'GLM answer', model: 'glm-4.6', reasoning: 'GLM reasoning', role: 'assistant' },
            ],
            title: 'Second',
        };

        const result = parseWebChatFiles([{ content: JSON.stringify([first, second]), name: 'many.json' }]);

        expect(result.errors).toEqual([]);
        expect(result.conversations).toHaveLength(2);
        expect(result.conversations[1]).toMatchObject({ platform: 'GLM', sourceConversationId: 'second' });
        expect(result.conversations[1]!.events.map((event) => event.kind)).toEqual(['message', 'reasoning', 'message']);
        expect(result.conversations[1]!.events.at(-1)).toMatchObject({ phase: 'final_answer' });
    });

    it('should keep valid files when another file is invalid', () => {
        const valid = createMappingExport({
            conversationId: 'valid',
            model: 'gpt-5',
            title: 'Valid',
        });
        const result = parseWebChatFiles([
            { content: JSON.stringify(valid), name: 'valid.json' },
            { content: '{not json', name: 'broken.json' },
            { content: JSON.stringify({ unrelated: true }), name: 'unknown.json' },
        ]);

        expect(result.conversations).toHaveLength(1);
        expect(result.errors).toEqual([
            { fileName: 'broken.json', message: 'File is not valid JSON.' },
            { fileName: 'unknown.json', message: 'No supported web conversation was found.' },
        ]);
    });

    it('should classify ChatGPT progress as commentary and tool traffic as tools', () => {
        const mapping = {
            final: {
                children: [],
                message: {
                    author: { role: 'assistant' },
                    content: { content_type: 'text', parts: ['# Research report completed'] },
                    end_turn: true,
                },
                parent: 'progress-2',
            },
            progress: {
                children: ['tool-call'],
                message: {
                    author: { role: 'assistant' },
                    content: { content_type: 'text', parts: ['I am checking primary sources.'] },
                    end_turn: true,
                    recipient: 'all',
                },
                parent: 'user',
            },
            'progress-2': {
                children: ['final'],
                message: {
                    author: { role: 'assistant' },
                    content: { content_type: 'text', parts: ['The policy now parses as YAML with ordered priority.'] },
                    end_turn: true,
                    recipient: 'all',
                },
                parent: 'tool-output',
            },
            'tool-call': {
                children: ['tool-output'],
                message: {
                    author: { role: 'assistant' },
                    content: { content_type: 'code', text: '{"search_query":[{"q":"primary source"}]}' },
                    recipient: 'web.run',
                },
                parent: 'progress',
            },
            'tool-output': {
                children: ['progress-2'],
                message: {
                    author: { role: 'tool' },
                    content: { content_type: 'text', parts: ['Search results'] },
                },
                parent: 'tool-call',
            },
            user: {
                children: ['progress'],
                message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['Research this'] } },
                parent: null,
            },
        };

        const result = parseWebChatFiles([
            {
                content: JSON.stringify({ conversation_id: 'research', current_node: 'final', mapping }),
                name: 'research.json',
            },
        ]);
        const events = result.conversations[0]!.events;

        expect(events.filter(isAssistantMessage).map((event) => ({ phase: event.phase, text: event.text }))).toEqual([
            { phase: 'commentary', text: 'I am checking primary sources.' },
            { phase: 'commentary', text: 'The policy now parses as YAML with ordered priority.' },
            { phase: 'final_answer', text: '# Research report completed' },
        ]);
        expect(events.filter((event) => event.kind === 'tool_call')).toHaveLength(1);
        expect(events.filter((event) => event.kind === 'tool_output')).toHaveLength(1);
    });

    it('should extract a completed ChatGPT deep-research report from widget state', () => {
        const reportMessage = {
            author: { role: 'assistant' },
            content: {
                content_type: 'text',
                parts: ['# Deep Research Assignment\n\n## Executive synthesis\n\nThe report body.'],
            },
            metadata: { model_slug: 'gpt-5-6-pro' },
        };
        const mapping = {
            launcher: {
                children: ['result'],
                message: {
                    author: { role: 'assistant' },
                    content: { content_type: 'code', text: '{"path":"/Deep Research App/start"}' },
                    recipient: 'api_tool.call_tool',
                },
                parent: 'user',
            },
            result: {
                children: [],
                message: {
                    author: { role: 'tool' },
                    content: { content_type: 'code', text: '{"session_id":"deep-session"}' },
                    metadata: {
                        chatgpt_sdk: {
                            widget_state: JSON.stringify({ report_message: reportMessage, status: 'completed' }),
                        },
                    },
                },
                parent: 'launcher',
            },
            user: {
                children: ['launcher'],
                message: {
                    author: { role: 'user' },
                    content: { content_type: 'text', parts: ['@Deep research Research this'] },
                },
                parent: null,
            },
        };

        const result = parseWebChatFiles([
            {
                content: JSON.stringify({
                    conversation_id: 'deep-research',
                    current_node: 'result',
                    default_model_slug: 'gpt-5-6-pro',
                    mapping,
                }),
                name: 'deep-research.json',
            },
        ]);
        const conversation = result.conversations[0]!;

        expect(conversation.messageCount).toBe(2);
        expect(conversation.events.at(-1)).toMatchObject({
            kind: 'message',
            phase: 'final_answer',
            role: 'assistant',
            text: '# Deep Research Assignment\n\n## Executive synthesis\n\nThe report body.',
        });
    });
});
