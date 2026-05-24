import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type CodexCliOptions, runCodexExport } from './codex-exporter';
import { createCodexFixture } from './codex-test-helpers';

const tempPaths: string[] = [];

afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

describe('runCodexExport', () => {
    it('exports requested deeplink threads as actual plain text', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-export-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexFixture(tempRoot);

        const result = await runCodexExport({
            cwdFilter: null,
            dbPath: fixture.dbPath,
            flat: false,
            includeCommentary: true,
            includeTools: true,
            inputDir: fixture.inputDir,
            optimized: false,
            outputDir: fixture.outputDir,
            outputFormat: 'txt',
            projectFilter: null,
            threadIds: [fixture.threadId, 'missing-thread-id'],
        } satisfies CodexCliOptions);

        expect(result.exportedCount).toBe(1);
        expect(result.missingThreadIds).toEqual(['missing-thread-id']);

        const exported = await Bun.file(result.files[0]!.outputPath).text();
        expect(exported).toContain('Metadata');
        expect(exported).toContain('User\n----\nexport this');
        expect(exported).toContain('GPT 5.4\n-------\ndone');
        expect(exported).toContain('Tool\n----\nCommand: echo hi');
        expect(exported).toContain('Tool Output\n-----------\nCommand: echo hi');
        expect(exported).not.toContain('## User');
        expect(exported).not.toContain('```');
    });

    it('uses project name instead of session prefix for flat exports', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-export-flat-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexFixture(tempRoot);

        const projectSessionDir = path.join(fixture.inputDir, 'custom');
        const sessionFile = path.join(projectSessionDir, 'session___abc123.jsonl');
        await mkdir(projectSessionDir, { recursive: true });
        await Bun.write(sessionFile, await Bun.file(fixture.sessionFile).text());

        const db = new Database(fixture.dbPath);
        db.prepare('UPDATE threads SET rollout_path = ? WHERE id = ?').run(sessionFile, fixture.threadId);
        db.close();

        const result = await runCodexExport({
            cwdFilter: null,
            dbPath: fixture.dbPath,
            flat: true,
            includeCommentary: true,
            includeTools: true,
            inputDir: fixture.inputDir,
            optimized: false,
            outputDir: fixture.outputDir,
            outputFormat: 'txt',
            projectFilter: null,
            threadIds: [fixture.threadId],
        } satisfies CodexCliOptions);

        expect(path.basename(result.files[0]!.outputPath)).toBe('summer.txt');
    });

    it('adds stable suffixes when flat exports contain multiple threads for one project', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-export-collision-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexFixture(tempRoot);

        const secondThreadId = '019dfeea-5255-7610-b346-986ccdc30c4a';
        const secondSessionFile = path.join(
            fixture.inputDir,
            '2026',
            '04',
            '24',
            `rollout-2026-04-24T10-00-00-${secondThreadId}.jsonl`,
        );
        await mkdir(path.dirname(secondSessionFile), { recursive: true });
        await Bun.write(secondSessionFile, await Bun.file(fixture.sessionFile).text());

        const db = new Database(fixture.dbPath);
        db.prepare(`
      INSERT INTO threads (
        id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
        sandbox_policy, approval_mode, tokens_used, has_user_event, archived, archived_at,
        git_sha, git_branch, git_origin_url, cli_version, first_user_message,
        agent_nickname, agent_role, memory_mode, model, reasoning_effort, agent_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            secondThreadId,
            secondSessionFile,
            1777034400,
            1777034460,
            'vscode',
            'openai',
            fixture.cwd,
            'Another export',
            JSON.stringify({ type: 'danger-full-access' }),
            'never',
            42,
            1,
            0,
            null,
            null,
            'main',
            null,
            '0.1.0',
            'export this again',
            null,
            null,
            'enabled',
            'gpt-5.4',
            'high',
            null,
        );
        db.close();

        const result = await runCodexExport({
            cwdFilter: null,
            dbPath: fixture.dbPath,
            flat: true,
            includeCommentary: true,
            includeTools: true,
            inputDir: fixture.inputDir,
            optimized: false,
            outputDir: fixture.outputDir,
            outputFormat: 'txt',
            projectFilter: 'summer',
            threadIds: [],
        } satisfies CodexCliOptions);

        expect(result.exportedCount).toBe(2);
        expect(result.files.map((file) => path.basename(file.outputPath)).sort()).toEqual([
            'summer__019da28f.txt',
            'summer__019dfeea.txt',
        ]);
    });

    it('matches --project against Windows-style cwd values and preserves flat file naming', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-export-windows-project-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexFixture(tempRoot);
        const windowsCwd = 'C:\\Users\\user\\workspace\\summer';

        const db = new Database(fixture.dbPath);
        db.prepare('UPDATE threads SET cwd = ? WHERE id = ?').run(windowsCwd, fixture.threadId);
        db.close();

        const result = await runCodexExport({
            cwdFilter: null,
            dbPath: fixture.dbPath,
            flat: true,
            includeCommentary: true,
            includeTools: false,
            inputDir: fixture.inputDir,
            optimized: false,
            outputDir: fixture.outputDir,
            outputFormat: 'txt',
            projectFilter: 'summer',
            threadIds: [],
        } satisfies CodexCliOptions);

        expect(result.exportedCount).toBe(1);
        expect(path.basename(result.files[0]!.outputPath)).toBe('summer.txt');
    });

    it('surfaces transcript read failures instead of reporting an empty export', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-export-missing-file-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexFixture(tempRoot);
        const missingSessionFile = path.join(tempRoot, 'missing.jsonl');

        const db = new Database(fixture.dbPath);
        db.prepare('UPDATE threads SET rollout_path = ? WHERE id = ?').run(missingSessionFile, fixture.threadId);
        db.close();

        await expect(
            runCodexExport({
                cwdFilter: null,
                dbPath: fixture.dbPath,
                flat: false,
                includeCommentary: true,
                includeTools: false,
                inputDir: fixture.inputDir,
                optimized: false,
                outputDir: fixture.outputDir,
                outputFormat: 'txt',
                projectFilter: null,
                threadIds: [fixture.threadId],
            } satisfies CodexCliOptions),
        ).rejects.toThrow(`Failed to read Codex transcript ${missingSessionFile}`);
    });
});
