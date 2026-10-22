import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderCodexThreadDownload } from './codex-browser-export';
import { createCodexBrowserFixture } from './codex-test-helpers';
import { CodexTranscriptHistoryError } from './codex-thread-parser';
import * as transcriptRenderer from './codex-transcript-renderer';

let mutateParent: (() => Promise<void>) | null = null;
const renderSession = transcriptRenderer.renderCodexSessionFileWithNotes;
const tempPaths: string[] = [];

const prepareForkedFixture = async (tempRoot: string) => {
    const fixture = await createCodexBrowserFixture(tempRoot);
    const parent = fixture.threads[0]!;
    const child = fixture.threads[1]!;
    const parentRecords = (await Bun.file(parent.sessionFile).text())
        .trim()
        .split('\n')
        .map((line, ordinal) => ({ ...JSON.parse(line), ordinal }));
    const childRecords = (await Bun.file(child.sessionFile).text())
        .trim()
        .split('\n')
        .map((line, ordinal) => ({ ...JSON.parse(line), ordinal: parentRecords.length + ordinal }));
    childRecords[0] = {
        ...childRecords[0]!,
        payload: {
            ...childRecords[0]!.payload,
            forked_from_id: parent.threadId,
            forked_from_ordinal_exclusive: parentRecords.length,
        },
    };
    await Promise.all([
        Bun.write(parent.sessionFile, parentRecords.map((record) => JSON.stringify(record)).join('\n')),
        Bun.write(child.sessionFile, childRecords.map((record) => JSON.stringify(record)).join('\n')),
    ]);
    return { boundary: parentRecords.length, child, fixture, parent, parentRecords };
};

const exportForkedThread = (dbPath: string, threadId: string) =>
    renderCodexThreadDownload({
        dbPath,
        includeCommentary: true,
        includeMetadata: false,
        includeTools: false,
        outputFormat: 'md',
        threadId,
    });

describe('Codex bounded ancestry export fingerprint', () => {
    let renderSpy: Mock<typeof renderSession> | null = null;

    beforeEach(() => {
        renderSpy = spyOn(transcriptRenderer, 'renderCodexSessionFileWithNotes').mockImplementation(
            async (target, options) => {
                const rendered = await renderSession(target, options);
                await mutateParent?.();
                return rendered;
            },
        );
    });

    afterEach(async () => {
        renderSpy?.mockRestore();
        renderSpy = null;
        mutateParent = null;
        await Promise.all(tempPaths.splice(0).map((tempPath) => rm(tempPath, { force: true, recursive: true })));
    });

    it('should ignore parent appends beyond the fork boundary', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-export-bounded-history-append-test-'));
        tempPaths.push(tempRoot);
        const { boundary, child, fixture, parent } = await prepareForkedFixture(tempRoot);
        mutateParent = async () => {
            const current = await Bun.file(parent.sessionFile).text();
            await Bun.write(
                parent.sessionFile,
                `${current}\n${JSON.stringify({ ordinal: boundary, type: 'event_msg' })}\n`,
            );
        };

        const download = await exportForkedThread(fixture.dbPath, child.threadId);

        expect(download.mode).toBe('download');
        if (download.mode !== 'download') {
            throw new Error('expected an inline download');
        }
        expect(download.content).toContain('Stabilized the transcript parsing and export formatting.');
    });

    it('should still reject changes to parent content before the fork boundary', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-export-bounded-history-change-test-'));
        tempPaths.push(tempRoot);
        const { child, fixture, parent, parentRecords } = await prepareForkedFixture(tempRoot);
        mutateParent = async () => {
            const firstRecord = parentRecords[0]!;
            firstRecord.payload.cwd = '/changed/workspace';
            await Bun.write(parent.sessionFile, parentRecords.map((record) => JSON.stringify(record)).join('\n'));
        };

        await expect(exportForkedThread(fixture.dbPath, child.threadId)).rejects.toBeInstanceOf(
            CodexTranscriptHistoryError,
        );
    });
});
