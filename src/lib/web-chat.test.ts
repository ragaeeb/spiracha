import { describe, expect, it } from 'bun:test';
import type { ThreadEvent } from './codex-browser-types';
import { getImportedWebChat, importWebChatFiles, parseWebChatFiles } from './web-chat';

const isAssistantMessage = (event: ThreadEvent): event is Extract<ThreadEvent, { kind: 'message' }> =>
    event.kind === 'message' && event.role === 'assistant';

const getToolCalls = (events: ThreadEvent[]) => events.filter((event) => event.kind === 'tool_call');
const getToolOutputs = (events: ThreadEvent[]) => events.filter((event) => event.kind === 'tool_output');

it('should preserve nested Web metadata and use outer metadata only as a fallback', async () => {
    const { conversations, errors } = await parseWebChatFiles([
        {
            content: JSON.stringify({
                data: {
                    create_time: 1_700_000_000,
                    id: 'nested',
                    messages: [{ content: 'Answer', role: 'assistant' }],
                    title: 'Inner title',
                },
                model: 'gpt-5',
                title: 'Outer title',
            }),
            name: 'nested.json',
        },
    ]);
    expect(errors).toEqual([]);
    expect(conversations[0]).toMatchObject({
        createdAtMs: 1_700_000_000_000,
        model: 'gpt-5',
        platform: 'ChatGPT',
        sourceConversationId: 'nested',
        title: 'Inner title',
    });
});

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

type TestQwenReferences = Record<string, unknown> | unknown[];

const createQwenContentList = (report: string, references: TestQwenReferences, title = 'Qwen report') => [
    {
        content: 'Planning',
        extra: { deep_research: { lang_code: 'en', version: 1 } },
        phase: 'ResearchPlanning',
        role: 'assistant',
        status: 'finished',
    },
    {
        content: '',
        extra: {
            deep_research: {
                md: { link: 'https://cdn.example.test/report.md', name: title, size: report.length },
                pdf: { link: 'https://cdn.example.test/report.pdf', name: title, size: 1 },
                version: 1,
            },
        },
        phase: 'PdfMdGen',
        role: 'assistant',
        status: 'finished',
    },
    {
        content: report,
        extra: { deep_research: { references } },
        phase: 'answer',
        role: 'assistant',
        status: 'finished',
    },
];

const createQwenArtifactExport = (
    options: {
        contentList?: unknown[];
        includeSibling?: boolean;
        mappingBody?: string;
        rawCurrentId?: string;
        references?: TestQwenReferences;
        title?: string;
    } = {},
) => {
    const report = options.mappingBody ?? '# Qwen report\n\nCitations: [[1]].\n';
    const reportReferences = options.references ?? {
        first: { index_number: 1, title: 'First', url: 'https://example.com/one' },
    };
    const title = options.title ?? 'Qwen report';
    const answerId = 'qwen-answer';
    const siblingId = 'qwen-sibling';
    const answerMessage = {
        author: { name: 'Qwen', role: 'assistant' },
        content: { content_type: 'text', parts: [report] },
        id: answerId,
        role: 'assistant',
    };
    const siblingMessage = {
        author: { name: 'Qwen', role: 'assistant' },
        content: { content_type: 'text', parts: ['Sibling report [[1]].\n'] },
        id: siblingId,
        role: 'assistant',
    };
    const rawAnswer = {
        content: '',
        content_list: options.contentList ?? createQwenContentList(report, reportReferences, title),
        id: answerId,
        role: 'assistant',
    };
    const rawMessages = {
        [answerId]: rawAnswer,
        ...(options.includeSibling
            ? {
                  [siblingId]: {
                      content: 'Sibling report [[1]].\n',
                      content_list: createQwenContentList(
                          'Sibling report [[1]].\n',
                          reportReferences,
                          'Sibling report',
                      ),
                      id: siblingId,
                      role: 'assistant',
                  },
              }
            : {}),
    };
    return {
        conversation_id: 'qwen-artifact',
        create_time: 1_700_000_000,
        current_node: answerId,
        default_model_slug: 'qwen3.8-max',
        mapping: {
            [answerId]: {
                children: [],
                id: answerId,
                message: answerMessage,
                parent: 'user',
            },
            ...(options.includeSibling
                ? {
                      [siblingId]: {
                          children: [],
                          id: siblingId,
                          message: siblingMessage,
                          parent: 'user',
                      },
                  }
                : {}),
            root: { children: ['user'], id: 'root', message: null, parent: null },
            user: {
                children: options.includeSibling ? [answerId, siblingId] : [answerId],
                id: 'user',
                message: {
                    author: { role: 'user' },
                    content: { content_type: 'text', parts: ['Question'] },
                    id: 'user-message',
                },
                parent: 'root',
            },
        },
        raw_payload: {
            data: {
                chat: {
                    history: {
                        currentId: options.rawCurrentId ?? answerId,
                        messages: rawMessages,
                    },
                },
            },
        },
        title: 'Qwen research',
        update_time: 1_700_000_001,
    };
};

