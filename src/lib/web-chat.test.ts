import { describe, expect, it } from 'bun:test';
import type { ThreadEvent } from './codex-browser-types';
import { parseWebChatFiles } from './web-chat';

const isAssistantMessage = (event: ThreadEvent): event is Extract<ThreadEvent, { kind: 'message' }> =>
    event.kind === 'message' && event.role === 'assistant';

const getToolCalls = (events: ThreadEvent[]) => events.filter((event) => event.kind === 'tool_call');
const getToolOutputs = (events: ThreadEvent[]) => events.filter((event) => event.kind === 'tool_output');

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
            metadata: { resolved_model_slug: 'gpt-5-thinking' },
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
                        default_model_slug: 'gpt-5-6-pro',
                        model_slug: 'gpt-5-6-instant',
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
        expect(conversation.model).toBe('gpt-5-6-instant');
        expect(conversation.events.at(-1)).toMatchObject({
            kind: 'message',
            model: 'gpt-5-6-instant',
            phase: 'final_answer',
            role: 'assistant',
            text: '# Deep Research Assignment\n\n## Executive synthesis\n\nThe report body.',
        });
    });

    it('should expose attached Grok deep-search browsing as tool calls', () => {
        const input = {
            conversation: { id: 'grok-research', title: 'Grok research' },
            raw_payload: {
                data: {
                    grok_conversation_items_by_rest_id: {
                        items: [
                            {
                                deepsearch_headers: [
                                    {
                                        steps: [
                                            {
                                                tool_usage_card:
                                                    '<xai:tool_usage_card><xai:tool_usage_card_id>grok-call</xai:tool_usage_card_id><xai:tool_name>web_search</xai:tool_name><xai:tool_args><![CDATA[{"query":"CodeRabbit pricing"}]]></xai:tool_args></xai:tool_usage_card>',
                                                tool_usage_card_results: [
                                                    { message: 'Searching the web', tool_usage_card_id: 'grok-call' },
                                                    {
                                                        tool_usage_card_id: 'grok-call',
                                                        web_results: [
                                                            {
                                                                snippet:
                                                                    '* stale suppressions are removed instead of carried forward',
                                                                title: 'fallow/docs/fallow-compliance.md at main · fallow-rs/fallow · GitHub',
                                                                url: 'https://github.com/fallow-rs/fallow/blob/main/docs/fallow-compliance.md',
                                                            },
                                                            {
                                                                snippet: 'Requires review-comments: true',
                                                                title: 'fallow: codebase intelligence for TypeScript and JavaScript',
                                                                url: 'https://docs.fallow.tools/integrations/ci',
                                                            },
                                                            {
                                                                snippet:
                                                                    'Both shapes route to the same rule ids as function findings',
                                                                title: 'fallow: codebase intelligence for TypeScript and JavaScript',
                                                                url: 'https://docs.fallow.tools/explanations/health',
                                                            },
                                                            {
                                                                snippet: 'A compact health score for the current state',
                                                                title: 'GitHub - fallow-rs/fallow at v2.82.0 · GitHub',
                                                                url: 'https://github.com/fallow-rs/fallow/tree/v2.82.0',
                                                            },
                                                        ],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
            responses: [
                { response: { message: 'Research this', sender: 'human' } },
                { response: { message: 'Research complete', sender: 'assistant' } },
            ],
        };

        const events = parseWebChatFiles([{ content: JSON.stringify(input), name: 'grok.json' }]).conversations[0]!
            .events;

        expect(getToolCalls(events)).toEqual([
            expect.objectContaining({
                argumentsText: '{"query":"CodeRabbit pricing"}',
                callId: 'grok-call',
                command: 'CodeRabbit pricing',
                name: 'web_search',
            }),
        ]);
        const outputs = getToolOutputs(events);
        expect(outputs).toHaveLength(1);
        expect(outputs[0]).toMatchObject({ callId: 'grok-call' });
        for (const url of [
            'https://github.com/fallow-rs/fallow/blob/main/docs/fallow-compliance.md',
            'https://docs.fallow.tools/integrations/ci',
            'https://docs.fallow.tools/explanations/health',
            'https://github.com/fallow-rs/fallow/tree/v2.82.0',
        ]) {
            expect(outputs[0]?.outputText).toContain(url);
        }
    });

    it('should expose attached Gemini research sources as tool calls', () => {
        const input = {
            ...createMappingExport({
                conversationId: 'gemini-research',
                model: 'gemini-3.1-pro-extended',
                title: 'Gemini research',
            }),
            raw_payload: [
                [
                    'Researching websites...',
                    [
                        'https://www.gstatic.com/favicon/v2/client=SOCIAL',
                        'http://googleusercontent.com/immersive_entry_chip/0',
                        'https://example.com/source',
                    ],
                ],
            ],
        };

        const events = parseWebChatFiles([{ content: JSON.stringify(input), name: 'gemini.json' }]).conversations[0]!
            .events;

        expect(getToolCalls(events)).toEqual([
            expect.objectContaining({
                argumentsText: '{"url":"https://example.com/source"}',
                command: 'https://example.com/source',
                name: 'browse_page',
            }),
        ]);

        const ordinary = { ...input, conversation_id: 'gemini-ordinary', raw_payload: ['https://example.com/link'] };
        const ordinaryEvents = parseWebChatFiles([{ content: JSON.stringify(ordinary), name: 'gemini.json' }])
            .conversations[0]!.events;
        expect(getToolCalls(ordinaryEvents)).toEqual([]);
    });

    it('should expose attached Qwen deep-research queries as tool calls', () => {
        const input = {
            ...createMappingExport({
                assistantMetadata: { qwen_model: 'qwen3.8-max' },
                conversationId: 'qwen-research',
                model: 'qwen3.8-max',
                title: 'Qwen research',
            }),
            raw_payload: {
                data: {
                    chat: {
                        history: {
                            messages: {
                                assistant: {
                                    content_list: [
                                        {
                                            extra: {
                                                deep_research: [
                                                    {
                                                        query: 'Commercial AI code-review products architecture',
                                                        webSites: [
                                                            {
                                                                description:
                                                                    'Sometimes things can be chaotic and line changes need reorganizing.',
                                                                title: 'Is there a way to move lines to other commits? : r/git',
                                                                url: 'https://www.reddit.com/r/git/comments/1r9oz12/is_there_a_way_to_move_lines_to_other_commits/',
                                                            },
                                                            {
                                                                description:
                                                                    'Git rebase moves feature branch histories to the head of main.',
                                                                title: 'Do you know how git rebase works?',
                                                                url: 'https://www.facebook.com/groups/fluttervn/posts/2015778435625251/',
                                                            },
                                                        ],
                                                    },
                                                ],
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    },
                },
            },
        };

        const events = parseWebChatFiles([{ content: JSON.stringify(input), name: 'qwen.json' }]).conversations[0]!
            .events;

        const calls = getToolCalls(events);
        expect(calls).toEqual([
            expect.objectContaining({
                command: 'Commercial AI code-review products architecture',
                name: 'web_search',
            }),
        ]);
        expect(calls[0]?.callId).not.toBeNull();
        const outputs = getToolOutputs(events);
        expect(outputs).toHaveLength(1);
        expect(outputs[0]?.callId).toBe(calls[0]?.callId);
        expect(outputs[0]?.outputText).toContain(
            'https://www.reddit.com/r/git/comments/1r9oz12/is_there_a_way_to_move_lines_to_other_commits/',
        );
        expect(outputs[0]?.outputText).toContain('https://www.facebook.com/groups/fluttervn/posts/2015778435625251/');
        expect(outputs[0]?.outputText).toContain('Git rebase moves feature branch histories to the head of main.');
    });

    it('should expose Amazon Nova deep-research browsing with paired search results', () => {
        const input = {
            ...createMappingExport({
                conversationId: 'nova-research',
                model: 'NOVA_PRO_DEEP_RESEARCH_REASONING_FINE_TUNED',
                title: 'Amazon Nova Conversation',
            }),
            raw_payload: {
                conversationInteractions: [
                    {
                        interactionId: 'nova-interaction',
                        messages: [
                            {
                                content: [
                                    {
                                        reasoningBlocks: [
                                            {
                                                index: 1,
                                                text: '🔍  Searching for: "SARIF fingerprint algorithm", "Git patch-id"',
                                            },
                                            {
                                                index: 2,
                                                text: '🌎  Navigating to: [GitHub](https://github.com/github/codeql-action/blob/main/src/fingerprints.ts)',
                                            },
                                            {
                                                index: 3,
                                                text: '🔍  Retrieved results: [OASIS SARIF](https://docs.oasis-open.org/sarif/sarif/v2.1.0/), [Git patch-id](https://git-scm.com/docs/git-patch-id)',
                                            },
                                        ],
                                        text: 'Answer',
                                    },
                                ],
                                role: 'assistant',
                            },
                        ],
                        modelLookupName: 'NOVA_PRO_DEEP_RESEARCH_REASONING_FINE_TUNED',
                        platform: 'Bedrock',
                    },
                ],
            },
        };

        const conversation = parseWebChatFiles([
            { content: JSON.stringify(input), name: 'Amazon_Nova_Conversation.json' },
        ]).conversations[0]!;
        const calls = getToolCalls(conversation.events);
        const outputs = getToolOutputs(conversation.events);

        expect(conversation.platform).toBe('Amazon Nova');
        expect(conversation.model).toBe('NOVA_PRO_DEEP_RESEARCH_REASONING_FINE_TUNED');
        expect(calls).toEqual([
            expect.objectContaining({
                callId: 'nova-interaction:web-search:0',
                command: '"SARIF fingerprint algorithm", "Git patch-id"',
                name: 'web_search',
            }),
            expect.objectContaining({
                command: 'https://github.com/github/codeql-action/blob/main/src/fingerprints.ts',
                name: 'browse_page',
            }),
        ]);
        expect(outputs).toEqual([
            expect.objectContaining({
                callId: 'nova-interaction:web-search:0',
                outputText: expect.stringContaining('https://docs.oasis-open.org/sarif/sarif/v2.1.0/'),
            }),
        ]);
        expect(outputs[0]?.outputText).toContain('https://git-scm.com/docs/git-patch-id');
    });

    it('should expose attached Claude web-search and fetch blocks as tool calls', () => {
        const input = createMappingExport({
            conversationId: 'claude-research',
            model: 'claude-sonnet-5',
            title: 'Claude research',
        });
        Object.assign(input.mapping.assistant.message, {
            content: {
                content_type: 'text',
                parts: [
                    {
                        id: 'search-call',
                        input: { query: 'CodeRabbit pricing 2026' },
                        name: 'web_search',
                        type: 'tool_use',
                    },
                    {
                        id: 'fetch-call',
                        input: { url: 'https://www.coderabbit.ai/pricing' },
                        name: 'web_fetch',
                        type: 'tool_use',
                    },
                    { text: 'Answer', type: 'text' },
                ],
            },
        });

        const events = parseWebChatFiles([{ content: JSON.stringify(input), name: 'claude.json' }]).conversations[0]!
            .events;

        expect(getToolCalls(events)).toEqual([
            expect.objectContaining({ callId: 'search-call', command: 'CodeRabbit pricing 2026', name: 'web_search' }),
            expect.objectContaining({
                callId: 'fetch-call',
                command: 'https://www.coderabbit.ai/pricing',
                name: 'web_fetch',
            }),
        ]);
    });

    it('should expose every attached Claude web-search result under tool calls', () => {
        const input = createMappingExport({
            conversationId: 'claude-search-results',
            model: 'claude-sonnet-5',
            title: 'Claude search results',
        });
        Object.assign(input.mapping.assistant.message, {
            content: {
                content_type: 'text',
                parts: [
                    {
                        id: 'semgrep-search',
                        input: { query: 'Semgrep 2026 pricing free tier AppSec platform status' },
                        name: 'web_search',
                        type: 'tool_use',
                    },
                    {
                        content: [
                            {
                                title: 'Semgrep Pricing in 2026: Open Source vs Team vs Enterprise Costs - DEV Community',
                                type: 'knowledge',
                                url: 'https://dev.to/rahulxsingh/semgrep-pricing-in-2026-open-source-vs-team-vs-enterprise-costs-3dic',
                            },
                            {
                                title: 'Semgrep Software Pricing & Plans 2026: See Your Cost',
                                type: 'knowledge',
                                url: 'https://www.vendr.com/marketplace/semgrep',
                            },
                        ],
                        name: 'web_search',
                        tool_use_id: 'semgrep-search',
                        type: 'tool_result',
                    },
                    { text: 'Answer', type: 'text' },
                ],
            },
        });

        const events = parseWebChatFiles([{ content: JSON.stringify(input), name: 'claude.json' }]).conversations[0]!
            .events;

        expect(getToolOutputs(events)).toEqual([
            expect.objectContaining({
                callId: 'semgrep-search',
                outputText:
                    'Semgrep Pricing in 2026: Open Source vs Team vs Enterprise Costs - DEV Community\nhttps://dev.to/rahulxsingh/semgrep-pricing-in-2026-open-source-vs-team-vs-enterprise-costs-3dic\n\nSemgrep Software Pricing & Plans 2026: See Your Cost\nhttps://www.vendr.com/marketplace/semgrep',
            }),
        ]);
    });

    it('should expose attached ChatGPT research searches as tool calls', () => {
        const input = createMappingExport({
            conversationId: 'chatgpt-search',
            model: 'gpt-5-6-pro',
            title: 'Research protocol assignment',
        });
        Object.assign(input.mapping.assistant.message, {
            content: { content_type: 'code', text: '{"search_query":[{"q":"primary sources"}]}' },
            recipient: 'web.run',
        });

        const events = parseWebChatFiles([{ content: JSON.stringify(input), name: 'chatgpt-search.json' }])
            .conversations[0]!.events;

        expect(getToolCalls(events)).toEqual([
            expect.objectContaining({ command: 'primary sources', name: 'web.run' }),
        ]);
    });

    it('should expose attached ChatGPT research page opens as tool calls', () => {
        const input = createMappingExport({
            conversationId: 'chatgpt-open',
            model: 'gpt-5-6-pro',
            title: 'Research protocol',
        });
        Object.assign(input.mapping.assistant.message, {
            content: { content_type: 'code', text: '{"open":[{"ref_id":"https://example.com/report"}]}' },
            recipient: 'web.run',
        });

        const events = parseWebChatFiles([{ content: JSON.stringify(input), name: 'chatgpt-open.json' }])
            .conversations[0]!.events;

        expect(getToolCalls(events)).toEqual([
            expect.objectContaining({ command: 'https://example.com/report', name: 'web.run' }),
        ]);
    });

    it('should expose the attached ChatGPT Deep Research app launch as a tool call', () => {
        const input = createMappingExport({
            conversationId: 'deep-research-launch',
            model: 'gpt-5-6-pro',
            title: 'Deep Research Assignment',
        });
        Object.assign(input.mapping.assistant.message, {
            content: { content_type: 'code', text: '' },
            metadata: {
                chatgpt_sdk: { resource_name: 'Deep Research App_start' },
                tool_invoking_message: 'Running app request',
            },
            recipient: 'api_tool.call_tool',
        });

        const events = parseWebChatFiles([{ content: JSON.stringify(input), name: 'deep-research.json' }])
            .conversations[0]!.events;

        expect(getToolCalls(events)).toEqual([
            expect.objectContaining({ command: 'Deep Research App_start', name: 'api_tool.call_tool' }),
        ]);
    });
});
