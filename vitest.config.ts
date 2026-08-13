import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@spiracha': path.resolve(__dirname, 'src'),
            '#': path.resolve(__dirname, 'src/ui'),
        },
    },
    root: __dirname,
    test: {
        coverage: {
            exclude: ['src/ui/routeTree.gen.ts', 'src/ui/integrations/**', 'src/ui/router.tsx', 'src/ui/routes/**'],
            include: ['src/ui/components/**/*.tsx', 'src/ui/lib/**/*.ts', 'src/ui/lib/**/*.tsx'],
            provider: 'v8',
            reporter: ['text', 'lcov'],
            reportsDirectory: 'coverage/ui',
        },
        environment: 'jsdom',
        environmentOptions: {
            jsdom: {
                url: 'http://localhost',
            },
        },
        include: ['src/ui/**/*.vitest.ts', 'src/ui/**/*.vitest.tsx'],
        setupFiles: ['src/ui/vitest.setup.ts'],
    },
});