describe('parseWebChatFiles', () => {
    it('should extract Gemini research artifacts once and preserve their Markdown exactly', async () => {
        const content =
            '# Research Report — AI-assisted label quality and safe autonomous experiment control\n\nArabic: رحمه الله\n';
        const artifact = ['im_report', null, 'Research report', 'task', content, [], null, null, [], 'im_report', 3];
        const input = {
            ...createMappingExport({ conversationId: 'gemini-artifact', model: 'gemini-3-pro', title: 'Research' }),
            raw_payload: [[artifact, artifact], ['im_invalid', null, 'Invalid', null, 42], content],
        };
        const conversation = (await parseWebChatFiles([{ content: JSON.stringify(input), name: 'gemini.json' }]))
            .conversations[0]!;
        expect(conversation.artifacts).toEqual([{ content, id: 'im_report', title: 'Research report' }]);
        expect(conversation.events.filter((event) => event.kind === 'reasoning')).toEqual([]);
        expect(
            (
                await parseWebChatFiles([
                    { content: JSON.stringify({ ...input, default_model_slug: 'gpt-5' }), name: 'chatgpt.json' },
                ])
            ).conversations[0]!.artifacts,
        ).toEqual([]);
    });

    it('should keep Gemini document sections out of reasoning while preserving actual thoughts', async () => {
        const section = 'Research relies on provided snapshot.\n\n## Source Ledger\nOriginal sources.';
        const content = `# Research Report\n\n${section}`;
        const input = {
            messages: [
                {
                    content: {
                        content_type: 'thoughts',
                        parts: ['Research complete.'],
                        thoughts: [{ content: section }, { content: 'I should compare the sources.' }],
                    },
                    role: 'assistant',
                },
            ],
            model: 'gemini-3-pro',
            raw_payload: [
                [
                    'im_sections',
                    null,
                    'Report',
                    null,
                    content,
                    [],
                    null,
                    null,
                    [[section]],
                    'im_sections',
                    3,
                    null,
                    false,
                    null,
                    null,
                    null,
                    null,
                    [content, null, null, [[section]]],
                ],
            ],
        };
        const conversation = (await parseWebChatFiles([{ content: JSON.stringify(input), name: 'gemini.json' }]))
            .conversations[0]!;
        expect(conversation.artifacts).toEqual([{ content, id: 'im_sections', title: 'Report' }]);
        expect(conversation.events.filter((event) => event.kind === 'reasoning').map((event) => event.content)).toEqual(
            ['I should compare the sources.'],
        );
    });

    it('should append numbered Gemini works cited once and reuse their browsing tool calls', async () => {
        const body = '# Report\n\nResearch relies on provided snapshot. [cite: 1, 2]\n';
        const first = [
            null,
            null,
            null,
            [['https://www.gstatic.com/icon', 'https://example.com/one', 'First [source]'], 1],
        ];
        const second = [
            null,
            null,
            null,
            [['https://www.gstatic.com/icon', 'https://example.com/two', 'Second source'], 2],
        ];
        const citations = [
            {
                44: [
                    [[' [cite: 2]'], [second]],
                    [[' [cite: 1, 2]'], [first, second]],
                ],
            },
        ];
        const document = ['im_cited', null, 'Report', null, body, citations, null, null, [], 'im_cited', 3];
        const input = {
            messages: [
                {
                    content: { content_type: 'thoughts', parts: ['Done'], thoughts: [{ content: body }] },
                    role: 'assistant',
                },
            ],
            model: 'gemini-3-pro',
            raw_payload: [document, document],
        };
        const conversation = (await parseWebChatFiles([{ content: JSON.stringify(input), name: 'gemini.json' }]))
            .conversations[0]!;
        expect(conversation.artifacts).toEqual([
            {
                content: `${body}\n## Works cited\n\n1. [First \\[source\\]](<https://example.com/one>)\n2. [Second source](<https://example.com/two>)\n`,
                id: 'im_cited',
                title: 'Report',
            },
        ]);
        expect(
            getToolCalls(conversation.events)
                .map((event) => event.argumentsText)
                .sort(),
        ).toEqual(['{"url":"https://example.com/one"}', '{"url":"https://example.com/two"}']);
        expect(conversation.events.filter((event) => event.kind === 'reasoning')).toEqual([]);
    });

    it('should ignore malformed Gemini citations and keep uncited document bodies unchanged', async () => {
        const body = '# Report\n';
        const input = {
            messages: [{ content: 'Done', role: 'assistant' }],
            model: 'gemini-3-pro',
            raw_payload: [
                [
                    'im_bad_citations',
                    null,
                    'Report',
                    null,
                    body,
                    [
                        {
                            44: [
                                null,
                                [
                                    [],
                                    [
                                        null,
                                        [null, null, null, [[null, 'javascript:alert(1)', 'Bad URL'], 1]],
                                        [null, null, null, [[null, 'https://example.com', 'Bad number'], -1]],
                                        [null, null, null, [[null, 'https://example.com', null], 2]],
                                    ],
                                ],
                            ],
                        },
                    ],
                    null,
                    null,
                    [],
                    'im_bad_citations',
                    3,
                ],
            ],
        };
        expect(
            (await parseWebChatFiles([{ content: JSON.stringify(input), name: 'gemini.json' }])).conversations[0]!
                .artifacts[0]!.content,
        ).toBe(body);
    });

    it('should extract the selected Qwen Markdown artifact with exact citation expansion', async () => {
        const report =
            '# Qwen report\n\n' +
            'Combined [[1,2]]. Repeated [[1]].\n' +
            'Inline `[[3]]` remains literal.\n' +
            '```md\n[[4]]\n```\n' +
            'Malformed [[[1]] and [[1]]] remain literal.\n';
        const references = [
            { index_number: 1, title: 'First', url: 'https://example.com/one' },
            { index_number: 2, title: 'Second', url: 'https://example.com/two' },
            { index_number: 3, title: 'Inline', url: 'https://example.com/three' },
            { index_number: 4, title: 'Fence', url: 'https://example.com/four' },
            { index_number: 99, title: 'Ignore', url: 'not-a-url<b>' },
        ];
        const input = createQwenArtifactExport({ mappingBody: report, references, title: 'Qwen research artifact' });
        const conversation = (await parseWebChatFiles([{ content: JSON.stringify(input), name: 'qwen.json' }]))
            .conversations[0]!;

        expect(conversation.platform).toBe('Qwen');
        expect(conversation.artifacts).toEqual([
            {
                content:
                    '# Qwen report\n\n' +
                    'Combined [[1](https://example.com/one), [2](https://example.com/two)]. Repeated [[1](https://example.com/one)].\n' +
                    'Inline `[[3]]` remains literal.\n' +
                    '```md\n[[4]]\n```\n' +
                    'Malformed [[[1]] and [[1]]] remain literal.\n',
                id: 'qwen-report:qwen-answer',
                title: 'Qwen research artifact.md',
            },
        ]);
    });

    it('should fail closed when Qwen report binding or cited references are ambiguous', async () => {
        const report = '# Qwen report\n\nCitation [[1]].\n';
        const references = {
            first: { index_number: 1, title: 'First', url: 'https://example.com/one' },
        };
        const parseArtifacts = async (input: unknown) =>
            (await parseWebChatFiles([{ content: JSON.stringify(input), name: 'qwen.json' }])).conversations[0]!
                .artifacts;

        const selected = await parseArtifacts(
            createQwenArtifactExport({
                includeSibling: true,
                mappingBody: report,
                rawCurrentId: 'qwen-sibling',
                references,
            }),
        );
        expect(selected).toEqual([
            {
                content: '# Qwen report\n\nCitation [[1](https://example.com/one)].\n',
                id: 'qwen-report:qwen-answer',
                title: 'Qwen report.md',
            },
        ]);

        const duplicateEntries = createQwenContentList(report, references);
        duplicateEntries.push(structuredClone(duplicateEntries[2]));
        expect(
            await parseArtifacts(
                createQwenArtifactExport({ contentList: duplicateEntries, mappingBody: report, references }),
            ),
        ).toEqual([]);

        expect(
            await parseArtifacts({
                ...createQwenArtifactExport({ mappingBody: report, references }),
                raw_payload: {
                    data: {
                        chat: {
                            history: {
                                currentId: 'qwen-answer',
                                messages: {
                                    'qwen-answer': {
                                        content: '',
                                        content_list: createQwenContentList('Different body', references),
                                        id: 'qwen-answer',
                                        role: 'assistant',
                                    },
                                },
                            },
                        },
                    },
                },
            }),
        ).toEqual([]);

        const conflictingReferences = {
            ...references,
            conflict: { index_number: 1, title: 'Conflict', url: 'https://example.com/two' },
        };
        expect(
            await parseArtifacts(createQwenArtifactExport({ mappingBody: report, references: conflictingReferences })),
        ).toEqual([]);

        expect(
            await parseArtifacts(
                createQwenArtifactExport({
                    mappingBody: report,
                    references: { first: { index_number: 1, title: 'Unsafe', url: 'javascript:alert(1)' } },
                }),
            ),
        ).toEqual([]);
    });

    it('should infer the attached mapping export providers at runtime', async () => {
        const cases = [
            { assistantMetadata: { grok_mode: 'deepsearch' }, expected: 'Grok', model: 'Normal' },
            { expected: 'Gemini', model: 'gemini-3.1-pro-extended' },
            { assistantMetadata: { qwen_model: 'qwen3.8-max' }, expected: 'Qwen', model: 'qwen3.8-max' },
            { expected: 'Claude', model: 'claude-sonnet-5' },
            { expected: 'ChatGPT', model: 'gpt-5-6-pro' },
            { expected: 'Meta', model: 'meta-ai' },
        ];

        for (const [index, testCase] of cases.entries()) {
            const result = await parseWebChatFiles([
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

        const incidentalMeta = await parseWebChatFiles([
            {
                content: JSON.stringify(
                    createMappingExport({
                        assistantMetadata: { meta_note: 'Meta appears in the report text.' },
                        conversationId: 'incidental-meta',
                        model: 'gpt-5',
                        title: 'ChatGPT research',
                    }),
                ),
                name: 'chat.json',
            },
        ]);
        expect(incidentalMeta.conversations[0]!.platform).toBe('ChatGPT');
    });

    it('should follow the selected mapping branch and preserve reasoning separately', async () => {
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

        const result = await parseWebChatFiles([{ content: JSON.stringify(input), name: 'branch.json' }]);
        const events = result.conversations[0]!.events;

        expect(events.map((event) => event.kind)).toEqual(['message', 'reasoning', 'message']);
        expect(events[1]).toMatchObject({ kind: 'reasoning', summary: ['Private reasoning'] });
        expect(events[2]).toMatchObject({ kind: 'message', text: 'Final answer' });
    });

    it('should prefer content provider hints over a misleading file name', async () => {
        const input = createMappingExport({
            conversationId: 'misnamed-chat',
            model: 'gpt-5',
            title: 'Misnamed chat',
        });
        input.mapping.assistant.message.content = {
            content_type: 'reasoning_recap',
            parts: ['Reasoning stored in parts'],
        };

        const result = await parseWebChatFiles([{ content: JSON.stringify(input), name: 'claude-export.json' }]);

        expect(result.conversations[0]!.platform).toBe('ChatGPT');
        expect(result.conversations[0]!.events.map((event) => event.kind)).toEqual(['message', 'reasoning']);
        expect(result.conversations[0]!.events[1]).toMatchObject({
            kind: 'reasoning',
            summary: ['Reasoning stored in parts'],
        });
    });

    it('should parse native Claude and Grok exports from one multi-file import', async () => {
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

        const result = await parseWebChatFiles([
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

    it('should extract Claude Markdown artifacts from selected mapping and native message branches', async () => {
        const report = '# Claude report\r\n\r\nReasoning marker\r\n';
        const createFile = (id: string | undefined, path: string, fileText: string) => ({
            id,
            input: { description: 'Generated report', file_text: fileText, path },
            name: 'create_file',
            type: 'tool_use',
        });
        const mappingFile = createFile('mapping-report', '/mnt/user-data/outputs/REPORT.md', report);
        const mapping = {
            assistant: {
                children: [],
                message: {
                    author: { role: 'assistant' },
                    content: [
                        { content: 'Reasoning marker', type: 'thinking' },
                        mappingFile,
                        structuredClone(mappingFile),
                        { text: 'Claude answer', type: 'text' },
                        createFile('ignored-text', '/mnt/user-data/outputs/notes.txt', 'Not Markdown'),
                    ],
                },
                parent: 'user',
            },
            user: {
                children: ['assistant'],
                message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['Question'] } },
                parent: null,
            },
        };
        const mappingResult = await parseWebChatFiles([
            {
                content: JSON.stringify({
                    conversation_id: 'claude-mapping-artifact',
                    current_node: 'assistant',
                    default_model_slug: 'claude-sonnet-5',
                    mapping,
                    raw_payload: {
                        chat_messages: [
                            {
                                content: [createFile('unselected', '/mnt/user-data/outputs/unselected.md', 'Ignore')],
                                sender: 'assistant',
                            },
                        ],
                        platform: 'CLAUDE_AI',
                    },
                }),
                name: 'claude-mapping.json',
            },
        ]);
        const mappingConversation = mappingResult.conversations[0]!;

        expect(mappingConversation.artifacts).toEqual([{ content: report, id: 'mapping-report', title: 'REPORT.md' }]);
        expect(mappingConversation.events.filter((event) => event.kind === 'reasoning')).toMatchObject([
            { content: 'Reasoning marker' },
        ]);
        expect(getToolCalls(mappingConversation.events)).toHaveLength(2);

        const nativeReport = '# Native report\n';
        const nativeFile = createFile('native-report', '/mnt/user-data/outputs/report.markdown', nativeReport);
        const nativeResult = await parseWebChatFiles([
            {
                content: JSON.stringify({
                    chat_messages: [
                        { content: [{ text: 'Question', type: 'text' }], sender: 'human' },
                        {
                            content: [
                                nativeFile,
                                structuredClone(nativeFile),
                                createFile('native-report', '/mnt/user-data/outputs/report.markdown', 'Conflict'),
                                createFile('native-revision', '/mnt/user-data/outputs/report.markdown', 'Revision'),
                                createFile('empty-report', '/mnt/user-data/outputs/empty.md', ''),
                                createFile(undefined, '/mnt/user-data/outputs/no-id.md', 'No ID'),
                                createFile(undefined, '/mnt/user-data/outputs/no-id.md', 'No ID'),
                                createFile('ignored-text', '/mnt/user-data/outputs/notes.txt', 'Not Markdown'),
                                { text: 'Answer', type: 'text' },
                            ],
                            sender: 'assistant',
                        },
                    ],
                    model: 'claude-sonnet-5',
                }),
                name: 'claude-native.json',
            },
        ]);

        expect(nativeResult.conversations[0]!.artifacts).toEqual([
            { content: nativeReport, id: 'native-report', title: 'report.markdown' },
            { content: 'Conflict', id: 'native-report:2', title: 'report.markdown' },
            { content: 'Revision', id: 'native-revision', title: 'report.markdown' },
            { content: '', id: 'empty-report', title: 'empty.md' },
            { content: 'No ID', id: 'claude-artifact-5', title: 'no-id.md' },
        ]);
    });

    it('should extract selected Meta Markdown and JSON artifacts without rewriting their bodies', async () => {
        const summary = 'Meta answer with artifact links.';
        const report = '# Muse report\n\nArabic: رحمه الله\n';
        const reportJson = '{\n  "kind": "muse",\n  "count": 2\n}\n';
        const makeSection = (uuid: string, extension: string, link: string) => ({
            view_model: {
                primitive: {
                    html_artifact_sandbox: { file_extension: extension, title: 'Report', uuid },
                    text: `📎 [${link.split('/').at(-1)?.split('?')[0]}](${link})`,
                },
            },
        });
        const base = createMappingExport({ conversationId: 'meta-artifact', model: 'meta-ai', title: 'Muse report' });
        const input = {
            ...base,
            mapping: {
                ...base.mapping,
                assistant: {
                    ...base.mapping.assistant,
                    message: {
                        ...base.mapping.assistant.message,
                        content: { content_type: 'text', parts: [summary, report, reportJson] },
                    },
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
                                                    makeSection(
                                                        'meta-markdown-id',
                                                        'md',
                                                        'container:///mnt/data/REPORT.md?download=1',
                                                    ),
                                                    makeSection(
                                                        'meta-json-id',
                                                        'json',
                                                        'container:///mnt/data/report.json?download=1',
                                                    ),
                                                ],
                                            },
                                        },
                                        id: 'assistant-message',
                                    },
                                },
                                {
                                    node: {
                                        content: 'Ignore this branch',
                                        contentRenderer: {
                                            unified_response: {
                                                sections: [
                                                    makeSection(
                                                        'unselected-id',
                                                        'md',
                                                        'container:///mnt/data/unselected.md',
                                                    ),
                                                ],
                                            },
                                        },
                                        id: 'unselected-assistant',
                                    },
                                },
                            ],
                        },
                    },
                },
            },
        };

        const result = await parseWebChatFiles([{ content: JSON.stringify(input), name: 'meta.json' }]);

        expect(result.conversations[0]).toMatchObject({ platform: 'Meta' });
        expect(result.conversations[0]!.artifacts).toEqual([
            { content: report, id: 'assistant-message:meta-markdown-id', title: 'REPORT.md' },
            { content: reportJson, id: 'assistant-message:meta-json-id', title: 'report.json' },
        ]);
    });

    it('should fail closed on ambiguous or conflicting Meta artifact bindings', async () => {
        const summary = 'Meta answer with artifact links.';
        const report = '# Muse report\n';
        const reportJson = '{"kind":"muse"}\n';
        const makeInput = (parts: unknown[], sections: unknown[]) => {
            const base = createMappingExport({ conversationId: 'meta-safety', model: 'meta-ai', title: 'Muse' });
            return {
                ...base,
                mapping: {
                    ...base.mapping,
                    assistant: {
                        ...base.mapping.assistant,
                        message: {
                            ...base.mapping.assistant.message,
                            content: { content_type: 'text', parts },
                        },
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
                                            contentRenderer: { unified_response: { sections } },
                                            id: 'assistant-message',
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
            };
        };
        const section = (uuid: string, extension: string, path: string) => ({
            view_model: {
                primitive: {
                    html_artifact_sandbox: { file_extension: extension, title: 'Report', uuid },
                    text: `📎 [${path.split('/').at(-1)}](container:///mnt/data/${path})`,
                },
            },
        });
        const parseArtifacts = async (input: ReturnType<typeof makeInput>) =>
            (await parseWebChatFiles([{ content: JSON.stringify(input), name: 'meta.json' }])).conversations[0]!
                .artifacts;

        expect(
            await parseArtifacts(
                makeInput(
                    [summary, report, reportJson],
                    [section('md-id', 'md', 'REPORT.md'), section('json-id', 'md', 'report.json')],
                ),
            ),
        ).toEqual([{ content: report, id: 'assistant-message:md-id', title: 'REPORT.md' }]);
        expect(
            await parseArtifacts(
                makeInput(
                    [summary, report, 'not-json'],
                    [section('md-id', 'md', 'REPORT.md'), section('json-id', 'json', 'report.json')],
                ),
            ),
        ).toEqual([{ content: report, id: 'assistant-message:md-id', title: 'REPORT.md' }]);
        expect(
            await parseArtifacts(
                makeInput(
                    [summary, '{"distractor":true}', report, reportJson],
                    [section('md-id', 'md', 'REPORT.md'), section('json-id', 'json', 'report.json')],
                ),
            ),
        ).toEqual([]);
        expect(
            await parseArtifacts(
                makeInput(
                    [summary, report, report, reportJson],
                    [
                        section('same-id', 'md', 'REPORT.md'),
                        section('same-id', 'md', 'REPORT.md'),
                        section('json-id', 'json', 'report.json'),
                    ],
                ),
            ),
        ).toEqual([
            { content: report, id: 'assistant-message:same-id', title: 'REPORT.md' },
            { content: reportJson, id: 'assistant-message:json-id', title: 'report.json' },
        ]);
        expect(
            await parseArtifacts(
                makeInput(
                    [summary, report, reportJson],
                    [
                        section('same-id', 'md', 'REPORT.md'),
                        section('same-id', 'md', 'REPORT.md'),
                        section('json-id', 'json', 'report.json'),
                    ],
                ),
            ),
        ).toEqual([
            { content: report, id: 'assistant-message:same-id', title: 'REPORT.md' },
            { content: reportJson, id: 'assistant-message:json-id', title: 'report.json' },
        ]);
        expect(
            await parseArtifacts(
                makeInput(
                    [summary, report, reportJson],
                    [section('same-id', 'md', 'REPORT.md'), section('same-id', 'md', 'different.md')],
                ),
            ),
        ).toEqual([]);
        expect(
            await parseArtifacts(
                makeInput(
                    [summary, report],
                    [section('md-id', 'md', 'REPORT.md'), section('json-id', 'json', 'report.json')],
                ),
            ),
        ).toEqual([]);
    });

    it('should replay the selected GLM report file operations exactly', async () => {
        const directory = '/tmp/glm-artifact';
        const reportPath = `${directory}/REPORT.md`;
        const jsonPath = `${directory}/report.json`;
        const fence = '```';
        const toolBlock = (id: string, name: string, args: Record<string, unknown>, status = 'completed') => ({
            content: [{ function: { arguments: JSON.stringify(args), name }, id, type: 'function' }],
            results: [{ status, tool_call_id: id }],
            type: 'tool_calls',
        });
        const appendCommand = (body: string) =>
            `cat >> ${reportPath} << 'EOF'\n${body}\nEOF\necho "appended"; wc -c ${reportPath}`;
        const finalHeader = '\n# 14. Appendix\n\n```json';
        const finalCommand =
            `cd ${directory} && jq -e . report.json > /dev/null && echo "JSON VALID" && ` +
            `cat >> REPORT.md << 'EOF'\n${finalHeader}\nEOF\n` +
            `cat report.json >> REPORT.md && echo '${fence}' >> REPORT.md && ` +
            `echo "REPORT.md finalized:" && wc -c REPORT.md report.json && tail -3 REPORT.md`;
        const reportStart = '# GLM report\n';
        const repeatedSection = '\n# Section\nEOF marker';
        const reportJson = '{"ok":true}\n';
        const blocks = [
            toolBlock('write-report', 'Write', { content: reportStart, filepath: reportPath }),
            toolBlock('append-one', 'Bash', { command: appendCommand(repeatedSection) }),
            toolBlock('append-two', 'Bash', { command: appendCommand(repeatedSection) }),
            toolBlock('write-json', 'Write', { content: reportJson, filepath: jsonPath }),
            toolBlock('append-final', 'Bash', { command: finalCommand }),
        ];
        const input = {
            ...createMappingExport({ conversationId: 'glm-artifact', model: 'glm-5.3', title: 'GLM report' }),
            raw_payload: {
                messages_batch: {
                    data: {
                        'assistant-message': { content_blocks: blocks, role: 'assistant' },
                        'unselected-message': {
                            content_blocks: [
                                toolBlock('unselected', 'Write', {
                                    content: 'Ignore this branch',
                                    filepath: reportPath,
                                }),
                            ],
                            role: 'assistant',
                        },
                    },
                },
            },
        };
        const mappingResult = await parseWebChatFiles([{ content: JSON.stringify(input), name: 'glm-mapping.json' }]);
        const expected = `${reportStart}${repeatedSection}\n${repeatedSection}\n${finalHeader}\n${reportJson}${fence}\n`;

        expect(mappingResult.conversations[0]!.artifacts).toEqual([
            { content: expected, id: 'write-report', title: 'REPORT.md' },
        ]);

        const nativeResult = await parseWebChatFiles([
            {
                content: JSON.stringify({
                    messages: [
                        { content: 'Question', id: 'user-message', role: 'user' },
                        { content: 'Answer', id: 'assistant-message', role: 'assistant' },
                    ],
                    model: 'glm-5.3',
                    raw_payload: input.raw_payload,
                    title: 'GLM native wrapper',
                }),
                name: 'glm-native.json',
            },
        ]);
        expect(nativeResult.conversations[0]!.artifacts).toEqual(mappingResult.conversations[0]!.artifacts);
    });

    it('should fail closed on unsupported or incomplete GLM report mutations', async () => {
        const directory = '/tmp/glm-safety';
        const reportPath = `${directory}/REPORT.md`;
        const reportStart = '# GLM report\n';
        const fence = '```';
        const toolBlock = (id: string, name: string, args: Record<string, unknown>, status = 'completed') => ({
            content: [{ function: { arguments: JSON.stringify(args), name }, id, type: 'function' }],
            results: [{ status, tool_call_id: id }],
            type: 'tool_calls',
        });
        const parseArtifacts = async (blocks: unknown[]) => {
            const payload = {
                ...createMappingExport({ conversationId: `glm-${blocks.length}`, model: 'glm-5.3', title: 'GLM' }),
                raw_payload: {
                    messages_batch: {
                        data: {
                            'assistant-message': { content_blocks: blocks, role: 'assistant' },
                        },
                    },
                },
            };
            return (await parseWebChatFiles([{ content: JSON.stringify(payload), name: 'glm.json' }])).conversations[0]!
                .artifacts;
        };
        const write = (id: string, content = reportStart, path = reportPath, status = 'completed') =>
            toolBlock(id, 'Write', { content, filepath: path }, status);
        const append = (id: string, command: string, status = 'completed') =>
            toolBlock(id, 'Bash', { command }, status);
        const validAppend = `cat >> ${reportPath} << 'EOF'\n\n# Section\nEOF marker\nEOF\necho "appended"; wc -c ${reportPath}`;

        expect(
            await parseArtifacts([write('write'), append('near-match', `${validAppend}; rm ${reportPath}`)]),
        ).toEqual([]);
        expect(
            await parseArtifacts([
                write('write'),
                append(
                    'unquoted',
                    `cat >> ${reportPath} << EOF\n\n# Section\nEOF\necho "appended"; wc -c ${reportPath}`,
                ),
            ]),
        ).toEqual([]);
        expect(
            await parseArtifacts([
                write('write'),
                append(
                    'final-missing-json',
                    `cd ${directory} && jq -e . report.json > /dev/null && echo "JSON VALID" && cat >> REPORT.md << 'EOF'\n\n# Appendix\nEOF\n` +
                        `cat report.json >> REPORT.md && echo '${fence}' >> REPORT.md && echo "REPORT.md finalized:" && ` +
                        `wc -c REPORT.md report.json && tail -3 REPORT.md`,
                ),
            ]),
        ).toEqual([]);
        expect(await parseArtifacts([write('failed-write', reportStart, reportPath, 'error')])).toEqual([]);
        expect(
            await parseArtifacts([
                write('write'),
                append('append', validAppend),
                write('overwrite', '# Overwritten\n'),
            ]),
        ).toEqual([{ content: '# Overwritten\n', id: 'write', title: 'REPORT.md' }]);
        expect(
            await parseArtifacts([write('write'), append('duplicate', validAppend), append('duplicate', validAppend)]),
        ).toEqual([{ content: `${reportStart}\n# Section\nEOF marker\n`, id: 'write', title: 'REPORT.md' }]);
        expect(
            await parseArtifacts([
                write('write'),
                append('conflict', validAppend),
                append('conflict', validAppend.replace('appended', 'different')),
            ]),
        ).toEqual([]);
        expect(
            await parseArtifacts([
                {
                    content: [
                        { function: { arguments: 'not json', name: 'Write' }, id: 'malformed', type: 'function' },
                    ],
                    results: [{ status: 'completed', tool_call_id: 'malformed' }],
                    type: 'tool_calls',
                },
            ]),
        ).toEqual([]);
    });

    it('should split arrays of conversations and parse generic GLM role-content messages', async () => {
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

        const result = await parseWebChatFiles([{ content: JSON.stringify([first, second]), name: 'many.json' }]);

        expect(result.errors).toEqual([]);
        expect(result.conversations).toHaveLength(2);
        expect(result.conversations[1]).toMatchObject({ platform: 'GLM', sourceConversationId: 'second' });
        expect(result.conversations[1]!.events.map((event) => event.kind)).toEqual(['message', 'reasoning', 'message']);
        expect(result.conversations[1]!.events.at(-1)).toMatchObject({ phase: 'final_answer' });
    });

    it('should keep valid files when another file is invalid', async () => {
        const valid = createMappingExport({
            conversationId: 'valid',
            model: 'gpt-5',
            title: 'Valid',
        });
        const result = await parseWebChatFiles([
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

    it('should classify ChatGPT progress as commentary and tool traffic as tools', async () => {
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

        const result = await parseWebChatFiles([
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

    it('should extract a completed ChatGPT deep-research report from widget state', async () => {
        const reportMessage = {
            author: { role: 'assistant' },
            content: {
                content_type: 'text',
                parts: [
                    {
                        id: 'report-search',
                        input: { query: 'durable identity' },
                        name: 'web_search',
                        type: 'tool_use',
                    },
                    {
                        content: [
                            {
                                title: 'Identity source',
                                url: 'https://example.com/identity',
                            },
                        ],
                        tool_use_id: 'report-search',
                        type: 'tool_result',
                    },
                    '# Deep Research Assignment\n\n## Executive synthesis\n\nThe report body.',
                ],
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

        const result = await parseWebChatFiles([
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
        expect(getToolCalls(conversation.events)).toContainEqual(
            expect.objectContaining({ callId: 'report-search', name: 'web_search' }),
        );
        expect(getToolOutputs(conversation.events)).toContainEqual(
            expect.objectContaining({
                callId: 'report-search',
                outputText: expect.stringContaining('https://example.com/identity'),
            }),
        );
        expect(conversation.events.at(-1)).toMatchObject({
            kind: 'message',
            model: 'gpt-5-6-instant',
            phase: 'final_answer',
            role: 'assistant',
            text: '# Deep Research Assignment\n\n## Executive synthesis\n\nThe report body.',
        });
    });

    it('should expose attached Grok deep-search browsing as tool calls', async () => {
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

        const events = (await parseWebChatFiles([{ content: JSON.stringify(input), name: 'grok.json' }]))
            .conversations[0]!.events;

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

    it('should expose attached Gemini research sources as tool calls', async () => {
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

        const events = (await parseWebChatFiles([{ content: JSON.stringify(input), name: 'gemini.json' }]))
            .conversations[0]!.events;

        expect(getToolCalls(events)).toEqual([
            expect.objectContaining({
                argumentsText: '{"url":"https://example.com/source"}',
                command: 'https://example.com/source',
                name: 'browse_page',
            }),
        ]);

        const ordinary = { ...input, conversation_id: 'gemini-ordinary', raw_payload: ['https://example.com/link'] };
        const ordinaryEvents = (await parseWebChatFiles([{ content: JSON.stringify(ordinary), name: 'gemini.json' }]))
            .conversations[0]!.events;
        expect(getToolCalls(ordinaryEvents)).toEqual([]);
    });

    it('should detect Gemini research source groups without relying on English labels', async () => {
        const input = {
            ...createMappingExport({
                conversationId: 'gemini-localized-research',
                model: 'gemini-3.1-pro-extended',
                title: 'Gemini localized research',
            }),
            raw_payload: [['Recherche de sites...', ['https://example.com/localized-source']]],
        };

        const events = (await parseWebChatFiles([{ content: JSON.stringify(input), name: 'gemini.json' }]))
            .conversations[0]!.events;

        expect(getToolCalls(events)).toEqual([
            expect.objectContaining({
                argumentsText: '{"url":"https://example.com/localized-source"}',
                name: 'browse_page',
            }),
        ]);
    });

    it('should expose attached Qwen deep-research queries as tool calls', async () => {
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

        const events = (await parseWebChatFiles([{ content: JSON.stringify(input), name: 'qwen.json' }]))
            .conversations[0]!.events;

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

    it('should keep repeated Qwen searches as distinct paired tool calls', async () => {
        const research = {
            query: 'same query',
            webSites: [{ title: 'Source', url: 'https://example.com/source' }],
        };
        const input = {
            ...createMappingExport({
                assistantMetadata: { qwen_model: 'qwen3.8-max' },
                conversationId: 'qwen-repeated-research',
                model: 'qwen3.8-max',
                title: 'Qwen repeated research',
            }),
            raw_payload: { deep_research: [research, research] },
        };

        const events = (await parseWebChatFiles([{ content: JSON.stringify(input), name: 'qwen.json' }]))
            .conversations[0]!.events;
        const calls = getToolCalls(events);
        const outputs = getToolOutputs(events);

        expect(calls).toHaveLength(2);
        expect(outputs).toHaveLength(2);
        expect(calls[0]?.callId).not.toBe(calls[1]?.callId);
        expect(outputs.map((output) => output.callId)).toEqual(calls.map((call) => call.callId));
    });

    it('should expose Amazon Nova deep-research browsing with paired search results', async () => {
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

        const conversation = (
            await parseWebChatFiles([{ content: JSON.stringify(input), name: 'Amazon_Nova_Conversation.json' }])
        ).conversations[0]!;
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

    it('should parse multiline Nova searches and pair queued results in order', async () => {
        const input = {
            ...createMappingExport({
                conversationId: 'nova-multiline-research',
                model: 'NOVA_PRO_DEEP_RESEARCH_REASONING_FINE_TUNED',
                title: 'Amazon Nova Conversation',
            }),
            raw_payload: {
                conversationInteractions: [
                    {
                        interactionId: 'nova-parallel',
                        messages: [
                            {
                                content: [
                                    {
                                        reasoningBlocks: [
                                            {
                                                text: [
                                                    '🔍  Searching for: first query',
                                                    '🔍  Searching for: second query',
                                                    '🔍  Retrieved results: first result',
                                                    '🔍  Retrieved results: second result',
                                                ].join('\n'),
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        };

        const events = (await parseWebChatFiles([{ content: JSON.stringify(input), name: 'nova.json' }]))
            .conversations[0]!.events;
        const calls = getToolCalls(events);
        const outputs = getToolOutputs(events);

        expect(calls.map((call) => call.command)).toEqual(['first query', 'second query']);
        expect(outputs.map((output) => output.outputText)).toEqual(['first result', 'second result']);
        expect(outputs.map((output) => output.callId)).toEqual(calls.map((call) => call.callId));
    });

    it('should keep embedded tool events beside their source turn', async () => {
        const input = {
            ...createMappingExport({
                conversationId: 'multi-turn-tools',
                model: 'claude-sonnet-5',
                title: 'Claude multi-turn tools',
            }),
            current_node: 'assistant-2',
            mapping: {
                'assistant-1': {
                    children: ['user-2'],
                    id: 'assistant-1',
                    message: { author: { role: 'assistant' }, content: { parts: ['Answer one'] } },
                    parent: 'tool-1',
                },
                'assistant-2': {
                    children: [],
                    id: 'assistant-2',
                    message: { author: { role: 'assistant' }, content: { parts: ['Answer two'] } },
                    parent: 'user-2',
                },
                root: { children: ['user-1'], id: 'root', message: null, parent: null },
                'tool-1': {
                    children: ['assistant-1'],
                    id: 'tool-1',
                    message: {
                        author: { role: 'assistant' },
                        content: {
                            parts: [
                                {
                                    id: 'turn-one-search',
                                    input: { query: 'first' },
                                    name: 'web_search',
                                    type: 'tool_use',
                                },
                            ],
                        },
                    },
                    parent: 'user-1',
                },
                'user-1': {
                    children: ['tool-1'],
                    id: 'user-1',
                    message: { author: { role: 'user' }, content: { parts: ['Question one'] } },
                    parent: 'root',
                },
                'user-2': {
                    children: ['assistant-2'],
                    id: 'user-2',
                    message: { author: { role: 'user' }, content: { parts: ['Question two'] } },
                    parent: 'assistant-1',
                },
            },
        };

        const events = (await parseWebChatFiles([{ content: JSON.stringify(input), name: 'claude.json' }]))
            .conversations[0]!.events;
        const toolIndex = events.findIndex((event) => event.kind === 'tool_call');
        const firstAnswerIndex = events.findIndex((event) => event.kind === 'message' && event.text === 'Answer one');
        const secondUserIndex = events.findIndex((event) => event.kind === 'message' && event.text === 'Question two');

        expect(toolIndex).toBeGreaterThan(-1);
        expect(toolIndex).toBeLessThan(firstAnswerIndex);
        expect(firstAnswerIndex).toBeLessThan(secondUserIndex);
    });

    it('should expose attached Claude web-search and fetch blocks as tool calls', async () => {
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

        const events = (await parseWebChatFiles([{ content: JSON.stringify(input), name: 'claude.json' }]))
            .conversations[0]!.events;

        expect(getToolCalls(events)).toEqual([
            expect.objectContaining({ callId: 'search-call', command: 'CodeRabbit pricing 2026', name: 'web_search' }),
            expect.objectContaining({
                callId: 'fetch-call',
                command: 'https://www.coderabbit.ai/pricing',
                name: 'web_fetch',
            }),
        ]);
    });

    it('should expose every attached Claude web-search result under tool calls', async () => {
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

        const events = (await parseWebChatFiles([{ content: JSON.stringify(input), name: 'claude.json' }]))
            .conversations[0]!.events;

        expect(getToolOutputs(events)).toEqual([
            expect.objectContaining({
                callId: 'semgrep-search',
                outputText:
                    'Semgrep Pricing in 2026: Open Source vs Team vs Enterprise Costs - DEV Community\nhttps://dev.to/rahulxsingh/semgrep-pricing-in-2026-open-source-vs-team-vs-enterprise-costs-3dic\n\nSemgrep Software Pricing & Plans 2026: See Your Cost\nhttps://www.vendr.com/marketplace/semgrep',
            }),
        ]);
    });

    it('should expose attached ChatGPT research searches as tool calls', async () => {
        const input = createMappingExport({
            conversationId: 'chatgpt-search',
            model: 'gpt-5-6-pro',
            title: 'Research protocol assignment',
        });
        Object.assign(input.mapping.assistant.message, {
            content: { content_type: 'code', text: '{"search_query":[{"q":"primary sources"}]}' },
            recipient: 'web.run',
        });

        const events = (await parseWebChatFiles([{ content: JSON.stringify(input), name: 'chatgpt-search.json' }]))
            .conversations[0]!.events;

        expect(getToolCalls(events)).toEqual([
            expect.objectContaining({ command: 'primary sources', name: 'web.run' }),
        ]);
    });

    it('should expose attached ChatGPT research page opens as tool calls', async () => {
        const input = createMappingExport({
            conversationId: 'chatgpt-open',
            model: 'gpt-5-6-pro',
            title: 'Research protocol',
        });
        Object.assign(input.mapping.assistant.message, {
            content: { content_type: 'code', text: '{"open":[{"ref_id":"https://example.com/report"}]}' },
            recipient: 'web.run',
        });

        const events = (await parseWebChatFiles([{ content: JSON.stringify(input), name: 'chatgpt-open.json' }]))
            .conversations[0]!.events;

        expect(getToolCalls(events)).toEqual([
            expect.objectContaining({ command: 'https://example.com/report', name: 'web.run' }),
        ]);
    });

    it('should expose the attached ChatGPT Deep Research app launch as a tool call', async () => {
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

        const events = (await parseWebChatFiles([{ content: JSON.stringify(input), name: 'deep-research.json' }]))
            .conversations[0]!.events;

        expect(getToolCalls(events)).toEqual([
            expect.objectContaining({ command: 'Deep Research App_start', name: 'api_tool.call_tool' }),
        ]);
    });

    it('should retain imported conversations without serializing the normalized conversation again', async () => {
        const input = createMappingExport({
            conversationId: 'retention-size',
            model: 'gpt-5-6-pro',
            title: 'Retention size',
        });
        const content = JSON.stringify(input);
        const originalStringify = JSON.stringify;
        JSON.stringify = ((value: unknown, ...args: unknown[]) => {
            if (value && typeof value === 'object' && 'events' in value && 'messageCount' in value) {
                throw new Error('normalized conversation was reserialized');
            }
            return originalStringify(value, ...(args as [never, never]));
        }) as typeof JSON.stringify;

        try {
            const result = await importWebChatFiles([{ content, name: 'retention.json' }]);
            expect(result.errors).toEqual([]);
            expect(getImportedWebChat(result.conversations[0]!.id)).not.toBeNull();
        } finally {
            JSON.stringify = originalStringify;
        }
    });
});
