import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    parseSpirachaCliArgs,
    resolveSpirachaPackageRoot,
    runSpirachaCli,
} from './spiracha';
import type { ConversationClient } from '../src/client';

const temporaryPaths: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryPaths.splice(0).map((temporaryPath) => rm(temporaryPath, { force: true, recursive: true })));
});

describe('spiracha executable', () => {
    it('should resolve the package root from the executable location', () => {
        expect(resolveSpirachaPackageRoot('/tmp/spiracha-package/bin')).toBe('/tmp/spiracha-package');
    });

    it('should dispatch serve to the current UI server', async () => {
        let called = false;
        const exitCode = await runSpirachaCli(['serve'], {
            io: { stderr: () => {}, stdout: () => {} },
            runServer: async () => {
                called = true;
                return 0;
            },
        });

        expect(exitCode).toBe(0);
        expect(called).toBe(true);
    });

    it('should parse list options without starting a server', () => {
        expect(parseSpirachaCliArgs(['list', '--cwd', '/repo', '--source', 'codex, cline', '--limit', '2'])).toEqual({
            command: 'list',
            cwd: '/repo',
            limit: 2,
            sources: ['codex', 'cline'],
        });
    });

    it('should reject invalid local list and evidence options', () => {
        expect(() => parseSpirachaCliArgs(['list', '--cwd', 'relative'])).toThrow('absolute path');
        expect(() => parseSpirachaCliArgs(['list', '--cwd', '/repo', '--limit', '0'])).toThrow(
            'integer from 1 to 200',
        );
        expect(() =>
            parseSpirachaCliArgs([
                'evidence',
                'codex://thread-1',
                '--lens',
                'lens.json',
                '--message-selector',
                'all',
            ]),
        ).toThrow('Unknown option');
    });

    it('should render help for no arguments', async () => {
        const stdout: Array<string | Uint8Array> = [];
        const exitCode = await runSpirachaCli([], {
            io: { stderr: () => {}, stdout: (value) => stdout.push(value) },
            runServer: async () => 0,
        });

        expect(exitCode).toBe(0);
        expect(stdout.join('')).toContain('Usage: spiracha');
    });

    it('should emit list data as JSON through the local client', async () => {
        const stdout: Array<string | Uint8Array> = [];
        const page = { data: [], meta: { hasNext: false, nextCursor: null } };
        let received: unknown;
        const exitCode = await runSpirachaCli(['list', '--cwd', '/repo'], {
            client: {
                listConversations: async (options: Parameters<ConversationClient['listConversations']>[0]) => {
                    received = options;
                    return page;
                },
            } as never,
            io: { stderr: () => {}, stdout: (value) => stdout.push(value) },
            runServer: async () => 0,
        });

        expect(exitCode).toBe(0);
        expect(received).toEqual({ cwd: '/repo' });
        expect(JSON.parse(stdout.join(''))).toEqual(page);
    });

    it('should resolve refs before getting a conversation', async () => {
        const stdout: Array<string | Uint8Array> = [];
        let resolvedRef: string | undefined;
        let received: unknown;
        const client = {
            getConversation: async (options: Parameters<ConversationClient['getConversation']>[0]) => {
                received = options;
                return { id: 'thread-1' };
            },
            resolveConversationRef: async (ref: string) => {
                resolvedRef = ref;
                return { id: 'thread-1', source: 'codex' as const };
            },
        } as never;

        expect(await runSpirachaCli(['get', 'codex://thread-1', '--message-selector', 'all'], {
            client,
            io: { stderr: () => {}, stdout: (value) => stdout.push(value) },
            runServer: async () => 0,
        })).toBe(0);
        expect(resolvedRef).toBe('codex://thread-1');
        expect(received).toEqual({ id: 'thread-1', messageSelector: 'all', source: 'codex' });
        expect(JSON.parse(stdout.join(''))).toEqual({ id: 'thread-1' });
    });

    it('should write export markdown to the requested output path', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-cli-'));
        temporaryPaths.push(root);
        const output = path.join(root, 'export.md');
        const stdout: Array<string | Uint8Array> = [];
        const client = {
            exportConversationMarkdown: async () => '# Export\n',
            resolveConversationRef: async () => ({ id: 'thread-1', source: 'codex' as const }),
        } as never;

        expect(await runSpirachaCli(['export', 'codex://thread-1', '--output', output], {
            client,
            io: { stderr: () => {}, stdout: (value) => stdout.push(value) },
            runServer: async () => 0,
        })).toBe(0);
        expect(stdout).toEqual([]);
        expect(await Bun.file(output).text()).toBe('# Export\n');
    });

    it('should pass raw export bytes through to the requested output path', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-cli-'));
        temporaryPaths.push(root);
        const output = path.join(root, 'transcript.jsonl');
        const original = '{"z":1, "spacing":  true}\n';
        let received: unknown;
        const client = {
            exportConversationRaw: async (options: Parameters<ConversationClient['exportConversationRaw']>[0]) => {
                received = options;
                return {
                    blob: new Blob([original]),
                    fileName: 'native.jsonl',
                    mimeType: 'application/x-ndjson' as const,
                };
            },
            resolveConversationRef: async () => ({ id: 'thread-1', source: 'codex' as const }),
        } as never;

        expect(
            await runSpirachaCli(['export', 'codex://thread-1', '--raw', '--output', output], {
                client,
                io: { stderr: () => {}, stdout: () => {} },
                runServer: async () => 0,
            }),
        ).toBe(0);
        expect(received).toEqual({ id: 'thread-1', source: 'codex' });
        expect(await Bun.file(output).text()).toBe(original);
    });

    it('should reject message selection for raw CLI exports', () => {
        expect(() =>
            parseSpirachaCliArgs(['export', 'codex://thread-1', '--raw', '--message-selector', 'all']),
        ).toThrow('does not accept');
    });

    it('should read the evidence lens from JSON and emit markdown', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-cli-'));
        temporaryPaths.push(root);
        const lensPath = path.join(root, 'lens.json');
        await Bun.write(lensPath, '{"name":"focused"}');
        const stdout: Array<string | Uint8Array> = [];
        let received: unknown;
        const client = {
            exportConversationEvidenceMarkdown: async (options: Parameters<ConversationClient['exportConversationEvidenceMarkdown']>[0]) => {
                received = options;
                return { markdown: '# Evidence\n', meta: { episodeCount: 0 } };
            },
            resolveConversationRef: async () => ({ id: 'thread-1', source: 'codex' as const }),
        } as never;

        expect(await runSpirachaCli(['evidence', 'codex://thread-1', '--lens', lensPath], {
            client,
            io: { stderr: () => {}, stdout: (value) => stdout.push(value) },
            runServer: async () => 0,
        })).toBe(0);
        expect(received).toEqual({
            id: 'thread-1',
            lens: { name: 'focused' },
            source: 'codex',
        });
        expect(stdout.join('')).toBe('# Evidence\n');
    });

    it('should send unresolved refs to stderr', async () => {
        const stderr: string[] = [];
        const exitCode = await runSpirachaCli(['get', 'codex://missing'], {
            client: { resolveConversationRef: async () => null } as never,
            io: { stderr: (value) => stderr.push(value), stdout: () => {} },
            runServer: async () => 0,
        });

        expect(exitCode).toBe(1);
        expect(stderr.join('')).toContain('Conversation reference not found');
    });
});
