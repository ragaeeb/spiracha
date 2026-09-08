import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readCodexDeletionIntents, writeCodexDeletionIntent } from './codex-deletion-journal';
import { createCodexBrowserFixture } from './codex-test-helpers';
import { deleteCodexThread, reconcileCodexDeletions } from './codex-thread-mutations';

const roots: string[] = [];
const originalCacheDir = process.env.SPIRACHA_UI_CACHE_DIR;
beforeEach(async () => {
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'codex-journal-cache-'));
    roots.push(cacheDir);
    process.env.SPIRACHA_UI_CACHE_DIR = cacheDir;
});
afterEach(async () => {
    if (originalCacheDir === undefined) {
        delete process.env.SPIRACHA_UI_CACHE_DIR;
    } else {
        process.env.SPIRACHA_UI_CACHE_DIR = originalCacheDir;
    }
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

it('should retain a durable intent after an artifact failure and reconcile it without unrelated deletion', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-deletion-recovery-'));
    roots.push(root);
    const fixture = await createCodexBrowserFixture(root);
    const target = fixture.threads[0]!;
    await Bun.write(path.join(root, '.codex-global-state.json'), '{broken');
    await expect(deleteCodexThread(fixture.dbPath, target.threadId, { deleteSessionFiles: true })).rejects.toThrow(
        'pending intent',
    );
    const before = await reconcileCodexDeletions(fixture.dbPath);
    expect(before.reports.map((report) => report.status)).toEqual(['pending']);
    expect(await readCodexDeletionIntents(fixture.dbPath)).toHaveLength(1);
    await Bun.write(path.join(root, '.codex-global-state.json'), '{}');
    expect((await reconcileCodexDeletions(fixture.dbPath, { dryRun: false })).reports).toMatchObject([
        { status: 'completed' },
    ]);
    expect((await reconcileCodexDeletions(fixture.dbPath, { dryRun: false })).reports).toEqual([]);
    expect(await Bun.file(target.sessionFile).exists()).toBe(false);
    expect(await Bun.file(fixture.threads[1]!.sessionFile).exists()).toBe(true);
});

it('should replay a durable intent after a process exits at each cross-store phase', async () => {
    for (const phase of ['intent', 'state', 'history', 'rollout', 'index', 'catalog', 'global'] as const) {
        const root = await mkdtemp(path.join(os.tmpdir(), 'codex-deletion-crash-'));
        roots.push(root);
        const fixture = await createCodexBrowserFixture(root);
        const target = fixture.threads[0]!;
        const historyPath = path.join(root, 'thread_history_1.sqlite');
        const history = new Database(historyPath);
        history.exec('CREATE TABLE thread_turns(thread_id TEXT);');
        history.query('INSERT INTO thread_turns VALUES (?)').run(target.threadId);
        history.close();
        const retained = fixture.threads[1]!;
        await Bun.write(
            path.join(root, 'session_index.jsonl'),
            [target, retained].map((thread) => JSON.stringify({ id: thread.threadId })).join('\n'),
        );
        await Bun.write(
            path.join(root, '.codex-global-state.json'),
            JSON.stringify({ 'projectless-thread-ids': [target.threadId, retained.threadId] }),
        );
        await mkdir(path.join(root, 'sqlite'), { recursive: true });
        const catalog = new Database(path.join(root, 'sqlite', 'codex-dev.db'));
        catalog.exec('CREATE TABLE local_thread_catalog(thread_id TEXT);');
        for (const thread of [target, retained]) {
            catalog.query('INSERT INTO local_thread_catalog VALUES (?)').run(thread.threadId);
        }
        catalog.close();
        await writeCodexDeletionIntent({
            dbPath: fixture.dbPath,
            deleteSessionFiles: true,
            rolloutPaths: [target.sessionFile],
            threadIds: [target.threadId],
            version: 1,
        });
        const child = Bun.spawn(
            [
                process.execPath,
                '-e',
                `
            import { Database } from 'bun:sqlite';
            import { rmSync } from 'node:fs';
            const [dbPath, historyPath, rollout, threadId, root, phase] = Bun.argv.slice(-6);
            const phases = ['intent', 'state', 'history', 'rollout', 'index', 'catalog', 'global'];
            const stop = phases.indexOf(phase);
            if (stop >= 1) { const db = new Database(dbPath); db.query('DELETE FROM threads WHERE id = ?').run(threadId); db.close(); }
            if (stop >= 2) { const db = new Database(historyPath); db.query('DELETE FROM thread_turns WHERE thread_id = ?').run(threadId); db.close(); }
            if (stop >= 3) rmSync(rollout);
            if (stop >= 4) { const file = root + '/session_index.jsonl'; await Bun.write(file, (await Bun.file(file).text()).split('\\n').filter(line => line && JSON.parse(line).id !== threadId).join('\\n')); }
            if (stop >= 5) { const db = new Database(root + '/sqlite/codex-dev.db'); db.query('DELETE FROM local_thread_catalog WHERE thread_id = ?').run(threadId); db.close(); }
            if (stop >= 6) { const file = root + '/.codex-global-state.json'; const state = await Bun.file(file).json(); state['projectless-thread-ids'] = state['projectless-thread-ids'].filter(id => id !== threadId); await Bun.write(file, JSON.stringify(state)); }
            process.kill(process.pid, 'SIGKILL');
        `,
                fixture.dbPath,
                historyPath,
                target.sessionFile,
                target.threadId,
                root,
                phase,
            ],
            { stderr: 'pipe', stdout: 'pipe' },
        );
        expect(await child.exited).not.toBe(0);
        expect(await new Response(child.stderr).text()).toBe('');
        expect(child.signalCode).toBe('SIGKILL');
        const indexBefore = await Bun.file(path.join(root, 'session_index.jsonl')).text();
        const globalBefore = await Bun.file(path.join(root, '.codex-global-state.json')).text();
        const rolloutExisted = await Bun.file(target.sessionFile).exists();
        expect((await reconcileCodexDeletions(fixture.dbPath)).reports).toHaveLength(1);
        expect(await Bun.file(path.join(root, 'session_index.jsonl')).text()).toBe(indexBefore);
        expect(await Bun.file(path.join(root, '.codex-global-state.json')).text()).toBe(globalBefore);
        expect(await Bun.file(target.sessionFile).exists()).toBe(rolloutExisted);
        expect(await readCodexDeletionIntents(fixture.dbPath)).toHaveLength(1);
        expect((await reconcileCodexDeletions(fixture.dbPath, { dryRun: false })).reports).toMatchObject([
            { status: 'completed' },
        ]);
        const db = new Database(fixture.dbPath);
        expect(db.query('SELECT id FROM threads WHERE id = ?').get(target.threadId)).toBeNull();
        expect(db.query('SELECT id FROM threads WHERE id = ?').get(fixture.threads[1]!.threadId)).not.toBeNull();
        db.close();
        const afterHistory = new Database(historyPath);
        expect(afterHistory.query('SELECT * FROM thread_turns').all()).toEqual([]);
        afterHistory.close();
        const afterCatalog = new Database(path.join(root, 'sqlite', 'codex-dev.db'));
        expect(afterCatalog.query('SELECT * FROM local_thread_catalog').all()).toEqual([
            { thread_id: retained.threadId },
        ]);
        afterCatalog.close();
        expect((await Bun.file(path.join(root, '.codex-global-state.json')).json())['projectless-thread-ids']).toEqual([
            retained.threadId,
        ]);
        expect((await Bun.file(path.join(root, 'session_index.jsonl')).text()).trim()).toBe(
            JSON.stringify({ id: retained.threadId }),
        );
        expect(await Bun.file(target.sessionFile).exists()).toBe(false);
        expect(await Bun.file(fixture.threads[1]!.sessionFile).exists()).toBe(true);
        expect((await reconcileCodexDeletions(fixture.dbPath, { dryRun: false })).reports).toEqual([]);
    }
});

it('should report unsafe saved paths without applying any SQL or deleting the journal', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-deletion-unsafe-'));
    roots.push(root);
    const fixture = await createCodexBrowserFixture(root);
    const target = fixture.threads[0]!;
    await writeCodexDeletionIntent({
        dbPath: fixture.dbPath,
        deleteSessionFiles: true,
        rolloutPaths: [path.join(root, '..', 'unrelated.jsonl')],
        threadIds: [target.threadId],
        version: 1,
    });
    const report = await reconcileCodexDeletions(fixture.dbPath, { dryRun: false });
    expect(report.reports).toMatchObject([
        { error: expect.stringContaining('Unsafe Codex rollout path'), status: 'failed' },
    ]);
    expect(await readCodexDeletionIntents(fixture.dbPath)).toHaveLength(1);
    const db = new Database(fixture.dbPath);
    expect(db.query('SELECT id FROM threads WHERE id = ?').get(target.threadId)).not.toBeNull();
    db.close();
});

