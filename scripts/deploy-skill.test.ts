import { expect, it } from 'bun:test';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
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
