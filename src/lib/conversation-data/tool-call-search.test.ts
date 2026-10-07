import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { searchConversationToolCalls } from './tool-call-search';

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

type FixtureCall = { id: string; input: Record<string, unknown>; name: string; output?: string };

const writeSession = async (
    projectsDir: string,
    sessionId: string,
    cwd: string,
    options: { calls?: FixtureCall[]; startedAt: string; userText?: string },
) => {
    const projectDir = path.join(projectsDir, 'project');
    await mkdir(projectDir, { recursive: true });
    const base = Date.parse(options.startedAt);
    const stamp = (offsetSeconds: number) => new Date(base + offsetSeconds * 1000).toISOString();
    const records: Record<string, unknown>[] = [
        {
            cwd,
            message: { content: options.userText ?? 'Do the work.', role: 'user' },
            sessionId,
            timestamp: stamp(0),
            type: 'user',
            uuid: `${sessionId}-user`,
        },
    ];
    let parent = `${sessionId}-user`;
    let offset = 1;
    for (const call of options.calls ?? []) {
        const callUuid = `${sessionId}-${call.id}`;
        records.push({
            cwd,
            message: {
                content: [{ id: call.id, input: call.input, name: call.name, type: 'tool_use' }],
                model: 'claude-sonnet-4-5',
                role: 'assistant',
            },
            parentUuid: parent,
            sessionId,
            timestamp: stamp(offset++),
            type: 'assistant',
            uuid: callUuid,
        });
        records.push({
            cwd,
            message: {
                content: [{ content: call.output ?? 'ok', is_error: false, tool_use_id: call.id, type: 'tool_result' }],
                role: 'user',
            },
            parentUuid: callUuid,
            sessionId,
            timestamp: stamp(offset++),
            type: 'user',
            uuid: `${callUuid}-result`,
        });
        parent = `${callUuid}-result`;
    }
    await Bun.write(
        path.join(projectDir, `${sessionId}.jsonl`),
        `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    );
};

const TARGET = 'products/kodeback/src/parity-side-page.redirect-watch.test.ts';

const setup = async () => {
    const projectsDir = await mkdtemp(path.join(os.tmpdir(), 'tool-call-search-'));
    tempDirs.push(projectsDir);
    const cwd = path.join(projectsDir, 'repo');
    return { cwd, locations: { claudeCodeProjectsDir: projectsDir }, projectsDir };
};

describe('searchConversationToolCalls', () => {
    it('should return only threads whose tool calls mention the query, newest first', async () => {
        const { cwd, locations, projectsDir } = await setup();
        await writeSession(projectsDir, 'older-writer', cwd, {
            calls: [{ id: 'w1', input: { content: 'x', file_path: `${cwd}/${TARGET}` }, name: 'Write' }],
            startedAt: '2026-06-01T10:00:00.000Z',
        });
        await writeSession(projectsDir, 'newer-editor', cwd, {
            calls: [
                { id: 'e1', input: { file_path: `${cwd}/${TARGET}`, new_string: 'b', old_string: 'a' }, name: 'Edit' },
            ],
            startedAt: '2026-06-02T10:00:00.000Z',
        });
        await writeSession(projectsDir, 'unrelated', cwd, {
            calls: [{ id: 'r1', input: { file_path: `${cwd}/README.md` }, name: 'Read' }],
            startedAt: '2026-06-03T10:00:00.000Z',
        });
        await writeSession(projectsDir, 'talks-only', cwd, {
            startedAt: '2026-06-04T10:00:00.000Z',
            userText: `Please look at ${TARGET}`,
        });

        const result = await searchConversationToolCalls({
            cwds: [cwd],
            locations,
            query: TARGET,
            source: 'claude-code',
        });

        expect(result.hits.map((hit) => hit.conversationId)).toEqual(['newer-editor', 'older-writer']);
        expect(result.scannedCount).toBe(4);
        expect(result.hits[0]).toMatchObject({
            matchCount: 1,
            matches: [{ field: 'input', toolName: 'Edit' }],
        });
        expect(result.hits[0]?.matches[0]?.snippet).toContain(TARGET);
    });

    it('should match case-insensitively and attribute output matches to the call that produced them', async () => {
        const { cwd, locations, projectsDir } = await setup();
        await writeSession(projectsDir, 'shell-run', cwd, {
            calls: [
                {
                    id: 'b1',
                    input: { command: 'git status --short' },
                    name: 'Bash',
                    output: ` M ${TARGET.toUpperCase()}`,
                },
            ],
            startedAt: '2026-06-01T10:00:00.000Z',
        });

        const result = await searchConversationToolCalls({
            cwds: [cwd],
            locations,
            query: TARGET,
            source: 'claude-code',
        });

        expect(result.hits).toHaveLength(1);
        expect(result.hits[0]?.matches[0]).toMatchObject({ field: 'output', toolName: 'Bash' });
    });

    it('should count every match but keep only a bounded number per thread', async () => {
        const { cwd, locations, projectsDir } = await setup();
        const calls = Array.from({ length: 8 }, (_, index) => ({
            id: `c${index}`,
            input: { file_path: `${cwd}/${TARGET}` },
            name: 'Read',
        }));
        await writeSession(projectsDir, 'chatty', cwd, { calls, startedAt: '2026-06-01T10:00:00.000Z' });

        const result = await searchConversationToolCalls({
            cwds: [cwd],
            locations,
            maxMatchesPerConversation: 3,
            query: TARGET,
            source: 'claude-code',
        });

        expect(result.hits[0]?.matchCount).toBe(8);
        expect(result.hits[0]?.matches).toHaveLength(3);
    });

    it('should reject queries too short to be meaningful', async () => {
        const { cwd, locations } = await setup();

        await expect(
            searchConversationToolCalls({ cwds: [cwd], locations, query: ' a ', source: 'claude-code' }),
        ).rejects.toThrow('at least 2 characters');
    });

    it('should rank threads that wrote the file ahead of newer threads that only observed it', async () => {
        const { cwd, locations, projectsDir } = await setup();
        await writeSession(projectsDir, 'author', cwd, {
            calls: [
                ...Array.from({ length: 6 }, (_, index) => ({
                    id: `s${index}`,
                    input: { command: 'git status --short' },
                    name: 'Bash',
                    output: `?? ${TARGET}`,
                })),
                { id: 'w1', input: { content: 'x', file_path: `${cwd}/${TARGET}` }, name: 'Write' },
            ],
            startedAt: '2026-06-01T10:00:00.000Z',
        });
        await writeSession(projectsDir, 'observer', cwd, {
            calls: [{ id: 'o1', input: { command: 'git status --short' }, name: 'Bash', output: `?? ${TARGET}` }],
            startedAt: '2026-06-05T10:00:00.000Z',
        });

        const result = await searchConversationToolCalls({
            cwds: [cwd],
            locations,
            maxMatchesPerConversation: 3,
            query: TARGET,
            source: 'claude-code',
        });

        expect(result.hits.map((hit) => [hit.conversationId, hit.likelyAuthor])).toEqual([
            ['author', true],
            ['observer', false],
        ]);
        expect(result.hits[0]?.matchCount).toBe(7);
        expect(result.hits[0]?.matches[0]).toMatchObject({ modifiesFile: true, toolName: 'Write' });
        expect(result.hits[0]?.matches).toHaveLength(3);
    });

    it('should treat apply_patch file headers inside a shell command as a file modification', async () => {
        const { cwd, locations, projectsDir } = await setup();
        await writeSession(projectsDir, 'patcher', cwd, {
            calls: [
                {
                    id: 'p1',
                    input: {
                        command: `apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: ${TARGET}\n+hi\n*** End Patch\nEOF`,
                    },
                    name: 'Bash',
                },
            ],
            startedAt: '2026-06-01T10:00:00.000Z',
        });
        await writeSession(projectsDir, 'reader', cwd, {
            calls: [{ id: 'c1', input: { command: `cat ${TARGET}` }, name: 'Bash' }],
            startedAt: '2026-06-02T10:00:00.000Z',
        });

        const result = await searchConversationToolCalls({
            cwds: [cwd],
            locations,
            query: TARGET,
            source: 'claude-code',
        });

        expect(Object.fromEntries(result.hits.map((hit) => [hit.conversationId, hit.likelyAuthor]))).toEqual({
            patcher: true,
            reader: false,
        });
    });

    it('should union threads across several workspace paths without duplicating them', async () => {
        const { cwd, locations, projectsDir } = await setup();
        const otherCwd = path.join(projectsDir, 'other-repo');
        const call = { id: 'w1', input: { file_path: `${cwd}/${TARGET}` }, name: 'Write' };
        await writeSession(projectsDir, 'in-first', cwd, { calls: [call], startedAt: '2026-06-01T10:00:00.000Z' });
        await writeSession(projectsDir, 'in-second', otherCwd, {
            calls: [call],
            startedAt: '2026-06-02T10:00:00.000Z',
        });

        const result = await searchConversationToolCalls({
            cwds: [cwd, otherCwd, cwd],
            locations,
            query: TARGET,
            source: 'claude-code',
        });

        expect(result.hits.map((hit) => hit.conversationId).sort()).toEqual(['in-first', 'in-second']);
        expect(result.scannedCount).toBe(2);
    });
});
