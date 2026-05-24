import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    buildExportTargets,
    buildSpawnEdgeQuery,
    buildThreadQuery,
    findJsonlFiles,
    matchesFilters,
    shouldScanFallbackSessionFiles,
    toCodexRelativePath,
    toOutputRelativePath,
} from './codex-exporter-db';
import { DEFAULT_CODEX_DIR, type ThreadData, type ThreadRow } from './codex-exporter-types';

const tempPaths: string[] = [];

afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

const createThreadRow = (overrides: Partial<ThreadRow> = {}): ThreadRow => {
    return {
        agent_nickname: null,
        agent_path: null,
        agent_role: null,
        approval_mode: 'never',
        archived: 0,
        archived_at: null,
        cli_version: '0.1.0',
        created_at: 1,
        created_at_ms: 1000,
        cwd: '/tmp/summer',
        first_user_message: 'hello',
        git_branch: 'main',
        git_origin_url: null,
        git_sha: null,
        has_user_event: 1,
        id: 'thread-a',
        memory_mode: 'enabled',
        model: 'gpt-5.4',
        model_provider: 'openai',
        preview: 'hello',
        reasoning_effort: 'high',
        rollout_path: '/tmp/input/2026/04/23/rollout-thread-a.jsonl',
        sandbox_policy: '{"type":"danger-full-access"}',
        source: 'vscode',
        thread_source: 'user',
        title: 'Thread A',
        tokens_used: 42,
        updated_at: 2,
        updated_at_ms: 2000,
        ...overrides,
    };
};

