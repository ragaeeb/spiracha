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
        environment: 'jsdom',
        include: ['src/**/*.vitest.ts', 'src/**/*.vitest.tsx'],
    },
});
