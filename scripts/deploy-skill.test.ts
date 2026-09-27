import { expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('should install runnable skills into isolated harness homes and detect drift without overwriting symlinks', async () => {
    const home = await mkdtemp(join(tmpdir(), 'spiracha-skill-'));
    const run = async (...args: string[]) => {
        const child = Bun.spawn([process.execPath, 'scripts/deploy-skill.ts', '--home', home, ...args], {
            stderr: 'pipe',
            stdout: 'pipe',
        });
        return {
            code: await child.exited,
            text: (await new Response(child.stdout).text()) + (await new Response(child.stderr).text()),
        };
    };
    try {
        expect((await run('--dry-run')).code).toBe(0);
        expect(await Bun.file(join(home, '.cursor/skills/spiracha/SKILL.md')).exists()).toBe(false);
        expect((await run()).code).toBe(0);
        expect((await run('--check')).code).toBe(0);
        const runtime = await Bun.file(join(home, '.cursor/skills/spiracha/runtime.json')).json();
        const child = Bun.spawn([runtime.bun, runtime.entrypoint, '--help'], { stdout: 'pipe' });
        expect(await child.exited).toBe(0);
        expect(await new Response(child.stdout).text()).toContain('retrieve <ref>');
        const skill = join(home, '.claude/skills/spiracha/SKILL.md');
        await Bun.write(skill, 'stale');
        expect((await run('--check')).code).toBe(1);
        await rm(skill);
        const sentinel = join(home, 'sentinel');
        await Bun.write(sentinel, 'keep');
        await symlink(sentinel, skill);
        expect((await run('--agents', 'claude')).code).toBe(1);
        expect(await Bun.file(sentinel).text()).toBe('keep');
        expect((await run('--agents', 'unknown')).code).toBe(1);
    } finally {
        await rm(home, { force: true, recursive: true });
    }
});

it('should resolve symlinked CODEX_HOME before checking the skill destination', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spiracha-codex-home-'));
    const codexHome = join(root, 'codex-home');
    const symlinkedCodexHome = join(root, 'codex-home-link');
    await mkdir(codexHome);
    await symlink(codexHome, symlinkedCodexHome);
    try {
        const child = Bun.spawn([process.execPath, 'scripts/deploy-skill.ts', '--agents', 'codex'], {
            env: { ...process.env, CODEX_HOME: symlinkedCodexHome },
            stderr: 'pipe',
            stdout: 'pipe',
        });

        expect(await child.exited).toBe(0);
        expect(await Bun.file(join(codexHome, 'skills/spiracha/SKILL.md')).exists()).toBe(true);
    } finally {
        await rm(root, { force: true, recursive: true });
    }
});

it('should resolve nonexistent homes beneath symlinked ancestors for both home settings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spiracha-skill-home-ancestor-'));
    const realParent = join(root, 'real-parent');
    const symlinkParent = join(root, 'parent-link');
    const requestedHome = join(symlinkParent, 'new-home');
    const requestedCodexHome = join(symlinkParent, 'new-codex-home');
    await mkdir(realParent);
    await symlink(realParent, symlinkParent);
    const run = async (args: string[], env: Record<string, string | undefined>) => {
        const child = Bun.spawn([process.execPath, 'scripts/deploy-skill.ts', ...args], {
            env,
            stderr: 'pipe',
            stdout: 'pipe',
        });
        return { code: await child.exited, text: await new Response(child.stdout).text() };
    };
    try {
        const homeEnv = { ...process.env };
        const homeDeploy = await run(['--home', requestedHome, '--agents', 'claude'], homeEnv);
        expect(homeDeploy.code).toBe(0);
        expect(await Bun.file(join(realParent, 'new-home/.claude/skills/spiracha/SKILL.md')).exists()).toBe(true);
        expect((await run(['--home', requestedHome, '--agents', 'claude', '--check'], homeEnv)).code).toBe(0);

        const codexEnv = { ...process.env, CODEX_HOME: requestedCodexHome };
        const codexDeploy = await run(['--agents', 'codex'], codexEnv);
        expect(codexDeploy.code).toBe(0);
        expect(await Bun.file(join(realParent, 'new-codex-home/skills/spiracha/SKILL.md')).exists()).toBe(true);
        expect((await run(['--agents', 'codex', '--check'], codexEnv)).code).toBe(0);
    } finally {
        await rm(root, { force: true, recursive: true });
    }
});
