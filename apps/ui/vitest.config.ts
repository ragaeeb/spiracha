import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@spiracha': path.resolve(__dirname, '../../src'),
            '#': path.resolve(__dirname, './src'),
        },
    },
    root: __dirname,
    test: {
        coverage: {
            exclude: ['src/routeTree.gen.ts', 'src/integrations/**', 'src/router.tsx', 'src/routes/**'],
            include: ['src/components/**/*.tsx', 'src/lib/**/*.ts', 'src/lib/**/*.tsx'],
            provider: 'v8',
            reporter: ['text', 'lcov'],
        },
        environment: 'jsdom',
        environmentOptions: {
            jsdom: {
                url: 'http://localhost',
            },
        },
        include: ['src/**/*.vitest.ts', 'src/**/*.vitest.tsx'],
        setupFiles: ['vitest.setup.ts'],
    },
});