describe('codex exporter db helpers', () => {
    it('should build thread queries for id, cwd, and project filters', () => {
        expect(
            buildThreadQuery({
                cwdFilter: null,
                dbPath: '/tmp/state.sqlite',
                flat: false,
                includeCommentary: true,
                includeTools: false,
                inputDir: '/tmp/input',
                optimized: false,
                outputDir: '/tmp/output',
                outputFormat: 'md',
                projectFilter: null,
                threadIds: [],
            }),
        ).toEqual({
            params: [],
            sql: 'SELECT * FROM threads',
        });

        expect(
            buildThreadQuery({
                cwdFilter: '/tmp/summer',
                dbPath: '/tmp/state.sqlite',
                flat: false,
                includeCommentary: true,
                includeTools: false,
                inputDir: '/tmp/input',
                optimized: false,
                outputDir: '/tmp/output',
                outputFormat: 'md',
                projectFilter: 'summer_%',
                threadIds: ['a', 'b'],
            }),
        ).toEqual({
            params: ['a', 'b', '/tmp/summer', 'summer_%', '%/summer\\_\\%', '%\\summer\\_\\%'],
            sql: [
                'SELECT * FROM threads WHERE',
                'id IN (?, ?) AND',
                'cwd = ? AND',
                "(cwd = ? OR cwd LIKE ? ESCAPE '\\' OR cwd LIKE ? ESCAPE '\\')",
            ].join(' '),
        });
    });

    it('should build scoped and unscoped spawn-edge queries', () => {
        expect(
            buildSpawnEdgeQuery(['a', 'b'], {
                cwdFilter: null,
                dbPath: '/tmp/state.sqlite',
                flat: false,
                includeCommentary: true,
                includeTools: false,
                inputDir: '/tmp/input',
                optimized: false,
                outputDir: '/tmp/output',
                outputFormat: 'md',
                projectFilter: null,
                threadIds: ['a'],
            }),
        ).toEqual({
            params: ['a', 'b', 'a', 'b'],
            sql: 'SELECT * FROM thread_spawn_edges WHERE parent_thread_id IN (?, ?) OR child_thread_id IN (?, ?)',
        });

        expect(
            buildSpawnEdgeQuery([], {
                cwdFilter: null,
                dbPath: '/tmp/state.sqlite',
                flat: false,
                includeCommentary: true,
                includeTools: false,
                inputDir: '/tmp/input',
                optimized: false,
                outputDir: '/tmp/output',
                outputFormat: 'md',
                projectFilter: null,
                threadIds: [],
            }),
        ).toEqual({
            params: [],
            sql: 'SELECT * FROM thread_spawn_edges',
        });
    });

    it('should find jsonl files recursively and sorted', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-exporter-db-test-'));
        tempPaths.push(tempRoot);
        await mkdir(path.join(tempRoot, '2026', '04', '23'), { recursive: true });
        await Bun.write(path.join(tempRoot, '2026', '04', '23', 'b.jsonl'), '');
        await Bun.write(path.join(tempRoot, 'a.jsonl'), '');
        await Bun.write(path.join(tempRoot, 'ignore.txt'), '');

        expect(await findJsonlFiles(tempRoot)).toEqual([
            path.join(tempRoot, '2026', '04', '23', 'b.jsonl'),
            path.join(tempRoot, 'a.jsonl'),
        ]);
    });

    it('should match cwd and project filters and decide when fallback session scanning is allowed', () => {
        expect(matchesFilters('/tmp/summer', { cwdFilter: '/tmp/summer', projectFilter: 'summer' })).toBe(true);
        expect(matchesFilters('/tmp/summer', { cwdFilter: '/tmp/winter', projectFilter: 'summer' })).toBe(false);
        expect(matchesFilters('C:\\Users\\user\\workspace\\summer', { cwdFilter: null, projectFilter: 'summer' })).toBe(
            true,
        );
        expect(matchesFilters(null, { cwdFilter: null, projectFilter: 'summer' })).toBe(false);

        expect(
            shouldScanFallbackSessionFiles({
                cwdFilter: null,
                dbPath: '/tmp/state.sqlite',
                flat: false,
                includeCommentary: true,
                includeTools: false,
                inputDir: '/tmp/input',
                optimized: false,
                outputDir: '/tmp/output',
                outputFormat: 'md',
                projectFilter: null,
                threadIds: [],
            }),
        ).toBe(true);
        expect(
            shouldScanFallbackSessionFiles({
                cwdFilter: '/tmp/summer',
                dbPath: '/tmp/state.sqlite',
                flat: false,
                includeCommentary: true,
                includeTools: false,
                inputDir: '/tmp/input',
                optimized: false,
                outputDir: '/tmp/output',
                outputFormat: 'md',
                projectFilter: null,
                threadIds: [],
            }),
        ).toBe(false);
    });

    it('should derive output paths from input roots, codex roots, and flat naming rules', () => {
        const inputDir = '/tmp/input';
        const sessionFile = '/tmp/input/2026/04/23/rollout-thread-a.jsonl';
        expect(
            toOutputRelativePath(sessionFile, {
                cwdFilter: null,
                dbPath: '/tmp/state.sqlite',
                flat: false,
                includeCommentary: true,
                includeTools: false,
                inputDir,
                optimized: false,
                outputDir: '/tmp/output',
                outputFormat: 'txt',
                projectFilter: null,
                threadIds: [],
            }),
        ).toBe(path.join('2026', '04', '23', 'rollout-thread-a.txt'));

        const codexSession = path.join(DEFAULT_CODEX_DIR, 'sessions', '2026', '04', '23', 'rollout-thread-a.jsonl');
        expect(
            toOutputRelativePath(codexSession, {
                cwdFilter: null,
                dbPath: '/tmp/state.sqlite',
                flat: false,
                includeCommentary: true,
                includeTools: false,
                inputDir: '/tmp/other',
                optimized: false,
                outputDir: '/tmp/output',
                outputFormat: 'md',
                projectFilter: null,
                threadIds: [],
            }),
        ).toBe(path.join('sessions', '2026', '04', '23', 'rollout-thread-a.md'));

        expect(
            toOutputRelativePath(
                '/tmp/custom/rollout-thread-a.jsonl',
                {
                    cwdFilter: null,
                    dbPath: '/tmp/state.sqlite',
                    flat: true,
                    includeCommentary: true,
                    includeTools: false,
                    inputDir,
                    optimized: false,
                    outputDir: '/tmp/output',
                    outputFormat: 'md',
                    projectFilter: null,
                    threadIds: [],
                },
                '/tmp/summer',
            ),
        ).toBe('summer.md');
    });

    it('should build export targets with fallback files, relation sorting, and unique flat names', () => {
        const sessionA = '/tmp/input/rollout-thread-a.jsonl';
        const sessionB = '/tmp/input/rollout-thread-b.jsonl';
        const fallbackSession = '/tmp/input/rollout-fallback.jsonl';
        const threadA = createThreadRow({
            id: 'thread-a',
            rollout_path: sessionA,
        });
        const threadB = createThreadRow({
            id: 'thread-b',
            rollout_path: sessionB,
            title: 'Thread B',
        });
        const threadData: ThreadData = {
            childEdgesByParentId: new Map([
                [
                    'thread-a',
                    [
                        { child_thread_id: 'thread-c', parent_thread_id: 'thread-a', status: 'done' },
                        { child_thread_id: 'thread-b', parent_thread_id: 'thread-a', status: 'running' },
                    ],
                ],
            ]),
            parentByChildId: new Map([
                ['thread-b', { child_thread_id: 'thread-b', parent_thread_id: 'thread-a', status: 'running' }],
            ]),
            threadsById: new Map([
                ['thread-a', threadA],
                ['thread-b', threadB],
            ]),
        };

        const flatTargets = buildExportTargets(threadData, [fallbackSession], {
            cwdFilter: null,
            dbPath: '/tmp/state.sqlite',
            flat: true,
            includeCommentary: true,
            includeTools: false,
            inputDir: '/tmp/input',
            optimized: false,
            outputDir: '/tmp/output',
            outputFormat: 'md',
            projectFilter: 'summer',
            threadIds: [],
        });

        expect(flatTargets.map((target) => target.outputRelativePath)).toEqual([
            'rollout-fallback.md',
            'summer__thread-a.md',
            'summer__thread-b.md',
        ]);
        expect(flatTargets[1]?.relations.childEdges.map((edge) => edge.child_thread_id)).toEqual([
            'thread-b',
            'thread-c',
        ]);
        expect(flatTargets[2]?.relations.parentThreadId).toBe('thread-a');
        expect(flatTargets[0]?.fallbackReason).toBe('missing_thread_row');
    });

    it('should preserve requested thread order and compute codex-relative paths', () => {
        const sessionA = '/tmp/input/rollout-thread-a.jsonl';
        const sessionB = '/tmp/input/rollout-thread-b.jsonl';
        const threadA = createThreadRow({ id: 'thread-a', rollout_path: sessionA });
        const threadB = createThreadRow({ id: 'thread-b', rollout_path: sessionB });
        const threadData: ThreadData = {
            childEdgesByParentId: new Map(),
            parentByChildId: new Map(),
            threadsById: new Map([
                ['thread-a', threadA],
                ['thread-b', threadB],
            ]),
        };

        const orderedTargets = buildExportTargets(threadData, [], {
            cwdFilter: null,
            dbPath: '/tmp/state.sqlite',
            flat: false,
            includeCommentary: true,
            includeTools: false,
            inputDir: '/tmp/input',
            optimized: false,
            outputDir: '/tmp/output',
            outputFormat: 'md',
            projectFilter: null,
            threadIds: ['thread-b', 'thread-a'],
        });

        expect(orderedTargets.map((target) => target.thread?.id)).toEqual(['thread-b', 'thread-a']);
        expect(
            toCodexRelativePath(path.join(DEFAULT_CODEX_DIR, 'sessions', '2026', '04', '23', 'rollout-thread-a.jsonl')),
        ).toBe(path.join('sessions', '2026', '04', '23', 'rollout-thread-a.jsonl'));
        expect(toCodexRelativePath('/tmp/outside.jsonl')).toBe(path.resolve('/tmp/outside.jsonl'));
    });
});
