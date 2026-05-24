import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@spiracha': path.resolve(__dirname, '../../src'),
            '#': path.resolve(__dirname, './src'),
        },
    },
    test: {
        coverage: {
            exclude: ['src/routeTree.gen.ts', 'src/integrations/**', 'src/router.tsx', 'src/routes/**'],
            include: ['src/components/**/*.tsx', 'src/lib/**/*.ts', 'src/lib/**/*.tsx'],
            provider: 'v8',
            reporter: ['text', 'lcov'],
        },
        environment: 'jsdom',
        include: ['src/**/*.vitest.ts', 'src/**/*.vitest.tsx'],
    },
});
