import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encodeMessage, encodeString } from './antigravity-protobuf-test-helpers';
import { readAntigravityTrajectoryEntriesWithDiagnostics } from './antigravity-trajectory';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
    );
});

describe('Antigravity trajectory reader', () => {
    it('should keep valid steps when a neighboring protobuf row is corrupt', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'antigravity-trajectory-'));
        temporaryDirectories.push(directory);
        const databasePath = path.join(directory, 'conversation.db');
        const database = new Database(databasePath, { create: true });
        database.exec(
            'CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER NOT NULL, status INTEGER NOT NULL, metadata BLOB, step_payload BLOB)',
        );
        database
            .prepare('INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)')
            .run(1, 14, 3, null, new Uint8Array([0xff]));
        database
            .prepare('INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)')
            .run(2, 14, 3, null, new Uint8Array(encodeMessage(19, encodeString(2, 'keep me'))));
        database.close();

        const result = await readAntigravityTrajectoryEntriesWithDiagnostics(databasePath);

        expect(result.entries).toEqual([
            expect.objectContaining({ content: 'keep me', step_index: 2, type: 'USER_INPUT' }),
        ]);
        expect(result.diagnostics).toEqual([
            expect.objectContaining({ byteOffset: null, message: expect.stringContaining('step 1'), stepIndex: 1 }),
        ]);
    });

    it('should cap trajectory protobuf diagnostics while retaining valid later steps', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'antigravity-trajectory-bounded-'));
        temporaryDirectories.push(directory);
        const databasePath = path.join(directory, 'conversation.db');
        const database = new Database(databasePath, { create: true });
        database.exec(
            'CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER NOT NULL, status INTEGER NOT NULL, metadata BLOB, step_payload BLOB)',
        );
        const insert = database.prepare(
            'INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)',
        );
        for (let index = 1; index <= 150; index += 1) {
            insert.run(index, 14, 3, null, new Uint8Array([0xff]));
        }
        insert.run(151, 14, 3, null, new Uint8Array(encodeMessage(19, encodeString(2, 'keep me'))));
        database.close();

        const result = await readAntigravityTrajectoryEntriesWithDiagnostics(databasePath);

        expect(result.entries).toEqual([
            expect.objectContaining({ content: 'keep me', step_index: 151, type: 'USER_INPUT' }),
        ]);
        expect(result.diagnostics).toHaveLength(100);
    });
});
