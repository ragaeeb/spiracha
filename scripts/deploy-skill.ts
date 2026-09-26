#!/usr/bin/env bun
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dir, '..');
const source = join(root, '.agents/skills/spiracha');
const targets = {
    antigravity: '.gemini/config/skills',
    claude: '.claude/skills',
    codex: '.codex/skills',
    cursor: '.cursor/skills',
    kiro: '.kiro/skills',
    opencode: '.config/opencode/skills',
};

const verifyRuntime = async (runtime: { bun: string; entrypoint: string }) => {
    const child = Bun.spawn([runtime.bun, runtime.entrypoint, '--help'], { stderr: 'pipe', stdout: 'pipe' });
    const [help, error, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ]);
    if (code !== 0 || !help.includes('retrieve <ref>')) {
        throw new Error(`Spiracha runtime is not ready: ${error}`);
    }
};

const syncSkill = async (destination: string, files: Map<string, string>, check: boolean, dryRun: boolean) => {
    // Check parents too: writing through an existing symlink can modify another skill.
    for (const name of files.keys()) {
        let path = join(destination, name);
        while (path !== dirname(path)) {
            if ((await lstat(path).catch(() => null))?.isSymbolicLink()) {
                throw new Error(`Refusing symlink: ${path}`);
            }
            path = dirname(path);
        }
    }
    if (dryRun) {
        return;
    }
    for (const [name, content] of files) {
        const path = join(destination, name);
        if (check) {
            if (!(await Bun.file(path).exists()) || (await Bun.file(path).text()) !== content) {
                throw new Error(`Missing or stale skill file: ${path}`);
            }
        } else {
            await mkdir(dirname(path), { recursive: true });
            await Bun.write(path, content);
        }
    }
};

const main = async () => {
    const { values } = parseArgs({
        options: {
            agents: { default: 'all', type: 'string' },
            check: { type: 'boolean' },
            'dry-run': { type: 'boolean' },
            help: { type: 'boolean' },
            home: { type: 'string' },
        },
        strict: true,
    });
    if (values.help) {
        console.log(
            'bun run skill:deploy [--agents all|claude,cursor,codex,antigravity,kiro,opencode] [--home directory] [--dry-run] [--check]',
        );
        return;
    }
    const agents = values.agents === 'all' ? Object.keys(targets) : [...new Set(values.agents?.split(','))];
    for (const agent of agents) {
        if (!Object.hasOwn(targets, agent)) {
            throw new Error(`Unknown agent: ${agent}`);
        }
    }
    const requestedHome = resolve(values.home ?? homedir());
    const home = await realpath(requestedHome).catch(() => requestedHome);
    const runtime = { bun: process.execPath, entrypoint: join(root, 'bin/spiracha.ts') };
    await verifyRuntime(runtime);
    const files = new Map([
        ['SKILL.md', await Bun.file(join(source, 'SKILL.md')).text()],
        ['agents/openai.yaml', await Bun.file(join(source, 'agents/openai.yaml')).text()],
        ['runtime.json', `${JSON.stringify(runtime, null, 2)}\n`],
    ]);
    for (const agent of agents) {
        const skillRoot =
            agent === 'codex' && !values.home && process.env.CODEX_HOME
                ? join(process.env.CODEX_HOME, 'skills')
                : join(home, targets[agent as keyof typeof targets]);
        const destination = join(skillRoot, 'spiracha');
        await syncSkill(destination, files, Boolean(values.check), Boolean(values['dry-run']));
        console.log(
            `${agent}: ${values['dry-run'] ? 'would deploy' : values.check ? 'verified' : 'deployed'} ${destination}`,
        );
    }
    console.log('Runtime verified. Start a new harness chat to refresh skill discovery.');
};

try {
    await main();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
