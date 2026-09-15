import type { ConversationPayloadSource } from './conversation-payload-types';

export const payloadSourceFixtures: Array<{ source: ConversationPayloadSource; payload: unknown }> = [
    {
        payload: [
            { payload: { cwd: '/example', id: 'codex-consumer' }, type: 'session_meta' },
            {
                payload: {
                    content: [{ text: 'Consumer answer', type: 'output_text' }],
                    phase: 'final_answer',
                    role: 'assistant',
                    type: 'message',
                },
                type: 'response_item',
            },
        ],
        source: 'codex',
    },
    {
        payload: {
            messages: [{ content: [{ text: 'Consumer answer', type: 'text' }], id: 'a', role: 'assistant' }],
            session_id: 'cline-consumer',
            workspace_root: '/example',
        },
        source: 'cline',
    },
    {
        payload: {
            chat_history: [{ content: 'Consumer answer', model_id: 'grok-4', type: 'assistant' }],
            info: { cwd: '/example', id: 'grok-consumer' },
        },
        source: 'grok',
    },
    {
        payload: {
            schemaVersion: 1,
            value: { entries: [{ content: 'Consumer answer', id: 'a', kind: 'message', role: 'assistant' }] },
        },
        source: 'grok-bot',
    },
    {
        payload: {
            history: [{ message: { content: 'Consumer answer', id: 'a', role: 'assistant' } }],
            selectedModel: 'claude-sonnet-4.5',
            sessionId: 'kiro-consumer',
        },
        source: 'kiro',
    },
    {
        payload: [
            {
                id: 'a',
                model: 'qmodel',
                parts: [{ text: 'Consumer answer', type: 'text' }],
                provider: 'qoder',
                role: 'assistant',
                session_id: 'qoder-consumer',
            },
        ],
        source: 'qoder',
    },
    {
        payload: { bubbles: [{ bubbleId: 'a', text: 'Consumer answer', type: 2 }], composerId: 'cursor-consumer' },
        source: 'cursor',
    },
    {
        payload: {
            conversationId: 'antigravity-consumer',
            entries: [{ content: 'Consumer answer', source: 'MODEL', step_index: 1, type: 'PLANNER_RESPONSE' }],
        },
        source: 'antigravity',
    },
    {
        payload: {
            displayMessages: [
                { finish_reason: 'stop', msg_content: 'Consumer answer', msg_id: 'a', msg_type: 2, role: 'assistant' },
            ],
            record: { effectiveModel: 'minimax/MiniMax-M3', sessionId: 'minimax-consumer', workspaceDir: '/example' },
            schemaVersion: 1,
            sessionId: 'minimax-consumer',
        },
        source: 'minimax-code',
    },
    {
        payload: {
            messages: [
                { id: 'a', parts: [{ data: { text: 'Consumer answer', type: 'text' }, id: 'p' }], role: 'assistant' },
            ],
            session: { id: 'opencode-consumer', worktree: '/example' },
        },
        source: 'opencode',
    },
    {
        payload: {
            checkpoint: {
                schema_version: 1,
                state: {
                    history: [{ assistant: 'Consumer answer', user: { text: 'Question' } }],
                    workspace_root: '/example',
                },
                through_seq: 0,
            },
            session: { id: 'fx-consumer', workspace_root: '/example' },
        },
        source: 'fx',
    },
    { payload: { messages: [{ content: 'Consumer answer', role: 'assistant' }], model: 'gpt-5' }, source: 'web' },
];

export const geminiResearchPayload = {
    messages: [{ content: 'Research complete.', role: 'assistant' }],
    model: 'gemini-3-pro',
    raw_payload: [
        [
            'im_report',
            null,
            'Report',
            null,
            '# Findings\n\nEvidence [cite: 1]',
            [
                {
                    44: [
                        [
                            [' [cite: 1]'],
                            [
                                [
                                    null,
                                    null,
                                    null,
                                    [['https://www.gstatic.com/favicon', 'https://example.com/source', 'Source'], 1],
                                ],
                            ],
                        ],
                    ],
                },
            ],
            null,
            null,
            [],
            'im_report',
            3,
        ],
    ],
};

export const chatgptResearchReport = '# ChatGPT research report\r\n\r\nPreserve this exact body.  \r\n';

export const chatgptResearchPayload = {
    conversation_id: 'chatgpt-research',
    current_node: 'research',
    default_model_slug: 'gpt-6-pro',
    mapping: {
        research: {
            children: [],
            message: {
                author: { role: 'tool' },
                content: { content_type: 'text', parts: [] },
                id: 'research-tool-message',
                metadata: {
                    chatgpt_sdk: {
                        widget_state: JSON.stringify({
                            report_message: {
                                author: { role: 'assistant' },
                                content: { content_type: 'text', parts: [chatgptResearchReport] },
                                id: 'chatgpt-report-message',
                                recipient: 'all',
                            },
                        }),
                    },
                },
            },
            parent: 'user',
        },
        root: { children: ['user'], message: null, parent: null },
        user: {
            children: ['research'],
            message: {
                author: { role: 'user' },
                content: { content_type: 'text', parts: ['Question'] },
                id: 'user-message',
            },
            parent: 'root',
        },
    },
    title: 'ChatGPT Research',
};
