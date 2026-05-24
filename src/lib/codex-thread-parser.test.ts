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
});
