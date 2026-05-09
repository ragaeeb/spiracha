#!/usr/bin/env bun

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { AnySchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { z } from 'zod';
import { runClaudeExport } from './lib/claude-exporter';
import {
    DEFAULT_DB_PATH,
    DEFAULT_INPUT_DIR,
    parseThreadSelectionArg,
    resolveDefaultOutputDir,
    runCodexExport,
} from './lib/codex-exporter';
import { expandHome } from './lib/shared';

const server = new McpServer({
    name: 'codex-chats-export',
    version: '0.1.0',
});

const exportCodexChatsInputSchema = {
    cwd: z.string().optional().describe('Optional exact cwd filter'),
    dbPath: z.string().optional().describe('Optional override for the Codex SQLite database'),
    deeplinks: z.array(z.string()).optional().describe('Optional Codex deeplinks like codex://threads/<thread-id>'),
    flat: z.boolean().optional().describe('Write output into a single flat folder'),
    includeTools: z.boolean().optional().describe('Include exec_command tool logs'),
    inputDir: z.string().optional().describe('Optional override for the Codex sessions directory'),
    optimized: z.boolean().optional().describe('Suppress metadata and optimize for compact text'),
    outputDir: z.string().optional().describe('Optional output directory'),
    outputFormat: z.enum(['md', 'txt']).optional().describe('Output format'),
    project: z.string().optional().describe('Optional project name matched against path basename'),
} as unknown as Record<string, AnySchema>;

const exportClaudeTranscriptInputSchema = {
    includeTools: z.boolean().optional().describe('Include Bash tool calls and outputs'),
    inputPath: z.string().describe('Path to a Claude transcript .jsonl file or export directory'),
    outputFormat: z.enum(['md', 'txt']).optional().describe('Output format'),
    outputPath: z.string().optional().describe('Optional output file path or directory'),
} as unknown as Record<string, AnySchema>;

server.registerTool(
    'export_codex_chats',
    {
        description: 'Export Codex chats by deeplink, project name, or cwd to markdown or plain text.',
        inputSchema: exportCodexChatsInputSchema,
    },
    async (args: any) => {
        const threadIds = parseThreadSelections(args.deeplinks ?? []);
        const cwdFilter = args.cwd ? expandHome(args.cwd) : null;

        if (threadIds.length === 0 && !args.project && !cwdFilter) {
            throw new Error(
                'Provide at least one deeplink, project, or cwd filter to avoid exporting the entire Codex history by accident.',
            );
        }

        const result = await runCodexExport({
            cwdFilter,
            dbPath: expandHome(args.dbPath ?? DEFAULT_DB_PATH),
            flat: args.flat ?? false,
            includeTools: args.includeTools ?? false,
            inputDir: expandHome(args.inputDir ?? DEFAULT_INPUT_DIR),
            optimized: args.optimized ?? false,
            outputDir: args.outputDir ? expandHome(args.outputDir) : resolveDefaultOutputDir(cwdFilter),
            outputFormat: args.outputFormat ?? 'md',
            projectFilter: args.project ?? null,
            threadIds,
        });

        return {
            content: [
                {
                    text: JSON.stringify(
                        {
                            exportedCount: result.exportedCount,
                            files: result.files,
                            missingThreadIds: result.missingThreadIds,
                            outputDir: result.outputDir,
                        },
                        null,
                        2,
                    ),
                    type: 'text',
                },
            ],
        };
    },
);

server.registerTool(
    'export_claude_transcript',
    {
        description: 'Export a Claude Code transcript JSONL or export directory to markdown or plain text.',
        inputSchema: exportClaudeTranscriptInputSchema,
    },
    async (args: any) => {
        const result = await runClaudeExport({
            includeTools: args.includeTools ?? false,
            inputPath: expandHome(args.inputPath),
            outputFormat: args.outputFormat ?? 'md',
            outputPath: args.outputPath ? expandHome(args.outputPath) : null,
        });

        return {
            content: [
                {
                    text: JSON.stringify(result, null, 2),
                    type: 'text',
                },
            ],
        };
    },
);

const main = async () => {
    const transport = new StdioServerTransport();
    await server.connect(transport);
};

const parseThreadSelections = (deeplinks: string[]): string[] => {
    return deeplinks.map((deeplink) => {
        const threadId = parseThreadSelectionArg(deeplink);
        if (!threadId) {
            throw new Error(`Invalid Codex deeplink: ${deeplink}. Expected codex://threads/<thread-id>`);
        }

        return threadId;
    });
};

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
});
