import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import {
    buildUiExportContentDisposition,
    getUiExportContentType,
    resolveReadableUiExportFileFromRequestPath,
    UI_EXPORT_URL_PREFIX,
} from './src/lib/ui-export-files.ts';

const appRoot = path.dirname(fileURLToPath(import.meta.url));

const spirachaExportFiles = (): Plugin => {
    return {
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                if (!req.url) {
                    next();
                    return;
                }

                const pathname = new URL(req.url, 'http://spiracha.local').pathname;
                if (!pathname.startsWith(UI_EXPORT_URL_PREFIX)) {
                    next();
                    return;
                }

                const exportFilePath = await resolveReadableUiExportFileFromRequestPath(pathname);
                if (!exportFilePath) {
                    res.statusCode = 404;
                    res.end('Not Found');
                    return;
                }

                res.setHeader('Cache-Control', 'no-store');
                res.setHeader('Content-Disposition', buildUiExportContentDisposition(exportFilePath));
                res.setHeader('Content-Type', getUiExportContentType(exportFilePath));
                res.statusCode = 200;

                if (req.method === 'HEAD') {
                    res.end();
                    return;
                }

                const stream = createReadStream(exportFilePath);
                stream.once('error', () => {
                    if (!res.headersSent) {
                        res.statusCode = 500;
                    }
                    res.end('Internal Server Error');
                });
                stream.pipe(res);
            });
        },
        name: 'spiracha-export-files',
    };
};

const config = defineConfig({
    plugins: [spirachaExportFiles(), devtools(), tailwindcss(), tanstackStart({ srcDirectory: 'src/ui' }), viteReact()],
    resolve: {
        alias: {
            '@spiracha': path.resolve(appRoot, 'src'),
        },
        tsconfigPaths: true,
    },
    root: appRoot,
    server: {
        fs: {
            allow: [appRoot],
        },
    },
});

export default config;
