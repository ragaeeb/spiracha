import { Database } from 'bun:sqlite';
import { afterEach, expect, it, spyOn } from 'bun:test';
import { link, mkdir, mkdtemp, rename, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withFileMutationLock } from './file-mutation-lock';

const roots: string[] = [];
const fixture = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-mutation-lock-'));
    roots.push(root);
    return root;
};

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

it('should serialize asynchronous actions while allowing timers to release contention', async () => {
    const root = await fixture();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const events: string[] = [];
    const first = withFileMutationLock(root, async () => {
        events.push('first started');
        entered.resolve();
        await release.promise;
        events.push('first finished');
    });
    await entered.promise;
    const second = withFileMutationLock(root, async () => {
        events.push('second started');
    });
    const timer = setTimeout(() => {
        events.push('timer');
        release.resolve();
    }, 10);
    try {
        await Promise.all([first, second]);
        expect(events).toEqual(['first started', 'timer', 'first finished', 'second started']);
    } finally {
        clearTimeout(timer);
        release.resolve();
        await Promise.allSettled([first, second]);
    }
});

it('should release the transaction and handles when its action rejects', async () => {
    const root = await fixture();
    const error = new TypeError('action failed');
    await expect(
        withFileMutationLock(root, async () => {
            throw error;
        }),
    ).rejects.toBe(error);
    await expect(withFileMutationLock(root, async () => 'recovered')).resolves.toBe('recovered');
    const db = new Database(path.join(root, '.spiracha-mutation-lock.sqlite'));
    try {
        db.run('PRAGMA busy_timeout = 0');
        db.run('BEGIN IMMEDIATE');
        db.run('ROLLBACK');
    } finally {
        db.close();
    }
});

it.each(['file', 'symlink'])('should reject an unsafe %s directory without running its action', async (kind) => {
    const root = await fixture();
    const unsafe = path.join(root, 'unsafe');
    if (kind === 'file') {
        await Bun.write(unsafe, 'not a directory');
    } else {
        await symlink(root, unsafe);
    }
    let called = false;
    await expect(
        withFileMutationLock(unsafe, async () => {
            called = true;
        }),
    ).rejects.toThrow('Unsafe mutation lock directory');
    expect(called).toBe(false);
});

it.each(['', '-journal', '-wal', '-shm'])(
    'should reject unsafe lock files%s before running an action',
    async (suffix) => {
        const root = await fixture();
        const target = path.join(root, 'retained');
        await Bun.write(target, 'retain this file');
        const unsafe = path.join(root, `.spiracha-mutation-lock.sqlite${suffix}`);
        for (const kind of ['symlink', 'hardlink', 'directory']) {
            if (kind === 'symlink') {
                await symlink(target, unsafe);
            } else if (kind === 'hardlink') {
                await link(target, unsafe);
            } else {
                await mkdir(unsafe);
            }
            let called = false;
            await expect(
                withFileMutationLock(root, async () => {
                    called = true;
                }),
            ).rejects.toThrow('Unsafe mutation lock file');
            expect(called).toBe(false);
            expect(await Bun.file(target).text()).toBe('retain this file');
            await rm(unsafe, { recursive: true });
        }
    },
);

it.each(['file', 'directory', 'hardlink'])(
    'should reject a replaced %s after awaiting lock acquisition',
    async (kind) => {
        const root = await fixture();
        const directory = path.join(root, 'store');
        await mkdir(directory);
        const lockPath = path.join(directory, '.spiracha-mutation-lock.sqlite');
        const holder = new Database(lockPath);
        holder.exec('CREATE TABLE marker(value INTEGER); BEGIN IMMEDIATE');
        const attempted = Promise.withResolvers<void>();
        const originalRun = Database.prototype.run;
        const run = spyOn(Database.prototype, 'run').mockImplementation(function (this: Database, sql, ...bindings) {
            if (sql === 'BEGIN IMMEDIATE') {
                attempted.resolve();
            }
            return originalRun.call(this, sql, ...bindings);
        });
        let called = false;
        const pending = withFileMutationLock(directory, async () => {
            called = true;
        });
        try {
            await attempted.promise;
            if (kind === 'file') {
                await rename(lockPath, path.join(directory, 'previous.sqlite'));
                new Database(lockPath).close();
            } else if (kind === 'hardlink') {
                await link(lockPath, path.join(directory, 'alias.sqlite'));
            } else {
                await rename(directory, path.join(root, 'previous'));
                await mkdir(directory);
            }
            holder.exec('ROLLBACK');
            await expect(pending).rejects.toThrow();
            expect(called).toBe(false);
        } finally {
            run.mockRestore();
            holder.close();
            await Promise.allSettled([pending]);
        }
    },
);
