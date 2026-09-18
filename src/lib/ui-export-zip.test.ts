import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BlobReader, ZipReader } from '@zip.js/zip.js';
import { strFromU8, unzipSync } from 'fflate';
import { zipExportDirectory, zipExportFile } from './ui-export-zip';

const tempPaths: string[] = [];

afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

describe('UI export ZIP helpers', () => {
    it('should create zip exports without a system zip executable', async () => {
        const implementation = await Bun.file(new URL('./ui-export-zip.ts', import.meta.url)).text();
        expect(implementation).not.toContain("Bun.spawn(['zip'");
        expect(implementation).toContain('level: 9');
        expect(implementation).not.toContain('level: 3');

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

    it('should create AES-256 password-protected archives without changing member bytes', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ui-export-zip-password-'));
        tempPaths.push(tempRoot);
        const sourcePath = path.join(tempRoot, 'unicode.bin');
        const zipPath = path.join(tempRoot, 'unicode.zip');
        const sourceBytes = new Uint8Array([0, 1, 127, 128, 254, 255]);
        const password = '  correct horse 🔐  ';
        await Bun.write(sourcePath, sourceBytes);

        await zipExportFile(sourcePath, zipPath, password);

        const reader = new ZipReader(new BlobReader(new Blob([await Bun.file(zipPath).arrayBuffer()])));
        const entries = await reader.getEntries();
        expect(entries).toHaveLength(1);
        const entry = entries[0];
        if (!entry || entry.directory) {
            throw new Error('expected an encrypted file entry');
        }
        expect(entry.encrypted).toBe(true);
        await expect(entry.arrayBuffer()).rejects.toThrow(/encrypted entry|password/i);
        await expect(entry.arrayBuffer({ password: 'wrong password' })).rejects.toThrow(/invalid password/i);
        expect(new Uint8Array(await entry.arrayBuffer({ password }))).toEqual(sourceBytes);
        await reader.close();
    });

    it.skipIf(!Bun.which('7zz') && !Bun.which('7z'))(
        'should be readable by an independent 7-Zip extractor',
        async () => {
            const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ui-export-zip-7zip-'));
            tempPaths.push(tempRoot);
            const sourcePath = path.join(tempRoot, 'thread.md');
            const zipPath = path.join(tempRoot, 'thread.zip');
            const sourceBytes = new TextEncoder().encode('# Independent extraction ✅\n');
            const password = 'zip test password';
            await Bun.write(sourcePath, sourceBytes);
            await zipExportFile(sourcePath, zipPath, password);

            const sevenZipPath = Bun.which('7zz') ?? Bun.which('7z');
            if (!sevenZipPath) {
                return;
            }
            const proc = Bun.spawn([sevenZipPath, 'x', '-so', '-y', `-p${password}`, zipPath, 'thread.md'], {
                stderr: 'pipe',
                stdout: 'pipe',
            });
            const [exitCode, output, stderr] = await Promise.all([
                proc.exited,
                new Response(proc.stdout).arrayBuffer(),
                new Response(proc.stderr).text(),
            ]);
            if (exitCode !== 0) {
                throw new Error(stderr.trim() || `7-Zip failed with exit code ${exitCode}`);
            }
            expect(new Uint8Array(output)).toEqual(sourceBytes);
        },
    );

    it('should archive large files and nested export directories', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ui-export-zip-large-'));
        tempPaths.push(tempRoot);
        const sourceDirectory = path.join(tempRoot, 'source');
        const nestedDirectory = path.join(sourceDirectory, 'nested');
        const largeContent = `# Large thread\n${'tool output\n'.repeat(20_000)}`;
        await Bun.write(path.join(sourceDirectory, 'thread.md'), largeContent);
        await Bun.write(path.join(nestedDirectory, 'metadata.txt'), 'metadata');

        const singleZipPath = path.join(tempRoot, 'single.zip');
        await zipExportFile(path.join(sourceDirectory, 'thread.md'), singleZipPath);
        const singleEntries = unzipSync(new Uint8Array(await Bun.file(singleZipPath).arrayBuffer()));
        expect(strFromU8(singleEntries['thread.md']!)).toBe(largeContent);

        const directoryZipPath = path.join(tempRoot, 'directory.zip');
        await zipExportDirectory(sourceDirectory, directoryZipPath);
        const directoryEntries = unzipSync(new Uint8Array(await Bun.file(directoryZipPath).arrayBuffer()));
        expect(Object.keys(directoryEntries).sort()).toEqual(['nested/metadata.txt', 'thread.md']);
        expect(strFromU8(directoryEntries['nested/metadata.txt']!)).toBe('metadata');
        expect(strFromU8(directoryEntries['thread.md']!)).toBe(largeContent);
    });

    it('should skip symbolic links while collecting export directories', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ui-export-zip-symlink-'));
        tempPaths.push(tempRoot);
        const sourceDirectory = path.join(tempRoot, 'source');
        const outsideDirectory = path.join(tempRoot, 'outside');
        await Bun.write(path.join(sourceDirectory, 'thread.md'), '# Safe export\n');
        await Bun.write(path.join(outsideDirectory, 'secret.txt'), 'secret');
        await symlink(path.join(outsideDirectory, 'secret.txt'), path.join(sourceDirectory, 'linked-secret.txt'));
        await symlink(outsideDirectory, path.join(sourceDirectory, 'linked-directory'));

        const zipPath = path.join(tempRoot, 'directory.zip');
        await zipExportDirectory(sourceDirectory, zipPath);

        const entries = unzipSync(new Uint8Array(await Bun.file(zipPath).arrayBuffer()));
        expect(Object.keys(entries)).toEqual(['thread.md']);
    });

    it('should remove a stale destination when a ZIP input fails', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ui-export-zip-cleanup-'));
        tempPaths.push(tempRoot);
        const zipPath = path.join(tempRoot, 'partial.zip');
        await Bun.write(zipPath, 'partial archive');

        await expect(zipExportFile(path.join(tempRoot, 'missing.md'), zipPath)).rejects.toThrow();
        expect(await Bun.file(zipPath).exists()).toBe(false);
    });
});
