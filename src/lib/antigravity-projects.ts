import os from 'node:os';
import path from 'node:path';
import { mapWithConcurrency } from './concurrency';

type AntigravityDevToolsTarget = {
    type?: string;
    url?: string;
};

type AntigravityProjectConnection = {
    baseUrl: string;
    csrfToken: string;
};

type AntigravityProjectRequest = (
    url: string,
    init: RequestInit & { tls?: { rejectUnauthorized: boolean } },
) => Promise<Response>;

type AntigravityProjectResolverOptions = {
    getConnection?: () => Promise<AntigravityProjectConnection | null>;
    request?: AntigravityProjectRequest;
};

const ANTIGRAVITY_PROJECT_READ_CONCURRENCY = 8;
const SAFE_PROJECT_ID_PATTERN = /^[a-z0-9._-]{1,128}$/iu;

const encodeGrpcWebJson = (value: unknown): Uint8Array => {
    const payload = Buffer.from(JSON.stringify(value));
    const frame = new Uint8Array(payload.length + 5);
    new DataView(frame.buffer).setUint32(1, payload.length);
    frame.set(payload, 5);
    return frame;
};

export const decodeAntigravityGrpcWebJson = (bytes: Uint8Array): unknown => {
    if (bytes.length < 5 || bytes[0] !== 0) {
        throw new Error('Invalid Antigravity gRPC-Web data frame');
    }

    const payloadLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1);
    const payloadEnd = 5 + payloadLength;
    if (payloadEnd > bytes.length) {
        throw new Error('Truncated Antigravity gRPC-Web data frame');
    }

    return JSON.parse(new TextDecoder().decode(bytes.subarray(5, payloadEnd)));
};

export const extractAntigravityCsrfToken = (processCommands: string): string | null => {
    for (const command of processCommands.split(/\r?\n/u)) {
        if (!command.includes('language_server') || !command.includes('--app_data_dir antigravity')) {
            continue;
        }

        const token = command.match(/--csrf_token(?:=|\s+)([a-z0-9-]{16,128})/iu)?.[1];
        if (token) {
            return token;
        }
    }

    return null;
};

export const extractAntigravityProjectServiceUrl = (targets: AntigravityDevToolsTarget[]): string | null => {
    for (const target of targets) {
        if (target.type !== 'page' || !target.url) {
            continue;
        }

        try {
            const url = new URL(target.url);
            if (url.protocol === 'https:' && url.hostname === '127.0.0.1' && url.port) {
                return url.origin;
            }
        } catch {}
    }

    return null;
};

const getAntigravityDevToolsPortPaths = (): string[] => {
    if (process.platform === 'darwin') {
        return [path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort')];
    }
    if (process.platform === 'win32' && process.env.APPDATA) {
        return [path.join(process.env.APPDATA, 'Antigravity', 'DevToolsActivePort')];
    }

    return [
        path.join(
            process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
            'Antigravity',
            'DevToolsActivePort',
        ),
    ];
};

const readDevToolsPort = async (): Promise<number | null> => {
    for (const filePath of getAntigravityDevToolsPortPaths()) {
        try {
            const port = Number.parseInt((await Bun.file(filePath).text()).split(/\r?\n/u)[0] ?? '', 10);
            if (Number.isInteger(port) && port > 0 && port <= 65_535) {
                return port;
            }
        } catch {}
    }

    return null;
};

const readProcessCommands = async (): Promise<string> => {
    if (process.platform === 'win32') {
        return '';
    }

    try {
        const processList = Bun.spawn(['ps', '-axo', 'command='], {
            stderr: 'ignore',
            stdout: 'pipe',
        });
        const output = await new Response(processList.stdout).text();
        return (await processList.exited) === 0 ? output : '';
    } catch {
        return '';
    }
};

const getRunningAntigravityProjectConnection = async (): Promise<AntigravityProjectConnection | null> => {
    const [devToolsPort, processCommands] = await Promise.all([readDevToolsPort(), readProcessCommands()]);
    const csrfToken = extractAntigravityCsrfToken(processCommands);
    if (!devToolsPort || !csrfToken) {
        return null;
    }

    try {
        const response = await fetch(`http://127.0.0.1:${devToolsPort}/json/list`, {
            signal: AbortSignal.timeout(1_000),
        });
        if (!response.ok) {
            return null;
        }

        const targets = (await response.json()) as AntigravityDevToolsTarget[];
        const baseUrl = extractAntigravityProjectServiceUrl(targets);
        return baseUrl ? { baseUrl, csrfToken } : null;
    } catch {
        return null;
    }
};

export const resolveAntigravityProjectNames = async (
    projectIds: string[],
    options: AntigravityProjectResolverOptions = {},
): Promise<Map<string, string>> => {
    const ids = [...new Set(projectIds)].filter((id) => SAFE_PROJECT_ID_PATTERN.test(id));
    if (ids.length === 0) {
        return new Map();
    }

    const connection = await (options.getConnection ?? getRunningAntigravityProjectConnection)();
    if (!connection) {
        return new Map();
    }

    const request: AntigravityProjectRequest = options.request ?? ((url, init) => fetch(url, init));
    const projects = await mapWithConcurrency(ids, ANTIGRAVITY_PROJECT_READ_CONCURRENCY, async (projectId) => {
        try {
            const response = await request(
                `${connection.baseUrl}/exa.language_server_pb.LanguageServerService/ReadProject`,
                {
                    body: encodeGrpcWebJson({ id: projectId }).buffer as ArrayBuffer,
                    headers: {
                        'content-type': 'application/grpc-web+json',
                        'x-codeium-csrf-token': connection.csrfToken,
                        'x-grpc-web': '1',
                    },
                    method: 'POST',
                    signal: AbortSignal.timeout(1_500),
                    tls: { rejectUnauthorized: false },
                },
            );
            if (!response.ok || response.headers.get('grpc-status') === '16') {
                return null;
            }

            const decoded = decodeAntigravityGrpcWebJson(new Uint8Array(await response.arrayBuffer())) as {
                project?: { id?: unknown; name?: unknown };
            };
            const id = decoded.project?.id;
            const name = decoded.project?.name;
            return id === projectId && typeof name === 'string' && name.trim()
                ? ([projectId, name.trim()] as const)
                : null;
        } catch {
            return null;
        }
    });

    return new Map(projects.filter((project): project is readonly [string, string] => project !== null));
};
