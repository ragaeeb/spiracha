import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createCodexFixture } from './lib/codex-test-helpers';

const tempPaths: string[] = [];

afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

describe('mcp server protocol', () => {
    it('completes initialize, tools/list, and export_codex_chats round-trips', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-mcp-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexFixture(tempRoot);

        const transport = new StdioClientTransport({
            args: ['run', './src/mcp-server.ts'],
            command: 'bun',
            cwd: process.cwd(),
            stderr: 'pipe',
        });
        const client = new Client(
            {
                name: 'codex-chats-test-client',
                version: '1.0.0',
            },
            {
                capabilities: {},
            },
        );

        try {
            await client.connect(transport);

            const tools = await client.listTools();
            const toolNames = tools.tools.map((tool) => tool.name).sort();
            expect(toolNames).toEqual(['export_claude_transcript', 'export_codex_chats']);

            const result = await client.callTool({
                arguments: {
                    dbPath: fixture.dbPath,
                    deeplinks: [`codex://threads/${fixture.threadId}`],
                    includeCommentary: true,
                    includeTools: true,
                    inputDir: fixture.inputDir,
                    outputDir: fixture.outputDir,
                    outputFormat: 'txt',
                },
                name: 'export_codex_chats',
            });

            const content = result.content as Array<{ type: string; text: string }>;
            expect(content[0]?.type).toBe('text');
            const payload = JSON.parse(content[0]!.text);
            expect(payload.exportedCount).toBe(1);
            expect(payload.missingThreadIds).toEqual([]);
            expect(payload.files[0].threadId).toBe(fixture.threadId);
        } finally {
            await transport.close();
        }
    });

    it('rejects unscoped codex exports over MCP', async () => {
        const transport = new StdioClientTransport({
            args: ['run', './src/mcp-server.ts'],
            command: 'bun',
            cwd: process.cwd(),
            stderr: 'pipe',
        });
        const client = new Client(
            {
                name: 'codex-chats-test-client',
                version: '1.0.0',
            },
            {
                capabilities: {},
            },
        );

        try {
            await client.connect(transport);
            const result = await client.callTool({
                arguments: {},
                name: 'export_codex_chats',
            });

            expect(result.isError).toBe(true);
            const content = result.content as Array<{ type: string; text: string }>;
            expect(content[0]?.type).toBe('text');
            expect(content[0]?.text).toContain('Provide at least one deeplink, project, or cwd filter');
        } finally {
            await transport.close();
        }
    });
});
