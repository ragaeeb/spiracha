import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { buildSpirachaDevServerCommand, resolveSpirachaPackageRoot, waitForSpirachaDevServer } from './spiracha';

describe('spiracha executable launcher', () => {
    it('should launch the packaged UI on the configured default port', () => {
        const packageRoot = '/tmp/spiracha-package';

        expect(buildSpirachaDevServerCommand(packageRoot)).toEqual({
            args: ['--bun', 'vite', 'dev', '--host', '127.0.0.1', '--port', '3000'],
            cwd: path.join(packageRoot, 'apps', 'ui'),
        });
    });

    it('should resolve the package root from the executable location', () => {
        expect(resolveSpirachaPackageRoot('/tmp/spiracha-package/bin')).toBe('/tmp/spiracha-package');
    });

    it('should forward termination signals to the Vite child and remove listeners after exit', async () => {
        const signals = new EventEmitter();
        const forwarded: NodeJS.Signals[] = [];
        let resolveExit: (code: number) => void = () => {};
        const exited = new Promise<number>((resolve) => {
            resolveExit = resolve;
        });
        const waiting = waitForSpirachaDevServer(
            { exited, kill: (signal) => forwarded.push(signal as NodeJS.Signals) },
            signals,
        );

        signals.emit('SIGTERM');
        expect(forwarded).toEqual(['SIGTERM']);
        resolveExit(0);
        await expect(waiting).resolves.toBe(0);
        expect(signals.listenerCount('SIGTERM')).toBe(0);
        expect(signals.listenerCount('SIGINT')).toBe(0);
    });
});
