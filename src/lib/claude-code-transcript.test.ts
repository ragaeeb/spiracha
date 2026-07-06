import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ClaudeCodeSessionTranscript } from './claude-code-exporter-types';
import { renderClaudeCodeTranscript } from './claude-code-transcript';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const writeHeadroomReplacementArchive = async (
    archiveDir: string,
    replacement: { originalText: string; rewrittenText: string; sessionId: string },
) => {
    await mkdir(archiveDir, { recursive: true });
    await Bun.write(
        path.join(archiveDir, '2026-07-06.jsonl'),
        `${JSON.stringify({
            archive_id: 'claude-replacement',
            client: 'claude-code',
            endpoint: '/v1/messages',
            event_type: 'replacement',
            model: 'claude-sonnet-4-5',
            original_text: replacement.originalText,
            original_text_sha256: sha256(replacement.originalText),
            path: '$."messages"[0]."content"',
            provider: 'anthropic',
            request_id: null,
            rewritten_text: replacement.rewrittenText,
            rewritten_text_sha256: sha256(replacement.rewrittenText),
            schema_version: 1,
            session_id: replacement.sessionId,
            timestamp: '2026-07-06T12:00:00+0000',
            timestamp_unix: 1_783_340_800,
            tokens_saved: 21,
            transforms: ['markdown'],
            transport: 'http',
        })}\n`,
    );
};

const transcript: ClaudeCodeSessionTranscript = {
    entries: [
        {
            cwd: '/Users/example/workspace/ushman-corpus',
            entryId: 'u1',
            parts: [
                {
                    raw: { text: 'Review Descope-Class Vendor-Detection' },
                    text: 'Review Descope-Class Vendor-Detection',
                    type: 'text',
                },
            ],
            raw: { type: 'user' },
            role: 'user',
            timestamp: '2026-06-01T10:00:00.000Z',
            type: 'user',
        },
        {
            cwd: '/Users/example/workspace/ushman-corpus',
            entryId: 'a1',
            model: 'claude-sonnet-4-5',
            parts: [
                {
                    raw: { thinking: 'Need inspect first.' },
                    text: 'Need inspect first.',
                    type: 'thinking',
                },
                {
                    argumentsText: '{\n  "command": "rg vendor"\n}',
                    raw: { name: 'Bash' },
                    toolName: 'Bash',
                    toolUseId: 'toolu_1',
                    type: 'tool_use',
                },
                {
                    raw: { text: 'Vendor detection is present.' },
                    text: 'Vendor detection is present.',
                    type: 'text',
                },
            ],
            raw: { type: 'assistant' },
            role: 'assistant',
            timestamp: '2026-06-01T10:00:04.000Z',
            type: 'assistant',
        },
        {
            cwd: '/Users/example/workspace/ushman-corpus',
            entryId: 'u2',
            parts: [
                {
                    isError: false,
                    outputText: 'src/vendor.ts: match',
                    raw: { tool_use_id: 'toolu_1' },
                    toolUseId: 'toolu_1',
                    type: 'tool_result',
                },
            ],
            raw: { type: 'user' },
            role: 'user',
            timestamp: '2026-06-01T10:00:05.000Z',
            type: 'user',
        },
    ],
    rawEvents: [],
    renderablePartCount: 5,
    session: {
        assistantMessageCount: 1,
        attachmentCount: 0,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 3,
        createdAtIso: '2026-06-01T10:00:00.000Z',
        createdAtMs: 1_780_307_200_000,
        cwd: '/Users/example/workspace/ushman-corpus',
        filePath: '/Users/example/.claude/projects/-Users-example-workspace-ushman-corpus/session-a.jsonl',
        gitBranch: 'main',
        inputTokens: 10,
        lastActiveAtIso: '2026-06-01T10:00:05.000Z',
        lastActiveAtMs: 1_780_307_205_000,
        messageCount: 3,
        model: 'claude-sonnet-4-5',
        outputTokens: 4,
        renderablePartCount: 5,
        sessionId: 'session-a',
        title: 'Review Descope-Class Vendor-Detection',
        toolCallCount: 1,
        toolResultCount: 1,
        totalTokens: 19,
        userMessageCount: 2,
        version: '2.1.148',
        workspaceKey: 'project:-Users-example-workspace-ushman-corpus',
        workspaceLabel: 'ushman-corpus',
        worktree: '/Users/example/workspace/ushman-corpus',
    },
};

