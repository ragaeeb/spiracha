import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readAntigravityTrajectoryEntriesWithDiagnostics } from './antigravity-trajectory';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
    );
});

const encodeVarint = (value: number): number[] => {
    const bytes: number[] = [];
    let remaining = value;
    while (remaining >= 0x80) {
        bytes.push((remaining & 0x7f) | 0x80);
        remaining = Math.floor(remaining / 0x80);
    }
    bytes.push(remaining);
    return bytes;
};

const encodeString = (fieldNumber: number, value: string): Uint8Array => {
    const bytes = [...Buffer.from(value, 'utf8')];
    return new Uint8Array([...encodeVarint((fieldNumber << 3) | 2), ...encodeVarint(bytes.length), ...bytes]);
};

const encodeMessage = (fieldNumber: number, value: Uint8Array): Uint8Array =>
    new Uint8Array([...encodeVarint((fieldNumber << 3) | 2), ...encodeVarint(value.length), ...value]);

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
            .run(2, 14, 3, null, encodeMessage(19, encodeString(2, 'keep me')));
        database.close();

        const result = await readAntigravityTrajectoryEntriesWithDiagnostics(databasePath);

        expect(result.entries).toEqual([
            expect.objectContaining({ content: 'keep me', step_index: 2, type: 'USER_INPUT' }),
        ]);
        expect(result.diagnostics).toEqual([
            expect.objectContaining({ byteOffset: null, message: expect.stringContaining('step 1'), stepIndex: 1 }),
        ]);
    });
});
