import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    deleteClineTask,
    getDefaultClineDataDir,
    listClineTasksForGroup,
    listClineWorkspaceGroups,
    readClineTaskTranscript,
    resolveClineDataDir,
} from './cline-db';
import { CLINE_SESSION_ID, writeClineSessionFixture } from './cline-test-helpers';
import { renderClineTranscript } from './cline-transcript';

const tempRoots: string[] = [];

const makeTempRoot = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cline-db-test-'));
    tempRoots.push(root);
    return root;
};

describe('Cline session storage', () => {
    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    it('should resolve the current Cline data directory by default', () => {
        expect(getDefaultClineDataDir('/Users/tester')).toBe('/Users/tester/.cline/data');
        expect(resolveClineDataDir({}, '/Users/tester')).toBe('/Users/tester/.cline/data');
        expect(resolveClineDataDir({ SPIRACHA_CLINE_DATA_DIR: '/tmp/cline-data' }, '/Users/tester')).toBe(
            '/tmp/cline-data',
        );
    });

    it('should discover current Cline sessions across multiple workspaces', async () => {
        const root = await makeTempRoot();
        const dataDir = path.join(root, 'cline-data');
        const kaluWorkspacePath = path.join(root, 'kalu');
        const researchWorkspacePath = path.join(root, 'research');
        await writeClineSessionFixture({
            dataDir,
            sessionId: '1786126367448',
            title: 'TRADE-DR-001',
            workspacePath: kaluWorkspacePath,
        });
        await writeClineSessionFixture({
            dataDir,
            sessionId: '1786145275579_tx573',
            title: 'TRADE-DR-012',
            workspacePath: researchWorkspacePath,
        });
        await writeClineSessionFixture({
            dataDir,
            sessionId: '1786163719044_tpg1r',
            title: 'TRADE-DR-018',
            workspacePath: researchWorkspacePath,
        });

        const groups = await listClineWorkspaceGroups(dataDir);
        expect(groups).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ taskCount: 1, worktree: kaluWorkspacePath }),
                expect.objectContaining({ taskCount: 2, worktree: researchWorkspacePath }),
            ]),
        );

        const researchGroup = groups.find((group) => group.worktree === researchWorkspacePath);
        expect(researchGroup).toBeDefined();
        const tasks = await listClineTasksForGroup(researchGroup!.key, dataDir);
        expect(tasks.map((task) => task.title).sort()).toEqual(['TRADE-DR-012', 'TRADE-DR-018']);
        expect(tasks.find((task) => task.taskId === '1786163719044_tpg1r')).toMatchObject({
            messagesPath: path.join(dataDir, 'sessions', '1786163719044_tpg1r', '1786163719044_tpg1r.messages.json'),
            sessionDir: path.join(dataDir, 'sessions', '1786163719044_tpg1r'),
            taskId: '1786163719044_tpg1r',
            worktree: researchWorkspacePath,
        });
    });

    it('should parse current session messages into normalized transcript phases', async () => {
        const root = await makeTempRoot();
        const dataDir = path.join(root, 'cline-data');
        const workspacePath = path.join(root, 'repo');
        await writeClineSessionFixture({ dataDir, workspacePath });

        const transcript = await readClineTaskTranscript(dataDir, CLINE_SESSION_ID);
        expect(transcript?.messages.map(({ phase, role, text }) => ({ phase, role, text }))).toEqual([
            { phase: 'unknown', role: 'user', text: 'Fix issue 1494 per the implementation plan' },
            {
                phase: 'reasoning',
                role: 'assistant',
                text: 'I need to inspect the protected surface policy first.',
            },
            { phase: 'commentary', role: 'assistant', text: 'I will inspect the relevant files.' },
            {
                phase: 'tool_call',
                role: 'assistant',
                text: 'run_commands: {"commands":["bun test src/vendor-proof-lifecycle.test.ts"]}',
            },
            { phase: 'tool_output', role: 'tool', text: '57 pass\n0 fail' },
            {
                phase: 'final_answer',
                role: 'assistant',
                text: 'Implemented Fix issue 1494 per the implementation plan.',
            },
        ]);
        expect(transcript?.messages.find((message) => message.phase === 'tool_call')?.tool).toMatchObject({
            callId: `${CLINE_SESSION_ID}-tool-1`,
            inputText: '{"commands":["bun test src/vendor-proof-lifecycle.test.ts"]}',
            name: 'run_commands',
            status: 'unknown',
            workdir: workspacePath,
        });
    });

    it('should retain a safe session with missing workspace metadata using an explicit storage fallback', async () => {
        const root = await makeTempRoot();
        const dataDir = path.join(root, 'cline-data');
        const sessionId = '1785560414951_missing_workspace';
        const sessionDir = path.join(dataDir, 'sessions', sessionId);
        await mkdir(sessionDir, { recursive: true });
        await Bun.write(
            path.join(sessionDir, `${sessionId}.json`),
            JSON.stringify({ prompt: 'No workspace metadata', session_id: sessionId }),
        );
        await Bun.write(path.join(sessionDir, `${sessionId}.messages.json`), JSON.stringify({ messages: [] }));

        const transcript = await readClineTaskTranscript(dataDir, sessionId);

        expect(transcript).toMatchObject({
            messages: [],
            task: {
                taskId: sessionId,
                workspaceSource: 'session_directory',
                worktree: sessionDir,
            },
        });
    });

    it('should read a validated task entry directly and preserve empty transcripts', async () => {
        const root = await makeTempRoot();
        const dataDir = path.join(root, 'cline-data');
        const sessionId = '1785560414951_direct';
        const sessionDir = path.join(dataDir, 'sessions', sessionId);
        await mkdir(sessionDir, { recursive: true });
        await Bun.write(
            path.join(sessionDir, `${sessionId}.json`),
            JSON.stringify({ cwd: root, session_id: sessionId }),
        );
        await Bun.write(path.join(sessionDir, `${sessionId}.messages.json`), JSON.stringify({ messages: [] }));

        const transcript = await readClineTaskTranscript(dataDir, sessionId);

        expect(transcript?.messages).toEqual([]);
        expect(transcript?.renderablePartCount).toBe(0);
    });

    it('should delete the current Cline session directory', async () => {
        const root = await makeTempRoot();
        const dataDir = path.join(root, 'cline-data');
        const fixture = await writeClineSessionFixture({ dataDir, workspacePath: path.join(root, 'repo') });
        const databasePath = path.join(dataDir, 'db', 'sessions.db');
        await mkdir(path.dirname(databasePath), { recursive: true });
        const database = new Database(databasePath);
        database.run('CREATE TABLE sessions (session_id TEXT PRIMARY KEY)');
        database.prepare('INSERT INTO sessions (session_id) VALUES (?)').run(CLINE_SESSION_ID);
        database.close();

        const result = await deleteClineTask(dataDir, CLINE_SESSION_ID);

        expect(result.deletedTaskIds).toEqual([CLINE_SESSION_ID]);
        expect(result.deletedFiles).toEqual([fixture.sessionDir]);
        expect(result.indexCleanup).toEqual({ status: 'deleted' });
        expect(await Bun.file(fixture.messagesPath).exists()).toBe(false);
        const remainingDatabase = new Database(databasePath, { readonly: true });
        expect(remainingDatabase.query('SELECT session_id FROM sessions').all()).toEqual([]);
        remainingDatabase.close();
        await expect(readClineTaskTranscript(dataDir, CLINE_SESSION_ID)).resolves.toBeNull();
    });

    it('should remove the session directory when index cleanup fails and report the failure', async () => {
        const root = await makeTempRoot();
        const dataDir = path.join(root, 'cline-data');
        const fixture = await writeClineSessionFixture({ dataDir, workspacePath: path.join(root, 'repo') });
        const databasePath = path.join(dataDir, 'db', 'sessions.db');
        await mkdir(path.dirname(databasePath), { recursive: true });
        const database = new Database(databasePath);
        database.close();

        const result = await deleteClineTask(dataDir, fixture.sessionId);

        expect(result.deletedFiles).toEqual([fixture.sessionDir]);
        expect(result.deletedTaskIds).toEqual([fixture.sessionId]);
        expect(result.indexCleanup.status).toBe('failed');
        expect(await Bun.file(fixture.sessionDir).exists()).toBe(false);
    });

    it('should render current-session Markdown and plain-text exports', async () => {
        const root = await makeTempRoot();
        const dataDir = path.join(root, 'cline-data');
        await writeClineSessionFixture({ dataDir, workspacePath: path.join(root, 'repo') });
        const transcript = await readClineTaskTranscript(dataDir, CLINE_SESSION_ID);
        expect(transcript).not.toBeNull();

        const markdown = renderClineTranscript(transcript!, {
            includeCommentary: false,
            includeMetadata: true,
            includeTools: false,
            outputFormat: 'md',
        });
        expect(markdown).toContain('# Fix issue 1494 per the implementation plan');
        expect(markdown).toContain('exported_from: "cline_session_messages"');
        expect(markdown).toContain('## Assistant (Final)');
        expect(markdown).not.toContain('protected surface policy');
        expect(markdown).not.toContain('Tool Call');

        const text = renderClineTranscript(transcript!, {
            includeCommentary: true,
            includeMetadata: false,
            includeTools: true,
            outputFormat: 'txt',
        });
        expect(text).toContain('Fix issue 1494 per the implementation plan\n');
        expect(text).toContain('Tool Call\n---------');
        expect(text).not.toContain('exported_from:');
    });

    it('should ignore the removed VS Code task-history format', async () => {
        const root = await makeTempRoot();
        const dataDir = path.join(root, 'cline-data');
        await mkdir(path.join(dataDir, 'state'), { recursive: true });
        await Bun.write(
            path.join(dataDir, 'state', 'taskHistory.json'),
            JSON.stringify([
                {
                    cwdOnTaskInitialization: path.join(root, 'legacy-repo'),
                    id: '1785560414951',
                    task: 'Legacy task that must not be loaded',
                },
            ]),
        );

        await expect(listClineWorkspaceGroups(dataDir)).resolves.toEqual([]);
    });

    it('should return empty results for malformed session keys and missing data', async () => {
        const root = await makeTempRoot();
        const dataDir = path.join(root, 'missing');
        await expect(listClineWorkspaceGroups(dataDir)).resolves.toEqual([]);
        await expect(listClineTasksForGroup('invalid', dataDir)).resolves.toEqual([]);
        await expect(readClineTaskTranscript(dataDir, '../unsafe')).resolves.toBeNull();
        await expect(deleteClineTask(dataDir, '../unsafe')).resolves.toEqual({
            deletedFiles: [],
            deletedTaskIds: [],
            indexCleanup: { status: 'not_found' },
        });
    });
});
