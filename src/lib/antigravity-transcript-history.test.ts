import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readAntigravityTranscriptHistory } from './antigravity-transcript-history';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
    );
});

const makeRepository = async (): Promise<string> => {
    const repository = await mkdtemp(path.join(tmpdir(), 'antigravity-history-'));
    temporaryDirectories.push(repository);
    const process = Bun.spawn(['git', '-C', repository, 'init', '--quiet'], {
        stderr: 'pipe',
        stdout: 'pipe',
    });
    const [exitCode, stderr] = await Promise.all([process.exited, new Response(process.stderr).text()]);
    if (exitCode !== 0) {
        throw new Error(`git init failed: ${stderr.trim()}`);
    }
    return repository;
};

describe('Antigravity transcript history', () => {
    it('should skip history recovery when the current transcript already starts at its first step', async () => {
        expect(await readAntigravityTranscriptHistory('/missing/transcript.jsonl', null)).toEqual([]);
        expect(await readAntigravityTranscriptHistory('/missing/transcript.jsonl', 0)).toEqual([]);
    });

    it('should tolerate missing and malformed optional Git snapshots', async () => {
        const repository = await makeRepository();
        const logsDirectory = path.join(repository, '.system_generated', 'logs');
        const transcriptPath = path.join(logsDirectory, 'transcript_full.jsonl');
        await mkdir(logsDirectory, { recursive: true });
        await Bun.write(transcriptPath, '{malformed historical write');

        const add = Bun.spawn(['git', '-C', repository, 'add', '.system_generated/logs/transcript_full.jsonl']);
        expect(await add.exited).toBe(0);
        const commit = Bun.spawn([
            'git',
            '-C',
            repository,
            '-c',
            'user.email=antigravity@example.test',
            '-c',
            'user.name=Antigravity',
            'commit',
            '--quiet',
            '-m',
            'Malformed snapshot',
        ]);
        expect(await commit.exited).toBe(0);

        await Bun.write(transcriptPath, JSON.stringify({ step_index: 4 }));
        expect(await readAntigravityTranscriptHistory(transcriptPath, 4)).toEqual([]);

        const untrackedPath = path.join(logsDirectory, 'untracked.jsonl');
        await Bun.write(untrackedPath, JSON.stringify({ step_index: 4 }));
        expect(await readAntigravityTranscriptHistory(untrackedPath, 4)).toEqual([]);
    });
});
