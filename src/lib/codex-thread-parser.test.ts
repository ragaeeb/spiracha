import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCodexBrowserFixture } from './codex-test-helpers';
import { parseCodexTranscriptFile } from './codex-thread-parser';

const tempPaths: string[] = [];

afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

describe('parseCodexTranscriptFile', () => {
    it('should parse structured transcript events and summary stats from a rich Codex session file', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-thread-parser-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const transcript = await parseCodexTranscriptFile(fixture.threads[0]!.sessionFile);

        expect(transcript.sessionMeta.id).toBe(fixture.threads[0]!.threadId);
        expect(transcript.sessionMeta.threadSource).toBe('user');
        expect(transcript.turnContexts).toHaveLength(1);
        expect(transcript.stats.assistantMessageCount).toBe(2);
        expect(transcript.stats.execCommandCount).toBe(1);
        expect(transcript.stats.toolCallCount).toBe(2);
        expect(transcript.stats.webSearchEventCount).toBe(2);
        expect(transcript.stats.finalAnswerCount).toBe(1);

        const assistantMessage = transcript.events.find(
            (event) => event.kind === 'message' && event.role === 'assistant' && event.phase === 'final_answer',
        );
        expect(assistantMessage && 'model' in assistantMessage ? assistantMessage.model : null).toBe('gpt-5.4');

        const execCall = transcript.events.find((event) => event.kind === 'tool_call' && event.name === 'exec_command');
        expect(execCall && 'command' in execCall ? execCall.command : null).toBe('rtk bun test');
        expect(execCall && 'workdir' in execCall ? execCall.workdir : null).toBe('/Users/example/workspace/spiracha');

        const reasoning = transcript.events.find((event) => event.kind === 'reasoning');
        expect(reasoning?.hasEncryptedContent).toBe(true);
        expect(reasoning?.summary).toEqual(['Summarized reasoning step']);

        const taskComplete = transcript.events.find((event) => event.kind === 'task_complete');
        expect(taskComplete?.durationMs).toBe(22845);
        expect(taskComplete?.timeToFirstTokenMs).toBe(2227);
    });

    it('should support bounded preview parsing without raw payloads for oversized transcripts', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-thread-parser-preview-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const transcript = await parseCodexTranscriptFile(fixture.threads[0]!.sessionFile, {
            includeRaw: false,
            maxEvents: 2,
            maxTurnContexts: 0,
        });

        expect(transcript.events).toHaveLength(2);
        expect(transcript.events[0]?.raw).toEqual({});
        expect(transcript.turnContexts).toHaveLength(0);
        expect(transcript.isPartial).toBe(true);
        expect(transcript.rawIncluded).toBe(false);
        expect(transcript.statsArePartial).toBe(true);
    });

    it('should omit messages that contain no renderable text blocks', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-thread-parser-empty-message-test-'));
        tempPaths.push(tempRoot);
        const sessionFile = path.join(tempRoot, 'empty-message.jsonl');
        await Bun.write(
            sessionFile,
            JSON.stringify({
                payload: {
                    content: [{ audio_url: 'https://example.invalid/audio.wav', type: 'input_audio' }],
                    role: 'assistant',
                    type: 'message',
                },
                type: 'response_item',
            }),
        );

        const transcript = await parseCodexTranscriptFile(sessionFile);

        expect(transcript.events).toEqual([]);
        expect(transcript.stats.assistantMessageCount).toBe(0);
    });

    it('should support filtered tail preview parsing for oversized transcripts', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-thread-parser-tail-preview-test-'));
        tempPaths.push(tempRoot);
        const sessionFile = path.join(tempRoot, 'tail-preview.jsonl');
        await Bun.write(
            sessionFile,
            [
                JSON.stringify({
                    payload: { message: 'first user prompt', type: 'user_message' },
                    timestamp: '2026-07-07T12:00:00.000Z',
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: { message: 'first assistant answer', phase: 'final_answer', type: 'agent_message' },
                    timestamp: '2026-07-07T12:00:01.000Z',
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: { message: 'second user prompt', type: 'user_message' },
                    timestamp: '2026-07-07T12:00:02.000Z',
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: { message: 'second assistant answer', phase: 'final_answer', type: 'agent_message' },
                    timestamp: '2026-07-07T12:00:03.000Z',
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: { message: 'third assistant answer', phase: 'final_answer', type: 'agent_message' },
                    timestamp: '2026-07-07T12:00:04.000Z',
                    type: 'response_item',
                }),
            ].join('\n'),
        );

        const transcript = await parseCodexTranscriptFile(sessionFile, {
            eventFilter: (event) => event.kind === 'message' && event.role === 'assistant',
            includeRaw: false,
            maxTurnContexts: 0,
            tailEventLimit: 2,
        });

        expect(transcript.events.map((event) => (event.kind === 'message' ? event.text : null))).toEqual([
            'second assistant answer',
            'third assistant answer',
        ]);
        expect(transcript.events.map((event) => event.sequence)).toEqual([3, 4]);
        expect(transcript.events.every((event) => Object.keys(event.raw).length === 0)).toBe(true);
        expect(transcript.stats.assistantMessageCount).toBe(2);
        expect(transcript.stats.userMessageCount).toBe(0);
        expect(transcript.isPartial).toBe(true);
        expect(transcript.statsArePartial).toBe(true);
    });

    it('should mark malformed exec_command arguments so callers can distinguish parse failure from missing data', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-thread-parser-invalid-args-test-'));
        tempPaths.push(tempRoot);
        const sessionFile = path.join(tempRoot, 'invalid-args.jsonl');
        await Bun.write(
            sessionFile,
            [
                JSON.stringify({
                    payload: {
                        arguments: '{oops',
                        name: 'exec_command',
                        type: 'function_call',
                    },
                    timestamp: '2026-05-24T12:00:00.000Z',
                    type: 'response_item',
                }),
            ].join('\n'),
        );

        const transcript = await parseCodexTranscriptFile(sessionFile);
        const toolCall = transcript.events[0];

        expect(toolCall?.kind).toBe('tool_call');
        expect(toolCall && 'argumentsParseFailed' in toolCall ? toolCall.argumentsParseFailed : null).toBe(true);
    });

    it('should parse custom tool calls alongside legacy function calls', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-thread-parser-custom-tools-test-'));
        tempPaths.push(tempRoot);
        const sessionFile = path.join(tempRoot, 'custom-tools.jsonl');
        await Bun.write(
            sessionFile,
            [
                JSON.stringify({
                    payload: {
                        call_id: 'custom-call-1',
                        input: 'const result = await tools.exec_command({ cmd: "rtk bun test" });',
                        name: 'exec',
                        type: 'custom_tool_call',
                    },
                    timestamp: '2026-07-17T12:00:00.000Z',
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: {
                        call_id: 'custom-call-1',
                        output: [
                            { text: 'Script completed\nWall time 0.1 seconds\nOutput:', type: 'input_text' },
                            { text: '12 tests passed', type: 'input_text' },
                        ],
                        type: 'custom_tool_call_output',
                    },
                    timestamp: '2026-07-17T12:00:01.000Z',
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: {
                        arguments: '{"timeout_ms":30000}',
                        call_id: 'wait-call-1',
                        name: 'wait',
                        type: 'function_call',
                    },
                    timestamp: '2026-07-17T12:00:02.000Z',
                    type: 'response_item',
                }),
            ].join('\n'),
        );

        const transcript = await parseCodexTranscriptFile(sessionFile);

        expect(transcript.events).toMatchObject([
            {
                argumentsParseFailed: false,
                argumentsText: 'const result = await tools.exec_command({ cmd: "rtk bun test" });',
                callId: 'custom-call-1',
                command: 'const result = await tools.exec_command({ cmd: "rtk bun test" });',
                kind: 'tool_call',
                name: 'exec',
                workdir: null,
            },
            {
                callId: 'custom-call-1',
                kind: 'tool_output',
                outputText: 'Script completed\nWall time 0.1 seconds\nOutput:\n12 tests passed',
            },
            {
                callId: 'wait-call-1',
                kind: 'tool_call',
                name: 'wait',
            },
        ]);
        expect(transcript.stats).toMatchObject({
            execCommandCount: 1,
            toolCallCount: 2,
            toolOutputCount: 1,
        });
    });

    it('should parse token counts and web searches from event messages', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-thread-parser-event-messages-test-'));
        tempPaths.push(tempRoot);
        const sessionFile = path.join(tempRoot, 'event-messages.jsonl');
        await Bun.write(
            sessionFile,
            [
                JSON.stringify({
                    payload: {
                        info: { total_token_usage: { total_tokens: 42 } },
                        type: 'token_count',
                    },
                    timestamp: '2026-07-17T12:00:00.000Z',
                    type: 'event_msg',
                }),
                JSON.stringify({
                    payload: {
                        call_id: 'search-1',
                        query: 'Codex transcript format',
                        type: 'web_search_call',
                    },
                    timestamp: '2026-07-17T12:00:01.000Z',
                    type: 'event_msg',
                }),
                JSON.stringify({
                    payload: {
                        call_id: 'search-1',
                        status: 'completed',
                        type: 'web_search_end',
                    },
                    timestamp: '2026-07-17T12:00:02.000Z',
                    type: 'event_msg',
                }),
            ].join('\n'),
        );

        const transcript = await parseCodexTranscriptFile(sessionFile);

        expect(transcript.events).toMatchObject([
            { kind: 'token_count' },
            { callId: 'search-1', kind: 'web_search', phase: 'call', query: 'Codex transcript format' },
            { callId: 'search-1', kind: 'web_search', phase: 'end', status: 'completed' },
        ]);
        expect(transcript.stats.webSearchEventCount).toBe(2);
    });

    it('should strip Codex memory citation XML from visible message text', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-thread-parser-memory-citation-test-'));
        tempPaths.push(tempRoot);
        const sessionFile = path.join(tempRoot, 'memory-citation.jsonl');
        const memoryCitation = `<oai-mem-citation>
<citation_entries>
MEMORY.md:439-441|note=[corpus fixture source of truth and validation guidance]
MEMORY.md:609-611|note=[ushman e2e fixture and validation guidance]
</citation_entries>
</oai-mem-citation>`;
        const memoryCitationWithRollouts = `<oai-mem-citation>
<citation_entries>
MEMORY.md:1-2|note=[project guidance]
</citation_entries>
<rollout_ids>
019c6e27-e55b-73d1-87d8-4e01f1f75043
</rollout_ids>
</oai-mem-citation>`;
        await Bun.write(
            sessionFile,
            [
                JSON.stringify({
                    payload: {
                        message: `Implemented the requested fix.\n\n${memoryCitationWithRollouts}`,
                        type: 'agent_message',
                    },
                    timestamp: '2026-07-06T12:00:00.000Z',
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: {
                        content: [
                            {
                                text: memoryCitation,
                                type: 'text',
                            },
                        ],
                        role: 'assistant',
                        type: 'message',
                    },
                    timestamp: '2026-07-06T12:00:01.000Z',
                    type: 'response_item',
                }),
            ].join('\n'),
        );

        const transcript = await parseCodexTranscriptFile(sessionFile);

        expect(transcript.events[0]).toMatchObject({
            kind: 'message',
            role: 'assistant',
            text: 'Implemented the requested fix.',
        });
        expect(transcript.events).toHaveLength(1);
    });

    it('should strip Codex app directive lines from visible assistant text', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-thread-parser-directives-test-'));
        tempPaths.push(tempRoot);
        const sessionFile = path.join(tempRoot, 'directives.jsonl');
        await Bun.write(
            sessionFile,
            [
                JSON.stringify({
                    payload: {
                        message: [
                            'Implemented the fix.',
                            '::git-stage{cwd="."}',
                            '::git-commit{cwd="."}',
                            '::git-stage{cwd="~/workspace/ushman-e2e"}',
                            '::git-commit{cwd="~/workspace/ushman-e2e"}',
                        ].join('\n'),
                        phase: 'final_answer',
                        type: 'agent_message',
                    },
                    timestamp: '2026-07-08T12:00:00.000Z',
                    type: 'response_item',
                }),
            ].join('\n'),
        );

        const transcript = await parseCodexTranscriptFile(sessionFile);

        expect(transcript.events[0]).toMatchObject({
            kind: 'message',
            role: 'assistant',
            text: 'Implemented the fix.',
        });
    });
});
