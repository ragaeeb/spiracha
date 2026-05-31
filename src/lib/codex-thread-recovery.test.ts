import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ThreadRow } from './codex-exporter-types';
import { recoverCodexProjectThreads } from './codex-thread-recovery';

const tempPaths: string[] = [];

afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

type RecoveryFixture = {
    codexDir: string;
    dbPath: string;
    rolloutFiles: {
        subagent: string;
        topLevel: string;
    };
    sessionIndexPath: string;
    threadIds: {
        subagent: string;
        topLevel: string;
    };
};

const createRecoveryFixture = async (tempRoot: string): Promise<RecoveryFixture> => {
    const codexDir = path.join(tempRoot, '.codex');
    const dbPath = path.join(codexDir, 'state_5.sqlite');
    const sessionIndexPath = path.join(codexDir, 'session_index.jsonl');
    const globalStatePath = path.join(codexDir, '.codex-global-state.json');
    const projectCwd = '/Users/user/workspace/recover-me';
    const topLevelThreadId = 'thread-top-level';
    const subagentThreadId = 'thread-subagent';
    const topLevelRollout = path.join(codexDir, 'sessions', '2026', '05', '30', 'rollout-top-level.jsonl');
    const subagentRollout = path.join(codexDir, 'sessions', '2026', '05', '30', 'rollout-subagent.jsonl');

    await mkdir(path.dirname(topLevelRollout), { recursive: true });
    await Bun.write(topLevelRollout, JSON.stringify({ type: 'session_meta' }));
    await Bun.write(subagentRollout, JSON.stringify({ type: 'session_meta' }));

    await Bun.write(
        globalStatePath,
        JSON.stringify({
            'active-workspace-roots': ['/Users/user/workspace/another-project'],
            'electron-saved-workspace-roots': ['/Users/user/workspace/another-project'],
            'project-order': ['/Users/user/workspace/another-project'],
        }),
    );

    await Bun.write(
        sessionIndexPath,
        [
            JSON.stringify({
                id: topLevelThreadId,
                thread_name: 'Recover me',
                updated_at: '2026-05-01T00:00:00Z',
            }),
            JSON.stringify({
                id: subagentThreadId,
                thread_name: 'Subagent thread',
                updated_at: '2026-05-01T00:00:00Z',
            }),
        ].join('\n') + '\n',
    );

    const db = new Database(dbPath);
    db.exec(`
        CREATE TABLE threads (
            id TEXT PRIMARY KEY,
            rollout_path TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            source TEXT NOT NULL,
            model_provider TEXT NOT NULL,
            cwd TEXT NOT NULL,
            title TEXT NOT NULL,
            sandbox_policy TEXT NOT NULL,
            approval_mode TEXT NOT NULL,
            tokens_used INTEGER NOT NULL DEFAULT 0,
            has_user_event INTEGER NOT NULL DEFAULT 0,
            archived INTEGER NOT NULL DEFAULT 0,
            archived_at INTEGER,
            git_sha TEXT,
            git_branch TEXT,
            git_origin_url TEXT,
            cli_version TEXT NOT NULL DEFAULT '',
            first_user_message TEXT NOT NULL DEFAULT '',
            agent_nickname TEXT,
            agent_role TEXT,
            memory_mode TEXT NOT NULL DEFAULT 'enabled',
            model TEXT,
            reasoning_effort TEXT,
            agent_path TEXT,
            created_at_ms INTEGER,
            updated_at_ms INTEGER,
            thread_source TEXT,
            preview TEXT NOT NULL DEFAULT ''
        );
    `);

    const insertThread = db.prepare(`
        INSERT INTO threads (
            id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
            sandbox_policy, approval_mode, tokens_used, has_user_event, archived, archived_at,
            git_sha, git_branch, git_origin_url, cli_version, first_user_message, agent_nickname,
            agent_role, memory_mode, model, reasoning_effort, agent_path, created_at_ms,
            updated_at_ms, thread_source, preview
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const baseThread = (threadId: string, rolloutPath: string, threadSource: string | null): ThreadRow => ({
        agent_nickname: null,
        agent_path: null,
        agent_role: null,
        approval_mode: 'never',
        archived: 0,
        archived_at: null,
        cli_version: '0.1.0',
        created_at: 1,
        created_at_ms: 1000,
        cwd: projectCwd,
        first_user_message: 'Recover this thread',
        git_branch: null,
        git_origin_url: null,
        git_sha: null,
        has_user_event: 0,
        id: threadId,
        memory_mode: 'enabled',
        model: 'gpt-5.4',
        model_provider: 'openai',
        preview: 'Recover this thread',
        reasoning_effort: null,
        rollout_path: rolloutPath,
        sandbox_policy: '{"type":"danger-full-access"}',
        source: 'vscode',
        thread_source: threadSource,
        title: threadSource === 'subagent' ? 'Subagent thread' : 'Recover me',
        tokens_used: 42,
        updated_at: 2,
        updated_at_ms: 2000,
    });

    for (const thread of [
        baseThread(topLevelThreadId, topLevelRollout, 'user'),
        baseThread(subagentThreadId, subagentRollout, 'subagent'),
    ]) {
        insertThread.run(
            thread.id,
            thread.rollout_path,
            thread.created_at,
            thread.updated_at,
            thread.source,
            thread.model_provider,
            thread.cwd,
            thread.title,
            thread.sandbox_policy,
            thread.approval_mode,
            thread.tokens_used,
            thread.has_user_event,
            thread.archived,
            thread.archived_at,
            thread.git_sha,
            thread.git_branch,
            thread.git_origin_url,
            thread.cli_version,
            thread.first_user_message,
            thread.agent_nickname,
            thread.agent_role,
            thread.memory_mode,
            thread.model,
            thread.reasoning_effort,
            thread.agent_path,
            thread.created_at_ms,
            thread.updated_at_ms,
            thread.thread_source,
            thread.preview,
        );
    }

    db.close();

    return {
        codexDir,
        dbPath,
        rolloutFiles: {
            subagent: subagentRollout,
            topLevel: topLevelRollout,
        },
        sessionIndexPath,
        threadIds: {
            subagent: subagentThreadId,
            topLevel: topLevelThreadId,
        },
    };
};

describe('codex thread recovery', () => {
    it('should refresh top-level project threads and add missing workspace roots', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-thread-recovery-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createRecoveryFixture(tempRoot);
        const previousMtime = (await stat(fixture.rolloutFiles.topLevel)).mtimeMs;

        const result = await recoverCodexProjectThreads(fixture.dbPath, 'recover-me');

        expect(result.projectName).toBe('recover-me');
        expect(result.resolvedCwds).toEqual(['/Users/user/workspace/recover-me']);
        expect(result.savedRootsAdded).toBe(1);
        expect(result.projectRootsAdded).toBe(1);
        expect(result.topLevelThreadsFound).toBe(1);
        expect(result.threadDbRowsUpdated).toBe(1);
        expect(result.sessionIndexRowsUpdated).toBe(1);
        expect(result.rolloutFilesTouched).toBe(1);

        const state = (await Bun.file(path.join(fixture.codexDir, '.codex-global-state.json')).json()) as {
            'electron-saved-workspace-roots': string[];
            'project-order': string[];
        };
        expect(state['electron-saved-workspace-roots']).toContain('/Users/user/workspace/recover-me');
        expect(state['project-order']).toContain('/Users/user/workspace/recover-me');

        const db = new Database(fixture.dbPath, { readonly: true });
        const topLevel = db
            .query('SELECT has_user_event, updated_at_ms FROM threads WHERE id = ?')
            .get(fixture.threadIds.topLevel) as { has_user_event: number; updated_at_ms: number };
        const subagent = db
            .query('SELECT has_user_event, updated_at_ms FROM threads WHERE id = ?')
            .get(fixture.threadIds.subagent) as { has_user_event: number; updated_at_ms: number };
        db.close();

        expect(topLevel.has_user_event).toBe(1);
        expect(topLevel.updated_at_ms).toBeGreaterThan(2000);
        expect(subagent.updated_at_ms).toBe(2000);

        const sessionIndexLines = (await Bun.file(fixture.sessionIndexPath).text())
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line) as { id: string; updated_at: string });
        const topLevelIndex = sessionIndexLines.find((line) => line.id === fixture.threadIds.topLevel);
        const subagentIndex = sessionIndexLines.find((line) => line.id === fixture.threadIds.subagent);
        expect(topLevelIndex?.updated_at).not.toBe('2026-05-01T00:00:00Z');
        expect(subagentIndex?.updated_at).toBe('2026-05-01T00:00:00Z');

        const nextMtime = (await stat(fixture.rolloutFiles.topLevel)).mtimeMs;
        expect(nextMtime).toBeGreaterThanOrEqual(previousMtime);
        expect(await Bun.file(result.backups.globalState).exists()).toBe(true);
        expect(await Bun.file(result.backups.stateDb).exists()).toBe(true);
        expect(await Bun.file(result.backups.sessionIndex).exists()).toBe(true);
    });

    it('should backfill saved roots and project order when the cwd is only active', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-thread-recovery-active-only-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createRecoveryFixture(tempRoot);
        const globalStatePath = path.join(fixture.codexDir, '.codex-global-state.json');
        await Bun.write(
            globalStatePath,
            JSON.stringify({
                'active-workspace-roots': ['/Users/user/workspace/recover-me'],
                'electron-saved-workspace-roots': ['/Users/user/workspace/another-project'],
                'project-order': ['/Users/user/workspace/another-project'],
            }),
        );

        const result = await recoverCodexProjectThreads(fixture.dbPath, 'recover-me');

        expect(result.savedRootsAdded).toBe(1);
        expect(result.projectRootsAdded).toBe(1);
        const state = (await Bun.file(globalStatePath).json()) as {
            'active-workspace-roots': string[];
            'electron-saved-workspace-roots': string[];
            'project-order': string[];
        };
        expect(state['active-workspace-roots']).toEqual(['/Users/user/workspace/recover-me']);
        expect(state['electron-saved-workspace-roots']).toContain('/Users/user/workspace/recover-me');
        expect(state['project-order']).toContain('/Users/user/workspace/recover-me');
    });
});
