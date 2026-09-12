import { describe, expect, it } from 'bun:test';
import { convertConversationPayload } from './client';
import {
    chatgptResearchPayload,
    chatgptResearchReport,
    geminiResearchPayload,
    payloadSourceFixtures,
} from './lib/conversation-payload-test-helpers';
import { listImportedWebChats } from './lib/web-chat';

describe('payload SDK', () => {
    for (const { source, payload } of payloadSourceFixtures) {
        it(`should infer and convert ${source} through the public SDK`, async () => {
            const original = JSON.stringify(payload);
            const inferred = await convertConversationPayload({ payload });
            expect(inferred).toHaveLength(1);
            expect(inferred[0]!.source).toBe(source);
            expect(inferred[0]!.markdown).toContain('Consumer answer');
            expect(
                inferred[0]!.messages.some(
                    (message) => message.role === 'assistant' && message.text === 'Consumer answer',
                ),
            ).toBe(true);
            expect(await convertConversationPayload({ payload: JSON.stringify(payload), source })).toEqual(inferred);
            expect(JSON.stringify(payload)).toBe(original);
            const selected = await convertConversationPayload({ messageSelector: 'last_final_answer', payload });
            expect(selected[0]!.id).toBe(inferred[0]!.id);
            expect(selected[0]!.messages).toHaveLength(1);
            expect(selected[0]!.messages[0]!.text).toBe('Consumer answer');
            await expect(convertConversationPayload({ payload: { invalid: true }, source })).rejects.toThrow();
        });
    }
    it('should reject malformed rows alongside valid rows for every source', async () => {
        const rowPaths: Record<string, string[]> = {
            antigravity: ['entries'],
            cline: ['messages'],
            codex: [],
            cursor: ['bubbles'],
            fx: ['checkpoint', 'state', 'history'],
            grok: ['chat_history'],
            'grok-bot': ['value', 'entries'],
            kiro: ['history'],
            'minimax-code': ['displayMessages'],
            opencode: ['messages'],
            qoder: [],
            web: ['messages'],
        };
        for (const fixture of payloadSourceFixtures) {
            const payload = structuredClone(fixture.payload);
            let rows: unknown = payload;
            for (const key of rowPaths[fixture.source]!) {
                rows = (rows as Record<string, unknown>)[key];
            }
            expect(Array.isArray(rows)).toBe(true);
            (rows as unknown[]).push(null);
            await expect(convertConversationPayload({ payload, source: fixture.source })).rejects.toThrow();
        }
    });
    it('should convert JSON payloads without a server and use stable model labels and selectors', async () => {
        const payload = {
            messages: [
                { content: 'Question', role: 'user' },
                { content: 'Answer', role: 'assistant' },
            ],
            model: 'openai/gpt-5',
            title: 'Imported question',
        };
        const [all] = await convertConversationPayload({ payload });
        expect(all).toMatchObject({ model: 'openai/gpt-5', source: 'web', title: 'Imported question' });
        expect(all!.markdown).toBe('# Imported question\n\n## User\n\nQuestion\n\n## GPT 5\n\nAnswer\n');
        const [last] = await convertConversationPayload({
            messageSelector: 'last_final_answer',
            payload: JSON.stringify(payload),
        });
        expect(last!.messages).toHaveLength(1);
        expect(last!.markdown).not.toContain('## User');
        expect(last!.id).toBe(all!.id);
    });

    it('should continue auto-detection to Web after a native parser rejects the shape', async () => {
        const payload = [
            { content: 'Question', role: 'user', type: 'message' },
            { content: 'Answer', role: 'assistant', type: 'message' },
        ];
        const [result] = await convertConversationPayload({ payload });
        expect(result!.source).toBe('web');
        expect(result!.messages.map((message) => message.text)).toEqual(['Question', 'Answer']);
        await expect(convertConversationPayload({ payload, source: 'opencode' })).rejects.toMatchObject({
            code: 'malformed_payload',
        });

        const malformedNative = { history: 'not-an-array', sessionId: 'kiro' };
        await expect(convertConversationPayload({ payload: malformedNative })).rejects.toMatchObject({
            code: 'unsupported_format',
        });
        await expect(convertConversationPayload({ payload: malformedNative, source: 'kiro' })).rejects.toMatchObject({
            code: 'malformed_payload',
        });
    });

    it('should infer every supported Web provider and preserve distinct conversations', async () => {
        const models = [
            'gpt-5',
            'claude-sonnet-4-5',
            'gemini-3-pro',
            'grok-4',
            'qwen3-max',
            'glm-5',
            'amazon-nova',
            'deepseek-v3',
            'mistral-large',
            'perplexity',
        ];
        const expected = [
            'ChatGPT',
            'Claude',
            'Gemini',
            'Grok',
            'Qwen',
            'GLM',
            'Amazon Nova',
            'DeepSeek',
            'Mistral',
            'Perplexity',
        ];
        const converted = await convertConversationPayload({
            payload: models.map((model, index) => ({
                conversation_id: `web-${index}`,
                messages: [{ content: `Answer ${index}`, role: 'assistant' }],
                model,
            })),
        });
        expect(converted.map((conversation) => conversation.metadata.platform)).toEqual(expected);
        expect(converted.map((conversation) => conversation.messages[0]!.text)).toEqual(
            models.map((_, i) => `Answer ${i}`),
        );
    });

    it('should reject invalid, unknown and unsupported inputs without partial conversion', async () => {
        for (const payload of [null, 42, true, '', 'not json', '{"messages":', {}, [], { hello: 'world' }]) {
            await expect(convertConversationPayload({ payload })).rejects.toThrow();
        }
        await expect(convertConversationPayload({ payload: {}, source: 'claude-code' as never })).rejects.toThrow(
            'Claude Code',
        );
        await expect(convertConversationPayload({ payload: {}, source: 'made-up' as never })).rejects.toThrow('source');
        await expect(convertConversationPayload({ messageSelector: 'made-up' as never, payload: {} })).rejects.toThrow(
            'selector',
        );
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        await expect(convertConversationPayload({ payload: circular })).rejects.toThrow();
        await expect(
            convertConversationPayload({ payload: { extra: 1n, messages: [{ content: 'Valid', role: 'assistant' }] } }),
        ).rejects.toThrow();
        await expect(
            convertConversationPayload({
                payload: [{ messages: [{ content: 'Valid', role: 'assistant' }] }, { unsupported: true }],
            }),
        ).rejects.toThrow();
        await expect(
            convertConversationPayload({ payload: '{"role":"user","content":"Valid"}\ninvalid' }),
        ).rejects.toThrow();
    });

    it('should reject native Claude Code JSONL while continuing to support Claude Web exports', async () => {
        const native = [
            {
                message: { content: [{ text: 'Answer', type: 'text' }], role: 'assistant' },
                sessionId: 'claude-session',
                type: 'assistant',
                uuid: 'message',
            },
        ];
        await expect(convertConversationPayload({ payload: native })).rejects.toThrow('Claude Code');
        const result = await convertConversationPayload({
            payload: {
                chat_messages: [
                    { content: [{ text: 'Web answer', type: 'text' }], sender: 'assistant', uuid: 'message' },
                ],
                uuid: 'web-claude',
            },
        });
        expect(result[0]!.metadata.platform).toBe('Claude');
    });

    it('should respect an explicit native source for records with shared Claude Code fields', async () => {
        const payload = {
            message: { content: [{ text: 'Cursor answer', type: 'text' }], role: 'assistant' },
            sessionId: 'cursor-1',
            type: 'assistant',
        };
        const [result] = await convertConversationPayload({ payload, source: 'cursor' });
        expect(result!.source).toBe('cursor');
        expect(result!.markdown).toContain('Cursor answer');
    });

    it('should reserve Claude Code rejection for Claude-shaped records', async () => {
        await expect(
            convertConversationPayload({
                payload: { message: 'Foreign answer', sessionId: 'foreign', type: 'assistant' },
            }),
        ).rejects.toMatchObject({ code: 'unsupported_format' });
    });

    it('should retain metadata in nested Web conversation envelopes', async () => {
        const data = {
            id: 'inner',
            messages: [{ content: 'Nested answer', role: 'assistant' }],
            model: 'gpt-5',
            title: 'Inner title',
        };
        for (const key of ['data', 'conversation', 'payload']) {
            const [result] = await convertConversationPayload({ payload: { [key]: data } });
            expect(result).toMatchObject({ id: 'inner', model: 'gpt-5', title: 'Inner title' });
            expect(result!.markdown).toContain('## GPT 5');
        }
    });

    it('should reject partially malformed Web message collections', async () => {
        for (const payload of [
            { messages: [{ content: 'Valid', role: 'assistant' }, null] },
            { data: { chat_messages: [{ sender: 'assistant', text: 'Valid' }, 42] } },
        ]) {
            await expect(convertConversationPayload({ payload, source: 'web' })).rejects.toMatchObject({
                code: 'malformed_payload',
            });
        }
    });

    it('should retain Gemini report citations and tools without populating the Web import store', async () => {
        const before = listImportedWebChats();
        const payload = geminiResearchPayload;
        const [result] = await convertConversationPayload({ payload });
        expect(result!.artifacts).toHaveLength(1);
        expect(result!.markdown).toContain('## Works cited\n\n1. [Source](<https://example.com/source>)');
        expect(
            result!.messages.some(
                (message) => message.phase === 'tool_call' && message.toolEvidence?.name === 'browse_page',
            ),
        ).toBe(true);
        expect(listImportedWebChats()).toEqual(before);
        const [nested] = await convertConversationPayload({ payload: { data: payload } });
        expect(nested!.artifacts).toEqual(result!.artifacts);
        expect(nested!.model).toBe(result!.model);
    });

    it('should carry a ChatGPT Deep Research report through public payload conversion', async () => {
        const [result] = await convertConversationPayload({ payload: chatgptResearchPayload });

        expect(result!.metadata.platform).toBe('ChatGPT');
        expect(result!.artifacts).toEqual([
            {
                content: chatgptResearchReport,
                id: 'chatgpt-deep-research:report:chatgpt-report-message',
                title: 'REPORT.md',
            },
        ]);
        expect(result!.markdown).toContain(`### REPORT.md\n\n${chatgptResearchReport.trimEnd()}`);
    });

    it('should carry Claude Markdown and JSON artifacts through public payload conversion', async () => {
        const report = '# Claude report\n\nThe report body.\n';
        const jsonReport = '{\r\n  "schema_note": "preserve",\r\n  "items": [1, 2]  \r\n}\r\n';
        const [result] = await convertConversationPayload({
            payload: {
                chat_messages: [
                    { content: [{ text: 'Question', type: 'text' }], sender: 'human', uuid: 'user' },
                    {
                        content: [
                            {
                                id: 'report',
                                input: { file_text: report, path: '/mnt/user-data/outputs/REPORT.md' },
                                name: 'create_file',
                                type: 'tool_use',
                            },
                            {
                                id: 'json-report',
                                input: { file_text: jsonReport, path: '/mnt/user-data/outputs/report.json' },
                                name: 'create_file',
                                type: 'tool_use',
                            },
                            { text: 'Answer', type: 'text' },
                        ],
                        sender: 'assistant',
                        uuid: 'assistant',
                    },
                ],
                model: 'claude-sonnet-5',
            },
        });

        expect(result!.artifacts).toEqual([
            { content: report, id: 'report', title: 'REPORT.md' },
            { content: jsonReport, id: 'json-report', title: 'report.json' },
        ]);
        expect(result!.markdown).toContain(`### REPORT.md\n\n${report}`);
        expect(result!.markdown).toContain(`### report.json\n\n${jsonReport.trimEnd()}`);
    });

    it('should carry GLM Markdown artifacts through public payload conversion', async () => {
        const report = '# GLM report\n\nThe report body.\n';
        const payload = {
            conversation_id: 'glm-sdk',
            current_node: 'assistant',
            default_model_slug: 'glm-5.3',
            mapping: {
                assistant: {
                    children: [],
                    message: {
                        author: { role: 'assistant' },
                        content: { content_type: 'text', parts: ['Answer'] },
                        id: 'assistant-message',
                    },
                    parent: 'user',
                },
                user: {
                    children: ['assistant'],
                    message: {
                        author: { role: 'user' },
                        content: { content_type: 'text', parts: ['Question'] },
                        id: 'user-message',
                    },
                    parent: null,
                },
            },
            raw_payload: {
                messages_batch: {
                    data: {
                        'assistant-message': {
                            content_blocks: [
                                {
                                    content: [
                                        {
                                            function: {
                                                arguments: JSON.stringify({
                                                    content: report,
                                                    filepath: '/tmp/glm-sdk/REPORT.md',
                                                }),
                                                name: 'Write',
                                            },
                                            id: 'report-call',
                                            type: 'function',
                                        },
                                    ],
                                    results: [{ status: 'completed', tool_call_id: 'report-call' }],
                                    type: 'tool_calls',
                                },
                            ],
                            role: 'assistant',
                        },
                    },
                },
            },
            title: 'GLM SDK report',
        };
        const [result] = await convertConversationPayload({ payload });

        expect(result!.artifacts).toEqual([{ content: report, id: 'report-call', title: 'REPORT.md' }]);
        expect(result!.markdown).toContain(`### REPORT.md\n\n${report}`);
    });

    it('should carry Meta Markdown and JSON artifacts through public payload conversion', async () => {
        const summary = 'Meta answer with artifact links.';
        const report = '# Muse report\n';
        const reportJson = '{"kind":"muse"}\n';
        const payload = {
            conversation_id: 'meta-sdk',
            current_node: 'assistant',
            default_model_slug: 'meta-ai',
            mapping: {
                assistant: {
                    children: [],
                    message: {
                        author: { role: 'assistant' },
                        content: { content_type: 'text', parts: [summary, report, reportJson] },
                        id: 'assistant',
                    },
                    parent: 'user',
                },
                user: {
                    children: ['assistant'],
                    message: {
                        author: { role: 'user' },
                        content: { content_type: 'text', parts: ['Question'] },
                        id: 'user',
                    },
                    parent: null,
                },
            },
            raw_payload: {
                data: {
                    conversation: {
                        messages: {
                            edges: [
                                {
                                    node: {
                                        content: summary,
                                        contentRenderer: {
                                            unified_response: {
                                                sections: [
                                                    {
                                                        view_model: {
                                                            primitive: {
                                                                html_artifact_sandbox: {
                                                                    file_extension: 'md',
                                                                    title: 'REPORT',
                                                                    uuid: 'md-id',
                                                                },
                                                                text: '📎 [REPORT.md](container:///mnt/data/REPORT.md)',
                                                            },
                                                        },
                                                    },
                                                    {
                                                        view_model: {
                                                            primitive: {
                                                                html_artifact_sandbox: {
                                                                    file_extension: 'json',
                                                                    title: 'Report',
                                                                    uuid: 'json-id',
                                                                },
                                                                text: '📎 [report.json](container:///mnt/data/report.json)',
                                                            },
                                                        },
                                                    },
                                                ],
                                            },
                                        },
                                        id: 'assistant',
                                    },
                                },
                            ],
                        },
                    },
                },
            },
            title: 'Muse SDK report',
        };
        const [result] = await convertConversationPayload({ payload });

        expect(result!.metadata.platform).toBe('Meta');
        expect(result!.artifacts).toEqual([
            { content: report, id: 'assistant:md-id', title: 'REPORT.md' },
            { content: reportJson, id: 'assistant:json-id', title: 'report.json' },
        ]);
        expect(result!.markdown).toContain(`### report.json\n\n${reportJson}`);
    });

    it('should carry Qwen Markdown artifacts through public payload conversion', async () => {
        const report = '# Qwen SDK report\n\nCitation [[1]].\n';
        const payload = {
            conversation_id: 'qwen-sdk',
            current_node: 'qwen-answer',
            default_model_slug: 'qwen3.8-max',
            mapping: {
                'qwen-answer': {
                    children: [],
                    id: 'qwen-answer',
                    message: {
                        author: { name: 'Qwen', role: 'assistant' },
                        content: { content_type: 'text', parts: [report] },
                        id: 'qwen-answer',
                    },
                    parent: 'user',
                },
                user: {
                    children: ['qwen-answer'],
                    id: 'user',
                    message: {
                        author: { role: 'user' },
                        content: { content_type: 'text', parts: ['Question'] },
                        id: 'qwen-user',
                    },
                    parent: null,
                },
            },
            raw_payload: {
                data: {
                    chat: {
                        history: {
                            currentId: 'qwen-answer',
                            messages: {
                                'qwen-answer': {
                                    content: report,
                                    content_list: [
                                        {
                                            content: report,
                                            extra: {
                                                deep_research: {
                                                    references: {
                                                        first: {
                                                            index_number: 1,
                                                            title: 'First',
                                                            url: 'https://example.com/one',
                                                        },
                                                    },
                                                },
                                            },
                                            phase: 'answer',
                                            role: 'assistant',
                                            status: 'finished',
                                        },
                                        {
                                            content: '',
                                            extra: {
                                                deep_research: {
                                                    md: {
                                                        link: 'https://cdn.example.test/qwen.md',
                                                        name: 'Qwen SDK report',
                                                        size: report.length,
                                                    },
                                                },
                                            },
                                            phase: 'PdfMdGen',
                                            role: 'assistant',
                                            status: 'finished',
                                        },
                                    ],
                                    id: 'qwen-answer',
                                    role: 'assistant',
                                },
                            },
                        },
                    },
                },
            },
            title: 'Qwen SDK report',
        };
        const [result] = await convertConversationPayload({ payload });

        expect(result!.metadata.platform).toBe('Qwen');
        expect(result!.artifacts).toEqual([
            {
                content: '# Qwen SDK report\n\nCitation [[1](https://example.com/one)].\n',
                id: 'qwen-report:qwen-answer',
                title: 'Qwen SDK report.md',
            },
        ]);
        expect(result!.markdown).toContain(
            '### Qwen SDK report.md\n\n# Qwen SDK report\n\nCitation [[1](https://example.com/one)].\n',
        );
    });

    it('should keep artifact headings on one Markdown line while preserving raw titles', async () => {
        const payload = structuredClone(geminiResearchPayload);
        (payload.raw_payload[0] as unknown[])[2] = 'Report\n## Injected heading';
        const [result] = await convertConversationPayload({ payload });
        expect(result!.artifacts[0]!.title).toBe('Report\n## Injected heading');
        expect(result!.markdown).toContain('### Report\n\n# Findings');
        expect(result!.markdown).not.toContain('## Injected heading');
    });

    it('should enforce payload limits and preserve useful JSONL errors', async () => {
        const large = 'x'.repeat(25 * 1024 * 1024 + 1);
        await expect(convertConversationPayload({ payload: large })).rejects.toThrow('25 MB');
        await expect(convertConversationPayload({ payload: { text: large } })).rejects.toThrow('25 MB');
        await expect(
            convertConversationPayload({ payload: '{"role":"user","content":"Hi"}\ninvalid' }),
        ).rejects.toMatchObject({ code: 'invalid_json' });
        await expect(
            convertConversationPayload({ payload: '{"role":"user","content":"Hi"}\n\ninvalid' }),
        ).rejects.toThrow('line 3');
        const [result] = await convertConversationPayload({
            payload: '\uFEFF{"role":"user","content":"Hi"}\r\n\r\n{"role":"assistant","content":"Hello"}',
            source: 'web',
        });
        expect(result!.messages.map((message) => message.text)).toEqual(['Hi', 'Hello']);
    });

    it('should reject ambiguous native envelopes and allow an explicit source to resolve them', async () => {
        const cline = payloadSourceFixtures.find((fixture) => fixture.source === 'cline')!.payload as Record<
            string,
            unknown
        >;
        const grok = payloadSourceFixtures.find((fixture) => fixture.source === 'grok')!.payload as Record<
            string,
            unknown
        >;
        const payload = { ...cline, ...grok };
        await expect(convertConversationPayload({ payload })).rejects.toMatchObject({ code: 'ambiguous_source' });
        expect((await convertConversationPayload({ payload, source: 'grok' }))[0]!.source).toBe('grok');
        await expect(convertConversationPayload({ payload: grok, source: 'codex' })).rejects.toThrow();
    });
});
