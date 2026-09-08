import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rename, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getSessionFilesByThreadId, readFallbackThreadRow, readSessionIndexEntries } from './codex-fallback-index';

const tempRoots: string[] = [];

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((tempRoot) => rm(tempRoot, { force: true, recursive: true })));
});

describe('Codex fallback index cache', () => {
    it('should evict old filesystem index entries while retaining recently used entries', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spiracha-codex-fallback-index-cache-'));
        tempRoots.push(tempRoot);
        const codexDirs = await Promise.all(
            Array.from({ length: 65 }, async (_, index) => {
                const codexDir = path.join(tempRoot, `codex-${index}`);
                await mkdir(codexDir, { recursive: true });
                await Bun.write(
                    path.join(codexDir, 'session_index.jsonl'),
                    `${JSON.stringify({ id: `index-${index}` })}\n`,
                );
                return codexDir;
            }),
        );

        const firstEntries = readSessionIndexEntries(codexDirs[0]!);
        const secondEntries = readSessionIndexEntries(codexDirs[1]!);
        for (const codexDir of codexDirs.slice(2, 64)) {
            readSessionIndexEntries(codexDir);
        }
        firstEntries.push({ id: 'recency-sentinel' });
        readSessionIndexEntries(codexDirs[0]!);
        secondEntries.push({ id: 'eviction-sentinel' });
        readSessionIndexEntries(codexDirs[64]!);

        expect(readSessionIndexEntries(codexDirs[0]!).map((entry) => entry.id)).toContain('recency-sentinel');
        expect(readSessionIndexEntries(codexDirs[1]!).map((entry) => entry.id)).not.toContain('eviction-sentinel');

        const sessionsDirs = await Promise.all(
            Array.from({ length: 65 }, async (_, index) => {
                const sessionsDir = path.join(tempRoot, `sessions-${index}`);
                const threadId = `00000000-0000-0000-0000-${index.toString(16).padStart(12, '0')}`;
                await mkdir(sessionsDir, { recursive: true });
                await Bun.write(path.join(sessionsDir, `rollout-${threadId}.jsonl`), '');
                return sessionsDir;
            }),
        );
        const firstFiles = getSessionFilesByThreadId(sessionsDirs[0]!);
        const secondFiles = getSessionFilesByThreadId(sessionsDirs[1]!);
        for (const sessionsDir of sessionsDirs.slice(2, 64)) {
            getSessionFilesByThreadId(sessionsDir);
        }
        firstFiles.set('recency-sentinel', '/sentinel');
        getSessionFilesByThreadId(sessionsDirs[0]!);
        secondFiles.set('eviction-sentinel', '/sentinel');
        getSessionFilesByThreadId(sessionsDirs[64]!);

        expect(getSessionFilesByThreadId(sessionsDirs[0]!).get('recency-sentinel')).toBe('/sentinel');
        expect(getSessionFilesByThreadId(sessionsDirs[1]!).get('eviction-sentinel')).toBeUndefined();

        const rowFiles = await Promise.all(
            Array.from({ length: 65 }, async (_, index) => {
                const sessionFile = path.join(tempRoot, 'rows', `row-${index}.jsonl`);
                await mkdir(path.dirname(sessionFile), { recursive: true });
                await Bun.write(
                    sessionFile,
                    `${JSON.stringify({
                        payload: {
                            cwd: `/workspace/project-${index}`,
                            id: `row-${index}`,
                            source: 'vscode',
                            thread_source: 'user',
                            timestamp: '2026-06-14T10:00:00.000Z',
                        },
                        type: 'session_meta',
                    })}\n`,
                );
                return sessionFile;
            }),
        );
        const entries = rowFiles.map((_, index) => ({
            id: `row-${index}`,
            thread_name: `Row ${index}`,
            updated_at: '2026-06-14T10:00:00.000Z',
        }));
        const rows = rowFiles
            .slice(0, 64)
            .map((sessionFile, index) => readFallbackThreadRow(entries[index]!, sessionFile));
        rows[1]!.title = 'eviction-sentinel';
        rows[0]!.title = 'recency-sentinel';
        readFallbackThreadRow(entries[0]!, rowFiles[0]!);
        readFallbackThreadRow(entries[64]!, rowFiles[64]!);

        expect(readFallbackThreadRow(entries[0]!, rowFiles[0]!)?.title).toBe('recency-sentinel');
        expect(readFallbackThreadRow(entries[1]!, rowFiles[1]!)?.title).toBe('Row 1');
    });

    it('should reload a fallback row when a session file is replaced with matching size and mtime', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spiracha-codex-fallback-cache-stale-'));
        tempRoots.push(tempRoot);
        const sessionFile = path.join(tempRoot, 'session.jsonl');
        const replacementFile = path.join(tempRoot, 'session-replacement.jsonl');
        const entry = {
            id: 'fallback-thread',
            thread_name: 'Fallback thread',
            updated_at: '2026-06-14T10:00:00.000Z',
        };
        const fixedTime = new Date('2026-06-14T10:00:00.000Z');
        const writeSession = async (filePath: string, cwd: string) => {
            await mkdir(path.dirname(filePath), { recursive: true });
            await Bun.write(
                filePath,
                `${JSON.stringify({
                    payload: {
                        cwd,
                        id: entry.id,
                        source: 'vscode',
                        thread_source: 'user',
                        timestamp: '2026-06-14T10:00:00.000Z',
                    },
                    type: 'session_meta',
                })}\n`,
            );
            await utimes(filePath, fixedTime, fixedTime);
        };

        await writeSession(sessionFile, '/workspace/one');
        expect(readFallbackThreadRow(entry, sessionFile)?.cwd).toBe('/workspace/one');

        await writeSession(replacementFile, '/workspace/two');
        await rename(replacementFile, sessionFile);

        expect(readFallbackThreadRow(entry, sessionFile)?.cwd).toBe('/workspace/two');
    });
});