it('should recover a pending deletion on the next delete request while preserving retained rollouts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-deletion-request-'));
    roots.push(root);
    const fixture = await createCodexBrowserFixture(root);
    const target = fixture.threads[0]!;
    await writeCodexDeletionIntent({
        dbPath: fixture.dbPath,
        deleteSessionFiles: false,
        rolloutPaths: [],
        threadIds: [target.threadId],
        version: 1,
    });
    await deleteCodexThread(fixture.dbPath, fixture.threads[1]!.threadId);
    expect(await readCodexDeletionIntents(fixture.dbPath)).toEqual([]);
    const db = new Database(fixture.dbPath);
    expect(db.query('SELECT id FROM threads WHERE id = ?').get(target.threadId)).toBeNull();
    db.close();
    expect(await Bun.file(target.sessionFile).exists()).toBe(true);
});

it('should release the process lock and recover after interrupting real deletion operations', async () => {
    for (const phase of ['intent', 'sql', 'rollout', 'index', 'catalog', 'global'] as const) {
        const root = await mkdtemp(path.join(os.tmpdir(), 'codex-real-deletion-crash-'));
        roots.push(root);
        const fixture = await createCodexBrowserFixture(root);
        const target = fixture.threads[0]!;
        await Bun.write(path.join(root, 'session_index.jsonl'), JSON.stringify({ id: target.threadId }));
        await Bun.write(
            path.join(root, '.codex-global-state.json'),
            JSON.stringify({ 'projectless-thread-ids': [target.threadId] }),
        );
        await mkdir(path.join(root, 'sqlite'), { recursive: true });
        const catalog = new Database(path.join(root, 'sqlite', 'codex-dev.db'));
        catalog.exec('CREATE TABLE local_thread_catalog(thread_id TEXT)');
        catalog.query('INSERT INTO local_thread_catalog VALUES (?)').run(target.threadId);
        catalog.close();
        const child = Bun.spawn(
            [
                process.execPath,
                '-e',
                `
            import { mock } from 'bun:test';
            import * as fs from 'node:fs/promises';
            import * as journal from './src/lib/codex-deletion-journal.ts';
            import * as database from './src/lib/codex-database.ts';
            const [dbPath, threadId, phase] = Bun.argv.slice(-3);
            const stop = (current) => { if (phase === current) process.kill(process.pid, 'SIGKILL'); };
            const originalWrite = journal.writeCodexDeletionIntent;
            const originalDb = database.withWritableDb;
            const originalRm = fs.rm;
            const originalRename = fs.rename;
            mock.module('./src/lib/codex-deletion-journal.ts', () => ({ ...journal, writeCodexDeletionIntent: async (...args) => { const result = await originalWrite(...args); stop('intent'); return result; } }));
            mock.module('./src/lib/codex-database.ts', () => ({ ...database, withWritableDb: async (file, action) => { const result = await originalDb(file, action); stop(file === dbPath ? 'sql' : 'catalog'); return result; } }));
            mock.module('node:fs/promises', () => ({ ...fs,
                rm: async (file, options) => { const result = await originalRm(file, options); if (String(file).endsWith('.jsonl')) stop('rollout'); return result; },
                rename: async (source, destination) => { const result = await originalRename(source, destination); if (String(destination).endsWith('session_index.jsonl')) stop('index'); if (String(destination).endsWith('.codex-global-state.json')) stop('global'); return result; },
            }));
            const { deleteCodexThread } = await import('./src/lib/codex-thread-mutations.ts');
            await deleteCodexThread(dbPath, threadId, { deleteSessionFiles: true });
        `,
                fixture.dbPath,
                target.threadId,
                phase,
            ],
            { stderr: 'pipe', stdout: 'pipe' },
        );
        await child.exited;
        expect(await new Response(child.stderr).text()).toBe('');
        expect(child.signalCode).toBe('SIGKILL');
        expect((await reconcileCodexDeletions(fixture.dbPath)).reports).toHaveLength(1);
        expect((await reconcileCodexDeletions(fixture.dbPath, { dryRun: false })).reports).toMatchObject([
            { status: 'completed' },
        ]);
        expect(await Bun.file(target.sessionFile).exists()).toBe(false);
        expect(await Bun.file(fixture.threads[1]!.sessionFile).exists()).toBe(true);
    }
});

