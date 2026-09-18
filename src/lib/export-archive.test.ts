import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BlobReader, ZipReader } from '@zip.js/zip.js';
import { unzipSync } from 'fflate';
import {
    AtomicExportError,
    assembleExportBatch,
    EmptyPartialExportError,
    EXPORT_ARCHIVE_MANIFEST_FILE,
    writeExportArchive,
} from './export-archive';
import { reserveExportBytes, UI_EXPORT_DIR_ENV } from './ui-export-files';

const originalExportDir = process.env[UI_EXPORT_DIR_ENV];
const originalExportMaxBytes = process.env.SPIRACHA_UI_EXPORT_MAX_BYTES;
const tempPaths: string[] = [];

afterEach(async () => {
    if (originalExportDir === undefined) {
        delete process.env[UI_EXPORT_DIR_ENV];
    } else {
        process.env[UI_EXPORT_DIR_ENV] = originalExportDir;
    }
    if (originalExportMaxBytes === undefined) {
        delete process.env.SPIRACHA_UI_EXPORT_MAX_BYTES;
    } else {
        process.env.SPIRACHA_UI_EXPORT_MAX_BYTES = originalExportMaxBytes;
    }
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

describe('assembleExportBatch', () => {
    it('should keep request order and succeed atomically when every id loads', async () => {
        const assembled = await assembleExportBatch({
            failurePolicy: 'atomic',
            kind: 'batch_normalized_export',
            load: async (id) => ({ members: [{ bytes: `# ${id}`, relativePath: `${id}.md` }] }),
            options: { messageSelector: 'all' },
            requestedIds: ['b', 'a'],
            source: 'grok',
        });

        expect(assembled.members.map((member) => member.relativePath)).toEqual(['b.md', 'a.md']);
        expect(assembled.manifest).toMatchObject({
            failedCount: 0,
            failurePolicy: 'atomic',
            kind: 'batch_normalized_export',
            missingCount: 0,
            requestedCount: 2,
            schemaVersion: 1,
            source: 'grok',
            successCount: 2,
        });
        expect(assembled.manifest.entries.map((entry) => entry.requestedId)).toEqual(['b', 'a']);
    });

    it('should whitelist manifest options instead of retaining a ZIP password', async () => {
        const assembled = await assembleExportBatch({
            failurePolicy: 'atomic',
            kind: 'batch_normalized_export',
            load: async () => ({ members: [{ bytes: 'ok', relativePath: 'ok.md' }] }),
            options: { includeTools: true, outputFormat: 'md', zipPassword: 'do-not-persist' },
            requestedIds: ['ok'],
            source: 'grok',
        });

        expect(assembled.manifest.options).toEqual({ includeTools: true, outputFormat: 'md' });
    });

    it('should refuse to publish an atomic batch when any requested id is missing', async () => {
        await expect(
            assembleExportBatch({
                failurePolicy: 'atomic',
                kind: 'batch_normalized_export',
                load: async (id) => (id === 'missing' ? null : { members: [{ bytes: id, relativePath: `${id}.md` }] }),
                options: {},
                requestedIds: ['ok', 'missing'],
                source: 'grok',
            }),
        ).rejects.toBeInstanceOf(AtomicExportError);
    });

    it('should include successes and every requested outcome for a partial batch', async () => {
        const assembled = await assembleExportBatch({
            failurePolicy: 'partial',
            kind: 'batch_normalized_export',
            load: async (id) => {
                if (id === 'gone') {
                    return null;
                }
                if (id === 'boom') {
                    throw new Error('read failed');
                }
                return { members: [{ bytes: 'ok', relativePath: `${id}.md` }], omissionSummary: 'truncated' };
            },
            options: { includeTools: true },
            requestedIds: ['ok', 'gone', 'boom'],
            source: 'codex',
        });

        expect(assembled.members).toEqual([{ bytes: 'ok', relativePath: 'ok.md' }]);
        expect(assembled.manifest.entries).toEqual([
            {
                error: null,
                memberNames: ['ok.md'],
                omissionSummary: 'truncated',
                requestedId: 'ok',
                status: 'exported',
            },
            {
                error: { code: 'missing', message: 'Conversation not found: gone' },
                memberNames: [],
                omissionSummary: null,
                requestedId: 'gone',
                status: 'missing',
            },
            {
                error: { code: 'failed', message: 'read failed' },
                memberNames: [],
                omissionSummary: null,
                requestedId: 'boom',
                status: 'failed',
            },
        ]);
        expect(assembled.manifest.successCount).toBe(1);
        expect(assembled.manifest.missingCount).toBe(1);
        expect(assembled.manifest.failedCount).toBe(1);
    });

    it('should allocate duplicate and reserved manifest names before writing members', async () => {
        const assembled = await assembleExportBatch({
            failurePolicy: 'atomic',
            kind: 'batch_normalized_export',
            load: async (id) => ({
                members: [{ bytes: id, relativePath: id === 'first' ? 'notes.md' : 'Notes.md' }],
            }),
            options: {},
            requestedIds: ['first', 'second'],
            source: 'codex',
        });
        expect(assembled.members.map((member) => member.relativePath)).toEqual(['notes.md', 'Notes-2.md']);
        expect(assembled.manifest.entries.map((entry) => entry.memberNames)).toEqual([['notes.md'], ['Notes-2.md']]);

        const reserved = await assembleExportBatch({
            failurePolicy: 'atomic',
            kind: 'batch_original_raw',
            load: async () => ({
                members: [{ bytes: 'raw-bytes', relativePath: EXPORT_ARCHIVE_MANIFEST_FILE }],
            }),
            options: {},
            requestedIds: ['raw-1'],
            source: 'codex',
        });
        expect(reserved.manifest.entries[0]?.memberNames).toEqual(['spiracha-manifest-2.json']);
        const archive = await writeExportArchive({
            baseName: 'reserved-raw',
            destination: { mode: 'blob' },
            manifest: reserved.manifest,
            members: reserved.members,
            platform: 'codex',
        });
        if (!('blob' in archive)) {
            throw new Error('Expected an in-memory archive');
        }
        const unzipped = unzipSync(new Uint8Array(await archive.blob.arrayBuffer()));
        expect(Buffer.from(unzipped[EXPORT_ARCHIVE_MANIFEST_FILE]!).toString('utf8')).toContain('raw-1');
        expect(Buffer.from(unzipped['spiracha-manifest-2.json']!).toString('utf8')).toBe('raw-bytes');
    });

    it('should reject a partial batch with zero successful conversations', async () => {
        await expect(
            assembleExportBatch({
                failurePolicy: 'partial',
                kind: 'batch_normalized_export',
                load: async () => null,
                options: {},
                requestedIds: ['gone'],
                source: 'grok',
            }),
        ).rejects.toBeInstanceOf(EmptyPartialExportError);
    });
});

describe('writeExportArchive', () => {
    it('should write member bytes and a generated manifest, then drop temporary files', async () => {
        const result = await writeExportArchive({
            baseName: 'threads-2',
            destination: { mode: 'blob' },
            manifest: {
                entries: [
                    {
                        error: null,
                        memberNames: ['one.md'],
                        omissionSummary: null,
                        requestedId: 'one',
                        status: 'exported',
                    },
                ],
                failedCount: 0,
                failurePolicy: 'atomic',
                kind: 'batch_normalized_export',
                missingCount: 0,
                options: {},
                requestedCount: 1,
                schemaVersion: 1,
                source: 'grok',
                successCount: 1,
            },
            members: [{ bytes: '# One\n', relativePath: 'one.md' }],
            platform: 'grok',
        });
        if (!('blob' in result)) {
            throw new Error('expected an in-memory archive');
        }
        const archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));

        expect(result.fileName).toBe('grok_threads-2.zip');
        expect(Object.keys(archive).sort()).toEqual(['one.md', EXPORT_ARCHIVE_MANIFEST_FILE].sort());
        expect(Buffer.from(archive['one.md']!).toString()).toBe('# One\n');
        expect(JSON.parse(Buffer.from(archive[EXPORT_ARCHIVE_MANIFEST_FILE]!).toString()).source).toBe('grok');
    });

    it('should honor cancellation before publishing a download URL', async () => {
        const exportDir = await mkdtemp(path.join(os.tmpdir(), 'spiracha-export-archive-abort-'));
        tempPaths.push(exportDir);
        const signal = AbortSignal.abort();

        await expect(
            writeExportArchive({
                baseName: 'cancelled',
                destination: { exportDir, mode: 'download_url' },
                members: [{ bytes: '# One', relativePath: 'one.md' }],
                platform: 'cline',
                signal,
            }),
        ).rejects.toThrow(/aborted/i);
        expect((await readdir(exportDir)).filter((name) => name.endsWith('.zip'))).toEqual([]);
    });

    it('should encrypt every archive member, including the manifest, without leaking the password', async () => {
        const password = 'archive password';
        const result = await writeExportArchive({
            baseName: 'protected',
            destination: { mode: 'blob' },
            manifest: {
                entries: [],
                failedCount: 0,
                failurePolicy: 'atomic',
                kind: 'batch_normalized_export',
                missingCount: 0,
                options: { outputFormat: 'md', zipPassword: password },
                requestedCount: 0,
                schemaVersion: 1,
                source: 'grok',
                successCount: 0,
            },
            members: [{ bytes: '# Secret\n', relativePath: 'secret.md' }],
            platform: 'grok',
            zipPassword: password,
        });
        if (!('blob' in result)) {
            throw new Error('expected an in-memory archive');
        }

        const reader = new ZipReader(new BlobReader(result.blob));
        const entries = await reader.getEntries();
        expect(entries).toHaveLength(2);
        expect(entries.every((entry) => entry.encrypted)).toBe(true);
        const manifestEntry = entries.find((entry) => entry.filename === EXPORT_ARCHIVE_MANIFEST_FILE);
        if (!manifestEntry || manifestEntry.directory) {
            throw new Error('expected an encrypted manifest file entry');
        }
        const manifest = JSON.parse(
            new TextDecoder().decode(new Uint8Array(await manifestEntry.arrayBuffer({ password }))),
        ) as { options: Record<string, unknown> };
        expect(manifest.options).toEqual({ outputFormat: 'md' });
        expect(JSON.stringify(manifest)).not.toContain(password);
        await reader.close();
    });
});

describe('reserveExportBytes', () => {
    it('should admit one in-flight reservation and reject a second that would exceed the quota', async () => {
        const exportDir = await mkdtemp(path.join(os.tmpdir(), 'spiracha-export-quota-'));
        tempPaths.push(exportDir);
        process.env[UI_EXPORT_DIR_ENV] = exportDir;
        process.env.SPIRACHA_UI_EXPORT_MAX_BYTES = '80';

        const first = await reserveExportBytes(50);
        await expect(reserveExportBytes(50)).rejects.toThrow('Export quota exceeded');
        first.release();
        const second = await reserveExportBytes(50);
        second.release();
    });
});
