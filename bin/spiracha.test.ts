import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { buildSpirachaDevServerCommand, resolveSpirachaPackageRoot } from './spiracha';

describe('spiracha executable launcher', () => {
    it('should launch the packaged UI with Vite port fallback enabled', () => {
        const packageRoot = '/tmp/spiracha-package';

        expect(buildSpirachaDevServerCommand(packageRoot)).toEqual({
            args: ['--bun', 'vite', 'dev', '--host', '127.0.0.1', '--port', '3000'],
            cwd: path.join(packageRoot, 'apps', 'ui'),
        });
    });

    it('should resolve the package root from the executable location', () => {
        expect(resolveSpirachaPackageRoot('/tmp/spiracha-package/bin')).toBe('/tmp/spiracha-package');
    });
});