describe('renderClaudeCodeTranscript', () => {
    it('should render metadata, reasoning, tool calls, tool outputs, and messages as markdown', () => {
        const rendered = renderClaudeCodeTranscript(transcript, {
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
        });

        expect(rendered).toContain('# Review Descope-Class Vendor-Detection');
        expect(rendered).toContain('exported_from: "claude_code_local_jsonl"');
        expect(rendered).toContain('## User');
        expect(rendered).toContain('Review Descope-Class Vendor-Detection');
        expect(rendered).toContain('## Reasoning');
        expect(rendered).toContain('Need inspect first.');
        expect(rendered).toContain('## Tool Call');
        expect(rendered).toContain('Tool: `Bash`');
        expect(rendered).toContain('"command": "rg vendor"');
        expect(rendered).toContain('## Tool Output');
        expect(rendered).toContain('src/vendor.ts: match');
        expect(rendered).toContain('Vendor detection is present.');
    });

    it('should omit optional metadata, commentary, and tools', () => {
        const rendered = renderClaudeCodeTranscript(transcript, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'md',
        });

        expect(rendered).not.toContain('exported_from');
        expect(rendered).not.toContain('Need inspect first.');
        expect(rendered).not.toContain('Tool:');
        expect(rendered).toContain('Vendor detection is present.');
    });

    it('should render true plain text when requested', () => {
        const rendered = renderClaudeCodeTranscript(transcript, {
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'txt',
        });

        expect(rendered).toContain('Review Descope-Class Vendor-Detection\n');
        expect(rendered).toContain('=====================================');
        expect(rendered).toContain('Tool: Bash');
        expect(rendered).not.toContain('```');
    });

    it('should omit assistant tool-use lead-ins when commentary is disabled', () => {
        const rendered = renderClaudeCodeTranscript(
            {
                ...transcript,
                entries: [
                    transcript.entries[0]!,
                    {
                        cwd: '/Users/example/workspace/ushman-corpus',
                        entryId: 'a1',
                        model: 'claude-opus-4-8',
                        parts: [
                            {
                                raw: { text: "I'll start by reading the roadmap" },
                                text: "I'll start by reading the roadmap",
                                type: 'text',
                            },
                            {
                                argumentsText: '{\n  "file_path": "MILESTONE-ROADMAP.md"\n}',
                                raw: { name: 'Read' },
                                toolName: 'Read',
                                toolUseId: 'toolu_roadmap',
                                type: 'tool_use',
                            },
                        ],
                        raw: { message: { stop_reason: 'tool_use' }, type: 'assistant' },
                        role: 'assistant',
                        timestamp: '2026-06-01T10:00:01.000Z',
                        type: 'assistant',
                    },
                    {
                        cwd: '/Users/example/workspace/ushman-corpus',
                        entryId: 'a2',
                        model: 'claude-opus-4-8',
                        parts: [
                            {
                                raw: { text: 'All four proposals are written...' },
                                text: 'All four proposals are written...',
                                type: 'text',
                            },
                        ],
                        raw: { message: { stop_reason: 'end_turn' }, type: 'assistant' },
                        role: 'assistant',
                        timestamp: '2026-06-01T10:00:02.000Z',
                        type: 'assistant',
                    },
                ],
            },
            {
                includeCommentary: false,
                includeMetadata: false,
                includeTools: false,
                outputFormat: 'md',
            },
        );

        expect(rendered).not.toContain("I'll start by reading the roadmap");
        expect(rendered).not.toContain('Tool:');
        expect(rendered).toContain('All four proposals are written...');
    });

    it('should rehydrate Headroom-compressed Claude markdown during export', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-headroom-rehydration-test-'));
        try {
            const archiveDir = path.join(tempRoot, 'headroom');
            const compressedText = 'Original review request: check vendor detection and summarize.';
            const originalMarkdown = '# Original review request\n\n- check vendor detection\n- summarize findings';
            await writeHeadroomReplacementArchive(archiveDir, {
                originalText: originalMarkdown,
                rewrittenText: compressedText,
                sessionId: transcript.session.sessionId,
            });

            const rendered = renderClaudeCodeTranscript(
                {
                    ...transcript,
                    entries: [
                        {
                            cwd: transcript.session.cwd,
                            entryId: 'u-headroom',
                            parts: [
                                {
                                    raw: { text: compressedText },
                                    text: compressedText,
                                    type: 'text',
                                },
                            ],
                            raw: { type: 'user' },
                            role: 'user',
                            timestamp: '2026-06-01T10:00:00.000Z',
                            type: 'user',
                        },
                    ],
                },
                {
                    archiveDir,
                    includeCommentary: true,
                    includeMetadata: true,
                    includeTools: true,
                    outputFormat: 'md',
                },
            );

            expect(rendered).toContain(originalMarkdown);
            expect(rendered).not.toContain(compressedText);
            expect(rendered).toContain('headroom_rehydrated: true');
        } finally {
            await rm(tempRoot, { force: true, recursive: true });
        }
    });
});
