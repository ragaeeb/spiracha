import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inferInteractiveTarget } from './interactive-cli';

const tempPaths: string[] = [];

afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

describe('interactive cli inference', () => {
    it('infers codex thread deeplinks and raw thread ids', async () => {
        await expect(inferInteractiveTarget('codex://threads/019da28f-ee5b-7881-afe0-68b3d3bd2c77')).resolves.toEqual({
            kind: 'codex_threads',
            value: 'codex://threads/019da28f-ee5b-7881-afe0-68b3d3bd2c77',
        });

        await expect(inferInteractiveTarget('019da28f-ee5b-7881-afe0-68b3d3bd2c77')).resolves.toEqual({
            kind: 'codex_threads',
            value: '019da28f-ee5b-7881-afe0-68b3d3bd2c77',
        });
    });

    it('infers existing Claude export paths', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-interactive-'));
        tempPaths.push(tempRoot);
        const exportDir = path.join(tempRoot, 'claude-export');
        await mkdir(exportDir, { recursive: true });
        await Bun.write(path.join(exportDir, 'metadata.json'), '{}');

        await expect(inferInteractiveTarget(exportDir)).resolves.toEqual({
            kind: 'claude_path',
            value: exportDir,
        });
    });

    it('infers unknown directories as codex cwd and bare names as project names', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-interactive-'));
        tempPaths.push(tempRoot);
        const projectDir = path.join(tempRoot, 'summer');
        await mkdir(projectDir, { recursive: true });

        await expect(inferInteractiveTarget(projectDir)).resolves.toEqual({
            kind: 'codex_cwd',
            value: projectDir,
        });

        await expect(inferInteractiveTarget('summer')).resolves.toEqual({
            kind: 'codex_project',
            value: 'summer',
        });
    });
});
