import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deleteFxSession } from './fx-db';
import { writeFxFixture } from './fx-test-helpers';

describe('FX deletion preflight', () => {
    it('should preserve all indexes and the session when a secondary index is malformed', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-fx-preflight-'));
        try {
            const fixture = await writeFxFixture(root);
            const primary = path.join(fixture.sessionsDir, 'index.json');
            const secondary = path.join(fixture.sessionsDir, 'relationship-migration-index.json');
            const originalPrimary = await Bun.file(primary).text();
            await Bun.write(secondary, '{broken');
            await expect(deleteFxSession(root, fixture.sessionId)).rejects.toThrow('Invalid FX session index');
            await Bun.sleep(25);
            expect(await Bun.file(primary).text()).toBe(originalPrimary);
            expect(await Bun.file(secondary).text()).toBe('{broken');
            expect(await Bun.file(path.join(fixture.sessionDir, 'session.json')).exists()).toBe(true);
            expect(await Bun.file(path.join(fixture.sessionsDir, 'latest', 'workspace.json')).exists()).toBe(true);
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('should preserve a foreign index entry inserted after preflight', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-fx-interleave-'));
        try {
            const fixture = await writeFxFixture(root);
            const indexPath = path.join(fixture.sessionsDir, 'index.json');
            await deleteFxSession(root, fixture.sessionId, {
                beforeIndexWrite: async () => {
                    const current = await Bun.file(indexPath).json();
                    current.sessions.push({ id: 'foreign-session', title: 'keep me' });
                    await Bun.write(indexPath, `${JSON.stringify(current, null, 2)}\n`);
                },
            });
            const sessions = (await Bun.file(indexPath).json()).sessions as Array<{ id: string }>;
            expect(sessions.map((session) => session.id)).toEqual(['foreign-session']);
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });
});
