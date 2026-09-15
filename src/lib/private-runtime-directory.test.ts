import { afterEach, describe, expect, it } from 'bun:test';
import { chmod, lstat, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertPrivateRuntimeDirectorySafe, ensurePrivateRuntimeDirectory } from './private-runtime-directory';

const roots: string[] = [];
const temporaryRoot = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-private-directory-'));
    roots.push(root);
    return root;
};

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('private runtime directories', () => {
    it('should create nested owner-only directories and permit repeated initialization', async () => {
        const target = path.join(await temporaryRoot(), 'parent', 'exports');
        expect(await ensurePrivateRuntimeDirectory(target, 'export')).toBe(target);
        expect(await ensurePrivateRuntimeDirectory(target, 'export')).toBe(target);
        expect((await lstat(target)).isDirectory()).toBe(true);
        if (process.platform !== 'win32') {
            expect((await lstat(target)).mode & 0o777).toBe(0o700);
        }
    });

    it.skipIf(process.platform === 'win32')('should repair permissive modes on an existing owned directory', async () => {
        const target = path.join(await temporaryRoot(), 'cache');
        await mkdir(target);
        await chmod(target, 0o777);
        await assertPrivateRuntimeDirectorySafe(target, 'cache');
        expect((await lstat(target)).mode & 0o777).toBe(0o700);
    });

    it('should reject a regular file without replacing or modifying its contents', async () => {
        const target = path.join(await temporaryRoot(), 'not-a-directory');
        await Bun.write(target, 'preserve this file');
        await expect(ensurePrivateRuntimeDirectory(target, 'cache')).rejects.toThrow();
        await expect(assertPrivateRuntimeDirectorySafe(target, 'cache')).rejects.toThrow(/Unsafe/u);
        expect(await Bun.file(target).text()).toBe('preserve this file');
    });

    it.skipIf(process.platform === 'win32')('should reject a leaf symlink without chmodding its target', async () => {
        const root = await temporaryRoot();
        const actual = path.join(root, 'actual');
        const linked = path.join(root, 'linked');
        await mkdir(actual);
        await chmod(actual, 0o755);
        await symlink(actual, linked);
        await expect(ensurePrivateRuntimeDirectory(linked, 'export')).rejects.toThrow(/Unsafe/u);
        await expect(assertPrivateRuntimeDirectorySafe(linked, 'export')).rejects.toThrow(/Unsafe/u);
        expect((await lstat(actual)).mode & 0o777).toBe(0o755);
        expect((await lstat(linked)).isSymbolicLink()).toBe(true);
    });

    it('should reject a missing directory when checking safety without creating it', async () => {
        const target = path.join(await temporaryRoot(), 'missing');
        await expect(assertPrivateRuntimeDirectorySafe(target, 'export')).rejects.toThrow();
        expect(await Bun.file(target).exists()).toBe(false);
    });
});
