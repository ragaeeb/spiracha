import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { buildIsolatedRuntimeEnv } from './isolated-runtime-test-helpers';

const root = path.resolve('fixture-runtime');

describe('isolated app test environment', () => {
    it('should keep all discovery roots and writable caches inside the fixture', () => {
        const env = buildIsolatedRuntimeEnv({}, root);
        for (const [key, value] of Object.entries(env)) {
            expect(value === root || value?.startsWith(`${root}${path.sep}`), key).toBe(true);
        }
        expect(env.SPIRACHA_CODEX_DB).toBe(path.join(root, 'state.sqlite'));
        expect(env.SPIRACHA_QODER_SOCKET_PATH).toBe(path.join(root, 'missing-qoder.sock'));
        expect(env.CODEX_BIN).toBe(path.join(root, 'missing-codex-cli'));
    });

    it('should discard developer credentials, existing source overrides and inherited runtime injection', () => {
        const input = {
            BUN_OPTIONS: '--preload /private/hook.ts',
            CODEX_HOME: '/private/codex',
            HOME: '/private/home',
            HTTPS_PROXY: 'https://proxy.invalid',
            NODE_OPTIONS: '--require=/private/hook.js',
            OPENAI_API_KEY: 'fixture-secret',
            PATH: '/fixture/bin',
            SPIRACHA_CODEX_AUTH: '/private/auth.json',
            SPIRACHA_CURSOR_USER_DIR: '/private/cursor',
        };
        const before = { ...input };
        const env = buildIsolatedRuntimeEnv(input, root);
        expect(env.PATH).toBe(input.PATH);
        for (const key of ['BUN_OPTIONS', 'NODE_OPTIONS', 'OPENAI_API_KEY', 'HTTPS_PROXY']) {
            expect(env[key]).toBeUndefined();
        }
        expect(JSON.stringify(env)).not.toContain('/private/');
        expect(input).toEqual(before);
    });

    it('should reject a relative directory or a filesystem root', () => {
        for (const invalid of ['', 'relative-fixture', path.parse(root).root]) {
            expect(() => buildIsolatedRuntimeEnv({}, invalid)).toThrow(/fixture directory/u);
        }
    });
});
