import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isAllowedLocalRequestOrigin } from './local-request-security';
import {
    buildUiExportContentDisposition,
    getUiExportContentType,
    resolveReadableUiExportFileFromRequestPath,
    UI_EXPORT_URL_PREFIX,
} from './ui-export-files';

type ProductionUiFetchOptions = {
    appFetch: (request: Request) => Promise<Response> | Response;
    clientDirectory: string;
};

const withLocalSecurityHeaders = (response: Response) => {
    response.headers.set('X-Content-Type-Options', 'nosniff');
    return response;
};

export const resolveClientAssetPath = (clientDirectory: string, pathname: string): string | null => {
    let decodedPath: string;
    try {
        decodedPath = decodeURIComponent(pathname);
    } catch {
        return null;
    }
    const relativePath = decodedPath.replace(/^\/+/, '');
    if (!relativePath) {
        return null;
    }
    const root = path.resolve(clientDirectory);
    const candidate = path.resolve(root, relativePath);
    return candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
};

const getExportResponse = async (request: Request, pathname: string): Promise<Response> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return withLocalSecurityHeaders(
            new Response('Method Not Allowed', { headers: { Allow: 'GET, HEAD' }, status: 405 }),
        );
    }
    const exportFilePath = await resolveReadableUiExportFileFromRequestPath(pathname);
    if (!exportFilePath) {
        return withLocalSecurityHeaders(new Response('Not Found', { status: 404 }));
    }
    const file = Bun.file(exportFilePath);
    return new Response(request.method === 'HEAD' ? null : file, {
        headers: {
            'Cache-Control': 'no-store',
            'Content-Disposition': buildUiExportContentDisposition(exportFilePath),
            'Content-Type': getUiExportContentType(exportFilePath),
            'X-Content-Type-Options': 'nosniff',
        },
    });
};

const getAssetResponse = async (
    request: Request,
    clientDirectory: string,
    pathname: string,
): Promise<Response | null> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return null;
    }
    const assetPath = resolveClientAssetPath(clientDirectory, pathname);
    if (!assetPath) {
        return null;
    }
    const file = Bun.file(assetPath);
    if (!(await file.exists())) {
        return null;
    }
    return new Response(request.method === 'HEAD' ? null : file, {
        headers: {
            'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
            'Content-Type': file.type,
            'X-Content-Type-Options': 'nosniff',
        },
    });
};

export const createProductionUiFetch = ({ appFetch, clientDirectory }: ProductionUiFetchOptions) => {
    return async (request: Request): Promise<Response> => {
        if (!isAllowedLocalRequestOrigin(request.url, request.headers.get('Origin'))) {
            return withLocalSecurityHeaders(new Response('Forbidden', { status: 403 }));
        }
        const pathname = new URL(request.url).pathname;
        if (pathname.startsWith(UI_EXPORT_URL_PREFIX)) {
            return getExportResponse(request, pathname);
        }

        const assetResponse = await getAssetResponse(request, clientDirectory, pathname);
        if (assetResponse) {
            return assetResponse;
        }

        return withLocalSecurityHeaders(await appFetch(request));
    };
};

const resolvePort = (value: string | undefined): number => {
    const port = value === undefined ? 3000 : Number(value);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
        throw new Error(`Invalid PORT value "${value}". Use an integer from 1 to 65535.`);
    }
    return port;
};

export const runProductionUiServer = async (packageRoot: string): Promise<number> => {
    const serverEntryPath = path.join(packageRoot, 'dist/app/server.js');
    if (!(await Bun.file(serverEntryPath).exists())) {
        throw new Error('Packaged UI build is missing. Run "bun run build" before "spiracha serve".');
    }
    const module = (await import(pathToFileURL(serverEntryPath).href)) as {
        default?: { fetch?: (request: Request) => Promise<Response> | Response };
    };
    const appFetch = module.default?.fetch;
    if (!appFetch) {
        throw new Error('Packaged UI server entry does not export a fetch handler.');
    }
    const hostname = '127.0.0.1';
    const port = resolvePort(process.env.PORT);
    Bun.serve({
        fetch: createProductionUiFetch({ appFetch, clientDirectory: path.join(packageRoot, 'dist/client') }),
        hostname,
        port,
    });
    console.error(`Spiracha listening on http://${hostname}:${port}`);
    return 0;
};
