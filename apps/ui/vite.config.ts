import { createReadStream } from 'node:fs';
import { access, constants } from 'node:fs/promises';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { buildUiExportContentDisposition, resolveUiExportFilePathFromRequestPath } from '../../src/lib/ui-export-files';

const getExportContentType = (filePath: string) => {
    if (filePath.endsWith('.zip')) {
        return 'application/zip';
    }

    if (filePath.endsWith('.md')) {
        return 'text/markdown; charset=utf-8';
    }

    if (filePath.endsWith('.txt')) {
        return 'text/plain; charset=utf-8';
    }

    return 'application/octet-stream';
};

const spirachaExportFiles = (): Plugin => {
    return {
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                if (!req.url) {
                    next();
                    return;
                }

                const exportFilePath = resolveUiExportFilePathFromRequestPath(
                    new URL(req.url, 'http://spiracha.local').pathname,
                );
                if (!exportFilePath) {
                    next();
                    return;
                }

                try {
                    await access(exportFilePath, constants.R_OK);
                } catch {
                    res.statusCode = 404;
                    res.end('Not Found');
                    return;
                }

                res.setHeader('Cache-Control', 'no-store');
                res.setHeader('Content-Disposition', buildUiExportContentDisposition(exportFilePath));
                res.setHeader('Content-Type', getExportContentType(exportFilePath));
                res.statusCode = 200;

                if (req.method === 'HEAD') {
                    res.end();
                    return;
                }

                createReadStream(exportFilePath).pipe(res);
            });
        },
        name: 'spiracha-export-files',
    };
};

const config = defineConfig({
    plugins: [spirachaExportFiles(), devtools(), tailwindcss(), tanstackStart(), viteReact()],
    resolve: { tsconfigPaths: true },
    server: {
        fs: {
            allow: [path.resolve(__dirname, '..', '..')],
        },
    },
});

export default config;
