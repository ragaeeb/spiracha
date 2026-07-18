import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { renderCodexThreadDownload, renderCodexThreadsDownload } from './codex-browser-export';
import { createCodexBrowserFixture, createCodexFixture } from './codex-test-helpers';
import { UI_EXPORT_DIR_ENV } from './ui-export-files';

const tempPaths: string[] = [];
const originalExportDir = process.env[UI_EXPORT_DIR_ENV];

afterEach(async () => {
    if (originalExportDir === undefined) {
        delete process.env[UI_EXPORT_DIR_ENV];
    } else {
        process.env[UI_EXPORT_DIR_ENV] = originalExportDir;
    }

    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

const listZipEntries = async (zipPath: string) => {
    return Object.keys(unzipSync(new Uint8Array(await Bun.file(zipPath).arrayBuffer()))).sort();
};

const readZipEntry = async (zipPath: string, entryName: string) => {
    const entries = unzipSync(new Uint8Array(await Bun.file(zipPath).arrayBuffer()));
    const entry = entries[entryName];
    if (!entry) {
        throw new Error(`ZIP entry not found: ${entryName}`);
    }
    return strFromU8(entry);
};

const appendModernToolRecords = async (sessionFile: string) => {
    const records = [
        {
            payload: {
                call_id: 'custom-call-1',
                input: 'const result = await tools.exec_command({ cmd: "rtk bun test" });',
                name: 'exec',
                type: 'custom_tool_call',
            },
            type: 'response_item',
        },
        {
            payload: {
                call_id: 'custom-call-1',
                output: [{ text: 'Modern tool output', type: 'input_text' }],
                type: 'custom_tool_call_output',
            },
            type: 'response_item',
        },
    ];
    const current = await Bun.file(sessionFile).text();
    await Bun.write(
        sessionFile,
        `${current.trimEnd()}\n${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    );
};

const appendLargeAssistantRecord = async (sessionFile: string) => {
    const current = await Bun.file(sessionFile).text();
    await Bun.write(
        sessionFile,
        `${current.trimEnd()}\n${JSON.stringify({
            payload: {
                content: [{ text: `Large export payload\n${'tool output\n'.repeat(20_000)}`, type: 'output_text' }],
                phase: 'final_answer',
                role: 'assistant',
                type: 'message',
            },
            timestamp: '2026-07-17T19:46:00.000Z',
            type: 'response_item',
        })}\n`,
    );
};

describe('renderCodexThreadDownload', () => {
    it('should render a thread export to downloadable markdown content', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-export-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexFixture(tempRoot);
        await appendModernToolRecords(fixture.sessionFile);

        const download = await renderCodexThreadDownload({
            dbPath: fixture.dbPath,
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
            threadId: fixture.threadId,
        });

        expect(download.fileName).toBe('summer-2026-04-23-1241-019da28f.md');
        expect(download.mimeType).toBe('text/markdown; charset=utf-8');
        expect(download.mode).toBe('download');
        if (download.mode !== 'download') {
            throw new Error('expected inline download mode');
        }
        expect(download.content).toContain('tokens_used: 42');
        expect(download.content).toContain('## GPT 5.4');
        expect(download.content).toContain('## Tool');
        expect(download.content).toContain('Tool: `exec`');
        expect(download.content).toContain('Modern tool output');
    });

    it('should apply project-root conversion and username redaction to exported content', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-export-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const download = await renderCodexThreadDownload({
            dbPath: fixture.dbPath,
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
            pathDisplaySettings: {
                convertToProjectRoot: true,
                redactUsername: true,
            },
            threadId: fixture.threads[0]!.threadId,
        });

        expect(download.mode).toBe('download');
        if (download.mode !== 'download') {
            throw new Error('expected inline download mode');
        }
        expect(download.content).toContain('src/index.ts');
        expect(download.content).not.toContain('/Users/example/workspace/spiracha/src/index.ts');
        expect(download.content).toContain('~/workspace/other-project/docs/notes.md');
    });

    it('should omit commentary-phase assistant messages when export commentary is disabled', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-export-commentary-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const download = await renderCodexThreadDownload({
            dbPath: fixture.dbPath,
            includeCommentary: false,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
            threadId: fixture.threads[0]!.threadId,
        });

        expect(download.mode).toBe('download');
        if (download.mode !== 'download') {
            throw new Error('expected inline download mode');
        }
        expect(download.content).not.toContain('Checking repo structure before planning.');
        expect(download.content).toContain('## GPT 5.4');
        expect(download.content).not.toContain('## Assistant');
    });

    it('should zip oversized exports and return a downloadable url instead of inline transcript content', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-export-large-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const download = await renderCodexThreadDownload({
            dbPath: fixture.dbPath,
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            largeExportThresholdBytes: 1,
            outputFormat: 'md',
            publicExportDir: tempRoot,
            threadId: fixture.threads[0]!.threadId,
        });

        expect(download.mode).toBe('download_url');
        if (download.mode !== 'download_url') {
            throw new Error('expected zipped download url mode');
        }
        expect(download.downloadUrl.endsWith('.zip')).toBe(true);
        expect(download.fileName.endsWith('.zip')).toBe(true);
        expect(download.fileName.startsWith('spiracha-2026-05-17-1712-019e36d7')).toBe(true);
        expect(await Bun.file(path.join(tempRoot, path.basename(download.downloadUrl))).exists()).toBe(true);
    });

    it('should zip a single thread export when requested', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-export-zip-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        await appendModernToolRecords(fixture.threads[0]!.sessionFile);
        await appendLargeAssistantRecord(fixture.threads[0]!.sessionFile);

        const download = await renderCodexThreadDownload({
            dbPath: fixture.dbPath,
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
            publicExportDir: tempRoot,
            threadId: fixture.threads[0]!.threadId,
            zipArchive: true,
        });

        expect(download.mode).toBe('download_url');
        if (download.mode !== 'download_url') {
            throw new Error('expected zipped download url mode');
        }
        expect(download.fileName.endsWith('.zip')).toBe(true);

        const zipPath = path.join(tempRoot, path.basename(download.downloadUrl));
        const entries = await listZipEntries(zipPath);

        expect(entries).toEqual(['spiracha-2026-05-17-1712-019e36d7.md']);
        const content = await readZipEntry(zipPath, entries[0]!);
        expect(content).toContain('Tool: `exec`');
        expect(content).toContain('Modern tool output');
        expect(content).toContain('Large export payload');
    });

    it('should report a missing rollout file instead of surfacing a raw stat error', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-export-missing-rollout-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const thread = fixture.threads[0]!;
        await rm(thread.sessionFile, { force: true });

        await expect(
            renderCodexThreadDownload({
                dbPath: fixture.dbPath,
                includeCommentary: true,
                includeMetadata: true,
                includeTools: true,
                outputFormat: 'md',
                threadId: thread.threadId,
            }),
        ).rejects.toThrow(`Thread ${thread.threadId} rollout file is missing`);
    });

    it('should write oversized browser exports into the shared UI export directory when no override is provided', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-export-shared-dir-test-'));
        tempPaths.push(tempRoot);
        process.env[UI_EXPORT_DIR_ENV] = tempRoot;
        const fixture = await createCodexBrowserFixture(tempRoot);

        const download = await renderCodexThreadDownload({
            dbPath: fixture.dbPath,
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            largeExportThresholdBytes: 1,
            outputFormat: 'md',
            threadId: fixture.threads[0]!.threadId,
        });

        expect(download.mode).toBe('download_url');
        if (download.mode !== 'download_url') {
            throw new Error('expected zipped download url mode');
        }
        expect(await Bun.file(path.join(tempRoot, path.basename(download.downloadUrl))).exists()).toBe(true);
    });

    it('should bundle multiple thread exports into a single zip download', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-export-batch-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const download = await renderCodexThreadsDownload({
            dbPath: fixture.dbPath,
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
            publicExportDir: tempRoot,
            threadIds: fixture.threads.slice(0, 2).map((thread) => thread.threadId),
        });

        expect(download.mode).toBe('download_url');
        if (download.mode !== 'download_url') {
            throw new Error('expected zipped batch download url mode');
        }
        expect(download.fileName.endsWith('.zip')).toBe(true);
        expect(download.fileName.includes('threads-2')).toBe(true);
        expect(await Bun.file(path.join(tempRoot, path.basename(download.downloadUrl))).exists()).toBe(true);
    });

    it('should keep every selected thread when batch export filenames would otherwise collide', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-export-batch-collision-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const originalThreadId = fixture.threads[0]!.threadId;
        const collidingThreadId = `${originalThreadId.slice(0, 8)}-ffff-7fff-8fff-ffffffffffff`;
        const db = new Database(fixture.dbPath);

        try {
            db.prepare(`
                INSERT INTO threads (
                    id,
                    rollout_path,
                    created_at,
                    updated_at,
                    source,
                    model_provider,
                    cwd,
                    title,
                    sandbox_policy,
                    approval_mode,
                    tokens_used,
                    has_user_event,
                    archived,
                    archived_at,
                    git_sha,
                    git_branch,
                    git_origin_url,
                    cli_version,
                    first_user_message,
                    agent_nickname,
                    agent_role,
                    memory_mode,
                    model,
                    reasoning_effort,
                    agent_path,
                    created_at_ms,
                    updated_at_ms,
                    thread_source,
                    preview
                )
                SELECT
                    ?,
                    rollout_path,
                    created_at,
                    updated_at,
                    source,
                    model_provider,
                    cwd,
                    title,
                    sandbox_policy,
                    approval_mode,
                    tokens_used,
                    has_user_event,
                    archived,
                    archived_at,
                    git_sha,
                    git_branch,
                    git_origin_url,
                    cli_version,
                    first_user_message,
                    agent_nickname,
                    agent_role,
                    memory_mode,
                    model,
                    reasoning_effort,
                    agent_path,
                    created_at_ms,
                    updated_at_ms,
                    thread_source,
                    preview
                FROM threads
                WHERE id = ?
            `).run(collidingThreadId, originalThreadId);
        } finally {
            db.close();
        }

        const download = await renderCodexThreadsDownload({
            dbPath: fixture.dbPath,
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
            publicExportDir: tempRoot,
            threadIds: [originalThreadId, collidingThreadId],
        });

        expect(download.mode).toBe('download_url');
        if (download.mode !== 'download_url') {
            throw new Error('expected zipped batch download url mode');
        }

        const zipPath = path.join(tempRoot, path.basename(download.downloadUrl));
        const entries = await listZipEntries(zipPath);

        expect(entries).toHaveLength(2);
        expect(new Set(entries).size).toBe(2);
    });

    it('should return a unique zip url for repeated multi-thread exports of the same selection', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-export-batch-repeat-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const threadIds = fixture.threads.slice(0, 2).map((thread) => thread.threadId);

        const firstDownload = await renderCodexThreadsDownload({
            dbPath: fixture.dbPath,
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
            publicExportDir: tempRoot,
            threadIds,
        });
        const secondDownload = await renderCodexThreadsDownload({
            dbPath: fixture.dbPath,
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
            publicExportDir: tempRoot,
            threadIds,
        });

        expect(firstDownload.mode).toBe('download_url');
        expect(secondDownload.mode).toBe('download_url');
        if (firstDownload.mode !== 'download_url' || secondDownload.mode !== 'download_url') {
            throw new Error('expected zipped batch download url mode');
        }
        expect(firstDownload.fileName).toBe(secondDownload.fileName);
        expect(firstDownload.downloadUrl).not.toBe(secondDownload.downloadUrl);
        expect(await Bun.file(path.join(tempRoot, path.basename(firstDownload.downloadUrl))).exists()).toBe(true);
        expect(await Bun.file(path.join(tempRoot, path.basename(secondDownload.downloadUrl))).exists()).toBe(true);
    });
});