it('should serialize different cross-process deletions without restoring index or global-state references', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-concurrent-deletions-'));
    roots.push(root);
    const fixture = await createCodexBrowserFixture(root);
    const ids = fixture.threads.map((thread) => thread.threadId);
    await Bun.write(path.join(root, 'session_index.jsonl'), ids.map((id) => JSON.stringify({ id })).join('\n'));
    await Bun.write(path.join(root, '.codex-global-state.json'), JSON.stringify({ 'projectless-thread-ids': ids }));
    const children = ids.slice(0, 2).map((id) =>
        Bun.spawn(
            [
                process.execPath,
                '-e',
                `
        import { deleteCodexThread } from './src/lib/codex-thread-mutations.ts';
        await deleteCodexThread(Bun.argv.at(-2), Bun.argv.at(-1), { deleteSessionFiles: true });
    `,
                fixture.dbPath,
                id,
            ],
            { stderr: 'pipe', stdout: 'pipe' },
        ),
    );
    for (const child of children) {
        expect(await child.exited).toBe(0);
        expect(await new Response(child.stderr).text()).toBe('');
    }
    expect((await Bun.file(path.join(root, '.codex-global-state.json')).json())['projectless-thread-ids']).toEqual(
        ids.slice(2),
    );
    expect(
        (await Bun.file(path.join(root, 'session_index.jsonl')).text())
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line).id),
    ).toEqual(ids.slice(2));
    expect(await readCodexDeletionIntents(fixture.dbPath)).toEqual([]);
});

it('should report malformed intents individually and still reconcile valid intents', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-malformed-deletions-'));
    roots.push(root);
    const fixture = await createCodexBrowserFixture(root);
    const intent = {
        dbPath: fixture.dbPath,
        deleteSessionFiles: false,
        rolloutPaths: [],
        threadIds: [fixture.threads[0]!.threadId],
        version: 1 as const,
    };
    const malformedPath = await writeCodexDeletionIntent(intent);
    await Bun.write(malformedPath, '{broken');
    await writeCodexDeletionIntent(intent);
    expect((await reconcileCodexDeletions(fixture.dbPath)).reports.map((report) => report.status).sort()).toEqual([
        'failed',
        'pending',
    ]);
    expect(
        (await reconcileCodexDeletions(fixture.dbPath, { dryRun: false })).reports
            .map((report) => report.status)
            .sort(),
    ).toEqual(['completed', 'failed']);
    expect(await Bun.file(malformedPath).text()).toBe('{broken');
});
