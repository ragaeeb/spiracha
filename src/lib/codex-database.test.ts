import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    assertSafeCodexRolloutPaths,
    CodexDbCompatibilityError,
    decodeThreadGoalRow,
    decodeThreadRow,
} from './codex-database';

const validThreadRow = {
    agent_nickname: 'assistant',
    agent_path: null,
    agent_role: null,
    approval_mode: 'never',
    archived: 0,
    archived_at: null,
    cli_version: '0.1.0',
    created_at: 1_700_000_000,
    created_at_ms: 1_700_000_000_000,
    cwd: '/workspace/project',
    first_user_message: 'Build the project',
    git_branch: 'main',
    git_origin_url: null,
    git_sha: null,
    has_user_event: 1,
    id: 'thread-1',
    memory_mode: 'enabled',
    model: 'gpt-5.4',
    model_provider: 'openai',
    preview: 'Build the project',
    reasoning_effort: null,
    rollout_path: 'sessions/thread-1.jsonl',
    sandbox_policy: '{}',
    source: 'vscode',
    thread_source: null,
    title: 'Build the project',
    tokens_used: 12,
    updated_at: 1_700_000_001,
    updated_at_ms: 1_700_000_001_000,
};

describe('Codex thread row decoding', () => {
    it('should preserve undefined nullable numbers as null in shared row decoding', () => {
        expect(
            decodeThreadGoalRow({
                created_at_ms: 1,
                goal_id: 'goal-1',
                objective: 'Ship the goal',
                status: 'in_progress',
                time_used_seconds: 2,
                token_budget: undefined,
                tokens_used: 3,
                updated_at_ms: 4,
            }).token_budget,
        ).toBeNull();
    });

    it('should treat omitted nullable database fields as null', () => {
        const decoded = decodeThreadRow({
            ...validThreadRow,
            agent_nickname: undefined,
            agent_path: undefined,
            agent_role: undefined,
            archived_at: undefined,
            created_at_ms: undefined,
            git_branch: undefined,
            git_origin_url: undefined,
            git_sha: undefined,
            model: undefined,
            reasoning_effort: undefined,
            thread_source: undefined,
            updated_at_ms: undefined,
        });

        expect(decoded).toMatchObject({
            agent_nickname: null,
            agent_path: null,
            agent_role: null,
            archived_at: null,
            created_at_ms: null,
            git_branch: null,
            git_origin_url: null,
            git_sha: null,
            model: null,
            reasoning_effort: null,
            thread_source: null,
            updated_at_ms: null,
        });
    });

    it('should report invalid nullable strings through the shared decoder', () => {
        try {
            decodeThreadRow({ ...validThreadRow, model: 42 });
            throw new Error('expected invalid nullable string');
        } catch (error) {
            expect(error).toBeInstanceOf(CodexDbCompatibilityError);
            expect(error).toMatchObject({ invalidFields: ['threads.model'] });
        }
    });
});

it('should canonicalize missing rollouts through existing ancestors and reject escaped parents', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-rollout-path-'));
    try {
        const home = path.join(root, 'home');
        await mkdir(home);
        await symlink(home, path.join(root, 'alias'));
        await symlink(root, path.join(home, 'escape'));
        const dbPath = path.join(root, 'alias', 'state.sqlite');
        await expect(assertSafeCodexRolloutPaths(dbPath, ['sessions/missing/rollout.jsonl'])).resolves.toBeUndefined();
        await expect(assertSafeCodexRolloutPaths(dbPath, ['escape/missing/rollout.jsonl'])).rejects.toThrow(
            'Unsafe Codex rollout path',
        );
        await expect(assertSafeCodexRolloutPaths(dbPath, ['..'])).rejects.toThrow('Unsafe Codex rollout path');
    } finally {
        await rm(root, { force: true, recursive: true });
    }
});
