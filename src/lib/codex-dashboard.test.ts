import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getCodexDashboardSummary } from './codex-dashboard';

const tempRoots: string[] = [];

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((tempRoot) => rm(tempRoot, { force: true, recursive: true })));
});

describe('Codex dashboard', () => {
    it('should normalize nullable display fields at the database boundary', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spiracha-codex-dashboard-nullable-'));
        tempRoots.push(tempRoot);
        const dbPath = path.join(tempRoot, 'state.sqlite');
        const db = new Database(dbPath);
        db.exec(`
            CREATE TABLE threads (
                id TEXT PRIMARY KEY,
                rollout_path TEXT NOT NULL,
                cwd TEXT NOT NULL,
                title TEXT,
                preview TEXT,
                first_user_message TEXT,
                model TEXT,
                tokens_used INTEGER NOT NULL,
                archived INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                updated_at_ms INTEGER
            );
            INSERT INTO threads VALUES (
                'nullable-dashboard-thread',
                'missing-rollout.jsonl',
                '/workspace/spiracha',
                NULL,
                NULL,
                NULL,
                NULL,
                10,
                0,
                1779037924,
                NULL
            );
        `);
        db.close();

        const summary = await getCodexDashboardSummary(dbPath);

        expect(summary.recentThreads).toHaveLength(1);
        expect(summary.recentThreads[0]?.thread).toMatchObject({
            id: 'nullable-dashboard-thread',
            preview: 'No transcript preview available.',
            title: 'Untitled Codex thread',
        });
    });
});
