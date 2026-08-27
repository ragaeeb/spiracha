#!/usr/bin/env bun
import path from 'node:path';
import process from 'node:process';
import { createConversationClient } from '../src/client';
import { CONVERSATION_SOURCES } from '../src/lib/conversation-data/types';
import { runProductionUiServer } from '../src/lib/production-ui-server';
import type {
    ConversationClient,
    ConversationMessageSelector,
} from '../src/client';
import type { ConversationSource, EvidenceLens } from '../src/lib/conversation-data/types';

export const SPIRACHA_USAGE = `Usage: spiracha <command> [options]

Commands:
  serve                         Start the local UI server
  list --cwd <path>             List conversations as JSON
  get <ref>                     Get one conversation as JSON
  export <ref> [--raw] [--output <path>]
                                Export Markdown or the original JSON transcript
  evidence <ref> --lens <file> [--output <path>]
                                Export focused evidence as Markdown

List options:
  --source <a,b>                Filter by one or more sources
  --limit <1-200>               Limit the page size
  --cursor <cursor>             Continue keyset pagination
  --include-messages            Include selected message bodies
  --message-selector <selector> all, last_assistant, or last_final_answer
  --updated-after-ms <ms>       Include conversations updated after this time
  --updated-before-ms <ms>      Include conversations updated before this time

Get/Markdown export options:
  --message-selector <selector> all, last_assistant, or last_final_answer

Run spiracha --help for this message.
`;

export type SpirachaCliCommand =
    | { command: 'help' }
    | { command: 'serve' }
    | {
          command: 'list';
          cwd: string;
          cursor?: string;
          includeMessages?: boolean;
          limit?: number;
          messageSelector?: ConversationMessageSelector;
          sources?: ConversationSource[];
          updatedAfterMs?: number;
          updatedBeforeMs?: number;
      }
    | { command: 'get'; messageSelector?: ConversationMessageSelector; ref: string }
    | { command: 'export'; messageSelector?: ConversationMessageSelector; output?: string; raw?: true; ref: string }
    | {
          command: 'evidence';
          lens: string;
          output?: string;
          ref: string;
      };

const isConversationSource = (value: string): value is ConversationSource =>
    (CONVERSATION_SOURCES as readonly string[]).includes(value);

const isMessageSelector = (value: string): value is ConversationMessageSelector =>
    value === 'all' || value === 'last_assistant' || value === 'last_final_answer';

