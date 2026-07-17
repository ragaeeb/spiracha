import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tempPaths: string[] = [];

afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

describe('UI export ZIP helpers', () => {
    it('should create zip exports without a system zip executable', async () => {
        const implementation = await Bun.file(new URL('./ui-export-zip.ts', import.meta.url)).text();
        expect(implementation).not.toContain("Bun.spawn(['zip'");

        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ui-export-zip-'));
        tempPaths.push(tempRoot);
        const sourcePath = path.join(tempRoot, 'thread.md');
        const zipPath = path.join(tempRoot, 'thread.zip');
        await Bun.write(sourcePath, '# Exported thread\n');
        const proc = Bun.spawn(
            [
                process.execPath,
                '--eval',
                "import { zipExportFile } from './src/lib/ui-export-zip.ts'; await zipExportFile(process.env.TEST_SOURCE_PATH, process.env.TEST_ZIP_PATH);",
            ],
            {
                cwd: process.cwd(),
                env: {
                    ...process.env,
                    PATH: '',
                    TEST_SOURCE_PATH: sourcePath,
                    TEST_ZIP_PATH: zipPath,
                },
                stderr: 'pipe',
            },
        );
        const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
        if (exitCode !== 0) {
            throw new Error(stderr.trim() || `zip child process failed with exit code ${exitCode}`);
        }

        const bytes = new Uint8Array(await Bun.file(zipPath).arrayBuffer());
        expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    });
});
