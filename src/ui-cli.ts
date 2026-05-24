#!/usr/bin/env bun

import { access, constants } from 'node:fs/promises';
import path from 'node:path';
import { openUrlNatively } from './lib/native-open';
import { CliUsageError } from './lib/shared';
import {
    buildUiExportContentDisposition,
    ensureUiExportDir,
    resolveUiExportFilePathFromRequestPath,
} from './lib/ui-export-files';

type UiCliOptions = {
    dbPath: string | null;
    host: string;
    openBrowser: boolean;
    port: number;
};

const DEFAULT_UI_HOST = '127.0.0.1';
const DEFAULT_UI_PORT = 3000;
const MAX_PORT_ATTEMPTS = 10;

const resolveUiDistPaths = () => {
    const distRoot = path.resolve(import.meta.dir, '..', 'apps', 'ui', 'dist');
    return {
        clientDir: path.join(distRoot, 'client'),
        serverEntryPath: path.join(distRoot, 'server', 'server.js'),
    };
};

const ensureUiBuildExists = async () => {
    const { clientDir, serverEntryPath } = resolveUiDistPaths();
    const serverEntry = Bun.file(serverEntryPath);
    const clientAssetExists = await Bun.file(path.join(clientDir, 'favicon.ico')).exists();
    const serverEntryExists = await serverEntry.exists();

    if (!clientAssetExists || !serverEntryExists) {
        throw new Error('UI build artifacts are missing. Run `bun run build` before launching `spiracha ui`.');
    }

    await ensureUiExportDir();
};

const parsePort = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        throw new CliUsageError(`Invalid port: ${value}`);
    }

    return parsed;
};

const requireUiArgValue = (value: string | undefined, flag: string) => {
    if (!value) {
        throw new CliUsageError(`Missing value for ${flag}`);
    }

    return value;
};

const applyUiCliArg = (
    argv: string[],
    index: number,
    state: UiCliOptions,
): {
    index: number;
    state: UiCliOptions;
} => {
    const arg = argv[index];

    if (arg === '--no-open') {
        return {
            index,
            state: {
                ...state,
                openBrowser: false,
            },
        };
    }

    if (arg === '--port') {
        return {
            index: index + 1,
            state: {
                ...state,
                port: parsePort(requireUiArgValue(argv[index + 1], '--port')),
            },
        };
    }

    if (arg === '--host') {
        return {
            index: index + 1,
            state: {
                ...state,
                host: requireUiArgValue(argv[index + 1], '--host'),
            },
        };
    }

    if (arg === '--db') {
        return {
            index: index + 1,
            state: {
                ...state,
                dbPath: requireUiArgValue(argv[index + 1], '--db'),
            },
        };
    }

    throw new CliUsageError(`Unknown UI argument: ${arg}`);
};

export const parseUiCliArgs = (argv: string[]): UiCliOptions => {
    let state: UiCliOptions = {
        dbPath: null,
        host: DEFAULT_UI_HOST,
        openBrowser: true,
        port: DEFAULT_UI_PORT,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const next = applyUiCliArg(argv, index, state);
        state = next.state;
        index = next.index;
    }

    return state;
};

export const getUiHelpText = (): string => {
    return [
        'Launch the Spiracha browser UI.',
        '',
        'Usage:',
        '  spiracha ui [--port 3000] [--host 127.0.0.1] [--db FILE] [--no-open]',
        '',
        'Options:',
        `  --port     HTTP port to bind (default: ${DEFAULT_UI_PORT})`,
        `  --host     Hostname to bind (default: ${DEFAULT_UI_HOST})`,
        '  --db       Override the Codex SQLite database path for the UI',
        '  --no-open  Do not open the browser automatically',
        '  --help,-h  Show this help text',
        '',
        'Stop the UI with Ctrl+C.',
    ].join('\n');
};

const toPublicFilePath = (clientDir: string, pathname: string) => {
    const normalizedPath = pathname === '/' ? '' : pathname.replace(/^\/+/u, '');
    const resolved = path.resolve(clientDir, normalizedPath);
    const relative = path.relative(clientDir, resolved);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return null;
    }

    return resolved;
};

export const getUiStaticResponse = async (clientDir: string, pathname: string): Promise<Response | null> => {
    if (pathname === '/') {
        return null;
    }

    const exportFilePath = resolveUiExportFilePathFromRequestPath(pathname);
    if (exportFilePath) {
        try {
            await access(exportFilePath, constants.R_OK);
        } catch {
            return new Response('Not Found', { status: 404 });
        }

        return new Response(Bun.file(exportFilePath), {
            headers: {
                'cache-control': 'no-store',
                'content-disposition': buildUiExportContentDisposition(exportFilePath),
            },
        });
    }

    const targetPath = toPublicFilePath(clientDir, pathname);
    if (!targetPath) {
        return new Response('Forbidden', { status: 403 });
    }

    const file = Bun.file(targetPath);
    if (!(await file.exists())) {
        return null;
    }

    return new Response(file);
};

const openBrowserIfRequested = async (url: string, openBrowser: boolean) => {
    if (!openBrowser) {
        return;
    }

    try {
        await openUrlNatively(url);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Could not open the browser automatically: ${message}`);
    }
};

const startUiServer = async (options: UiCliOptions) => {
    await ensureUiBuildExists();
    const { clientDir, serverEntryPath } = resolveUiDistPaths();
    const serverModule = (await import(serverEntryPath)) as {
        default: {
            fetch: (request: Request) => Promise<Response> | Response;
        };
    };

    if (options.dbPath) {
        process.env.SPIRACHA_CODEX_DB = options.dbPath;
    }

    for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt += 1) {
        const port = options.port + attempt;

        try {
            const server = Bun.serve({
                fetch: async (request) => {
                    const url = new URL(request.url);
                    const staticResponse = await getUiStaticResponse(clientDir, url.pathname);
                    if (staticResponse) {
                        return staticResponse;
                    }

                    return serverModule.default.fetch(request);
                },
                hostname: options.host,
                idleTimeout: 30,
                port,
            });

            return {
                port,
                server,
            };
        } catch (error) {
            if (
                attempt < MAX_PORT_ATTEMPTS - 1 &&
                error instanceof Error &&
                /address already in use|EADDRINUSE/i.test(error.message)
            ) {
                continue;
            }

            throw error;
        }
    }

    throw new Error(`Unable to bind the UI server after ${MAX_PORT_ATTEMPTS} port attempts.`);
};

export const runUiCli = async (argv = process.argv.slice(2)) => {
    try {
        if (argv.includes('--help') || argv.includes('-h')) {
            console.log(getUiHelpText());
            return;
        }
        const options = parseUiCliArgs(argv);
        const { port, server } = await startUiServer(options);
        const url = `http://${options.host}:${port}`;

        console.log(`Spiracha UI running at ${url}`);
        console.log('Press Ctrl+C to stop.');

        await openBrowserIfRequested(url, options.openBrowser);

        let shuttingDown = false;
        const shutdown = () => {
            if (shuttingDown) {
                return;
            }
            shuttingDown = true;
            server.stop(true);
            console.log('Spiracha UI stopped.');
            process.exit(0);
        };

        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);

        await new Promise<void>(() => {});
    } catch (error) {
        if (error instanceof CliUsageError) {
            console.error(error.message);
            console.error('');
            console.error(getUiHelpText());
            process.exit(1);
        }

        if (error instanceof Error) {
            console.error(error.message);
            process.exit(1);
        }

        throw error;
    }
};

if (import.meta.main) {
    await runUiCli();
}
