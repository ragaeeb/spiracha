import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listCodexThreadsForPath } from './codex-browser-queries';
import { createCodexBrowserFixture } from './codex-test-helpers';

const tempRoots: string[] = [];

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('Codex path-scoped queries', () => {
    it('should apply exact descendant and inclusive time filtering before row hydration', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'codex-path-scoped-test-'));
        tempRoots.push(root);
        const fixture = await createCodexBrowserFixture(root);
        const db = new Database(fixture.dbPath);
        db.prepare(
            `INSERT INTO threads (
                id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
                sandbox_policy, approval_mode, tokens_used, has_user_event, archived, archived_at,
                git_sha, git_branch, git_origin_url, cli_version, first_user_message, agent_nickname,
                agent_role, memory_mode, model, reasoning_effort, agent_path, created_at_ms,
                updated_at_ms, thread_source, preview
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            'descendant-thread',
            path.join(root, 'sessions', 'descendant.jsonl'),
            1_779_030_000,
            1_779_037_924,
            'vscode',
            'openai',
            '/Users/example/workspace/spiracha/packages/app',
            'Descendant',
            '{}',
            'never',
            1,
            1,
            0,
            null,
            null,
            null,
            null,
            '',
            'descendant',
            null,
            null,
            'enabled',
            'gpt-5.4',
            'high',
            null,
            1_779_030_000_000,
            1_779_037_924_000,
            'user',
            'descendant',
        );
        db.prepare('UPDATE threads SET updated_at_ms = ? WHERE id = ?').run(
            1_779_033_600_000,
            fixture.threads[1]!.threadId,
        );
        db.close();

        const threads = await listCodexThreadsForPath(fixture.dbPath, '/Users/example/workspace/other/../spiracha///', {
            updatedAfterMs: 1_779_033_600_000,
            updatedBeforeMs: 1_779_037_924_000,
        });

        expect(threads.map((thread) => thread.id)).toEqual([
            'descendant-thread',
            fixture.threads[0]!.threadId,
            fixture.threads[1]!.threadId,
        ]);
        expect(threads.every((thread) => thread.cwd.includes('/Users/example/workspace/spiracha'))).toBe(true);
    });

    it('should keep database thread ids authoritative when a matching fallback session has a different cwd', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'codex-path-precedence-test-'));
        tempRoots.push(root);
        const fixture = await createCodexBrowserFixture(root);
        const db = new Database(fixture.dbPath);
        db.prepare('UPDATE threads SET cwd = ? WHERE id = ?').run(
            '/Users/example/workspace/other',
            fixture.threads[0]!.threadId,
        );
        db.close();

        const threads = await listCodexThreadsForPath(fixture.dbPath, '/Users/example/workspace/spiracha');

        expect(threads.map((thread) => thread.id)).toEqual([fixture.threads[1]!.threadId]);
    });
});
