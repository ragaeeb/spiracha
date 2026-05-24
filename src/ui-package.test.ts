import { describe, expect, it } from 'bun:test';
import path from 'node:path';

describe('ui package tests', () => {
    it('should pass the Vitest UI suite', async () => {
        const uiDir = path.join(process.cwd(), 'apps', 'ui');
        const proc = Bun.spawn(['bun', 'run', 'test'], {
            cwd: uiDir,
            stderr: 'pipe',
            stdout: 'pipe',
        });

        const [stdoutText, stderrText, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);

        expect(exitCode).toBe(0);
        expect(`${stdoutText}\n${stderrText}`).not.toContain('FAIL');
    });
});