const requiredValue = (args: string[], index: number, option: string): string => {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for option "${option}".`);
    }
    return value;
};

const numberValue = (value: string, option: string): number => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`Option "${option}" must be a non-negative integer.`);
    }
    return parsed;
};

const limitValue = (value: string): number => {
    const limit = numberValue(value, '--limit');
    if (limit < 1 || limit > 200) {
        throw new Error('Option "--limit" must be an integer from 1 to 200.');
    }
    return limit;
};

const sourceValue = (value: string, option: string): ConversationSource => {
    if (!isConversationSource(value)) {
        throw new Error(`Unknown conversation source "${value}" for option "${option}".`);
    }
    return value;
};

export const parseSpirachaCliArgs = (args: string[]): SpirachaCliCommand => {
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
        return { command: 'help' };
    }

    const command = args[0];
    if (command === 'serve') {
        if (args.length !== 1) {
            throw new Error('The serve command does not accept options.');
        }
        return { command };
    }
    if (command !== 'list' && command !== 'get' && command !== 'export' && command !== 'evidence') {
        throw new Error(`Unknown command "${command}".`);
    }

    const options: Record<string, unknown> = {};
    const optionStart = command === 'list' ? 1 : 2;
    if (command !== 'list' && (!args[1] || args[1].startsWith('--'))) {
        throw new Error('Missing required argument "<ref>".');
    }
    for (let index = optionStart; index < args.length; index += 1) {
        const option = args[index];
        if (!option.startsWith('--')) {
            throw new Error(`Unexpected argument "${option}".`);
        }

        if (option === '--include-messages') {
            if (command !== 'list') {
                throw new Error(`Unknown option "${option}".`);
            }
            options.includeMessages = true;
            continue;
        }
        if (option === '--raw') {
            if (command !== 'export') {
                throw new Error(`Unknown option "${option}".`);
            }
            options.raw = true;
            continue;
        }

        const value = requiredValue(args, index, option);
        index += 1;
        switch (option) {
            case '--cwd':
                if (command !== 'list') throw new Error(`Unknown option "${option}".`);
                options.cwd = value;
                break;
            case '--cursor':
                if (command !== 'list') throw new Error(`Unknown option "${option}".`);
                options.cursor = value;
                break;
            case '--lens':
                if (command !== 'evidence') {
                    throw new Error(`Unknown option "${option}".`);
                }
                options.lens = value;
                break;
            case '--limit':
                if (command !== 'list') throw new Error(`Unknown option "${option}".`);
                options.limit = limitValue(value);
                break;
            case '--message-selector':
                if (command === 'evidence') {
                    throw new Error(`Unknown option "${option}".`);
                }
                if (!isMessageSelector(value)) {
                    throw new Error(`Unknown message selector "${value}".`);
                }
                options.messageSelector = value;
                break;
            case '--source':
                if (command !== 'list') {
                    throw new Error(`Unknown option "${option}".`);
                }
                options.source = value;
                break;
            case '--output':
                if (command !== 'export' && command !== 'evidence') {
                    throw new Error(`Unknown option "${option}".`);
                }
                options.output = value;
                break;
            case '--updated-after-ms':
                if (command !== 'list') throw new Error(`Unknown option "${option}".`);
                options.updatedAfterMs = numberValue(value, option);
                break;
            case '--updated-before-ms':
                if (command !== 'list') throw new Error(`Unknown option "${option}".`);
                options.updatedBeforeMs = numberValue(value, option);
                break;
            default:
                throw new Error(`Unknown option "${option}".`);
        }
    }

    if (command === 'list') {
        const sourceText = options.source as string | undefined;
        const cwd = options.cwd as string | undefined;
        if (!cwd) throw new Error('Missing required option "--cwd".');
        if (!path.isAbsolute(cwd)) throw new Error('Option "--cwd" must be an absolute path.');
        return {
            command,
            cwd,
            ...(options.cursor === undefined ? {} : { cursor: options.cursor as string }),
            ...(options.includeMessages === undefined ? {} : { includeMessages: options.includeMessages as boolean }),
            ...(options.limit === undefined ? {} : { limit: options.limit as number }),
            ...(options.messageSelector === undefined
                ? {}
                : { messageSelector: options.messageSelector as ConversationMessageSelector }),
            ...(sourceText === undefined
                ? {}
                : {
                      sources: sourceText.split(',').map((source) => sourceValue(source.trim(), '--source')),
                  }),
            ...(options.updatedAfterMs === undefined ? {} : { updatedAfterMs: options.updatedAfterMs as number }),
            ...(options.updatedBeforeMs === undefined ? {} : { updatedBeforeMs: options.updatedBeforeMs as number }),
        };
    }

    const ref = args[1];
    if (command === 'evidence') {
        if (options.lens === undefined) {
            throw new Error('Missing required option "--lens".');
        }
        return {
            command,
            lens: options.lens as string,
            ...(options.output === undefined ? {} : { output: options.output as string }),
            ref,
        };
    }

    if (command === 'export' && options.raw && options.messageSelector) {
        throw new Error('Raw export does not accept "--message-selector".');
    }

    return {
        command,
        ...(options.messageSelector === undefined
            ? {}
            : { messageSelector: options.messageSelector as ConversationMessageSelector }),
        ...(options.output === undefined ? {} : { output: options.output as string }),
        ...(options.raw === undefined ? {} : { raw: true as const }),
        ref,
    };
};

type SpirachaCliIo = {
    stderr: (text: string) => void;
    stdout: (content: string | Uint8Array) => void;
};

type SpirachaCliDependencies = {
    client?: ConversationClient;
    io?: SpirachaCliIo;
    runServer?: () => Promise<number>;
};

const defaultIo: SpirachaCliIo = {
    stderr: (text) => process.stderr.write(text),
    stdout: (text) => process.stdout.write(text),
};

const jsonOutput = (value: unknown): string => `${JSON.stringify(value)}\n`;

const resolveConversation = async (client: ConversationClient, ref: string) => {
    const resolved = await client.resolveConversationRef(ref);
    if (!resolved) throw new Error(`Conversation reference not found: ${ref}`);
    return resolved;
};

const emitOutput = async (content: Blob | string, output: string | undefined, io: SpirachaCliIo): Promise<void> => {
    if (output) {
        await Bun.write(output, content);
        return;
    }
    io.stdout(typeof content === 'string' ? content : new Uint8Array(await content.arrayBuffer()));
};

export const runSpirachaCli = async (args: string[], dependencies: SpirachaCliDependencies = {}): Promise<number> => {
    const io = dependencies.io ?? defaultIo;
    let parsed: SpirachaCliCommand;
    try {
        parsed = parseSpirachaCliArgs(args);
    } catch (error) {
        io.stderr(`spiracha: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }

    if (parsed.command === 'help') {
        io.stdout(SPIRACHA_USAGE);
        return 0;
    }
    if (parsed.command === 'serve') {
        try {
            return await (
                dependencies.runServer ?? (() => runProductionUiServer(resolveSpirachaPackageRoot()))
            )();
        } catch (error) {
            io.stderr(`spiracha: ${error instanceof Error ? error.message : String(error)}\n`);
            return 1;
        }
    }

    const client = dependencies.client ?? createConversationClient({ mode: 'local' });
    try {
        switch (parsed.command) {
            case 'list':
                {
                    const { command: _command, ...options } = parsed;
                    io.stdout(jsonOutput(await client.listConversations(options)));
                }
                return 0;
            case 'get': {
                const resolved = await resolveConversation(client, parsed.ref);
                const result = await client.getConversation({
                    id: resolved.id,
                    ...(parsed.messageSelector === undefined ? {} : { messageSelector: parsed.messageSelector }),
                    source: resolved.source,
                });
                if (!result) throw new Error('Conversation not found.');
                io.stdout(jsonOutput(result));
                return 0;
            }
            case 'export': {
                const resolved = await resolveConversation(client, parsed.ref);
                const result = parsed.raw
                    ? await client.exportConversationRaw({ id: resolved.id, source: resolved.source })
                    : await client.exportConversationMarkdown({
                          id: resolved.id,
                          ...(parsed.messageSelector === undefined
                              ? {}
                              : { messageSelector: parsed.messageSelector }),
                          source: resolved.source,
                      });
                if (result === null) {
                    throw new Error(parsed.raw ? 'Raw transcript not available.' : 'Conversation not found.');
                }
                await emitOutput(typeof result === 'string' ? result : result.blob, parsed.output, io);
                return 0;
            }
            case 'evidence': {
                const resolved = await resolveConversation(client, parsed.ref);
                const lens = (await Bun.file(parsed.lens).json()) as EvidenceLens;
                const result = await client.exportConversationEvidenceMarkdown({
                    id: resolved.id,
                    lens,
                    source: resolved.source,
                });
                if (!result) throw new Error('Conversation not found.');
                await emitOutput(result.markdown, parsed.output, io);
                return 0;
            }
        }
    } catch (error) {
        io.stderr(`spiracha: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }
};

export const resolveSpirachaPackageRoot = (binDir = import.meta.dir): string => path.resolve(binDir, '..');

if (import.meta.main) {
    process.exitCode = await runSpirachaCli(process.argv.slice(2));
}
