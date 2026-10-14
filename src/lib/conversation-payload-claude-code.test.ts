import { describe, expect, it } from 'bun:test';
import { convertConversationPayload } from './conversation-payload';
import { parseClaudeCodePayload } from './conversation-payload-claude-code';

const SESSION = '8a8f8b8f-e7ae-532d-9952-be4440aa7ea0';

const sessionEvents = (sessionId = SESSION) => [
    {
        cwd: '/home/user/kalu',
        gitBranch: 'next',
        message: { content: 'Review the search fix', role: 'user' },
        parentUuid: null,
        sessionId,
        timestamp: '2026-10-14T16:00:00.000Z',
        type: 'user',
        uuid: `${sessionId}-u1`,
        version: '2.1.299',
    },
    {
        cwd: '/home/user/kalu',
        message: {
            content: [
                { text: 'Checking the code.', type: 'text' },
                { id: 'toolu_1', input: { command: 'git status' }, name: 'Bash', type: 'tool_use' },
            ],
            id: 'msg_1',
            model: 'claude-opus-5-5',
            role: 'assistant',
        },
        parentUuid: `${sessionId}-u1`,
        sessionId,
        timestamp: '2026-10-14T16:00:05.000Z',
        type: 'assistant',
        uuid: `${sessionId}-a1`,
    },
    {
        cwd: '/home/user/kalu',
        message: { content: [{ content: 'clean', tool_use_id: 'toolu_1', type: 'tool_result' }], role: 'user' },
        parentUuid: `${sessionId}-a1`,
        sessionId,
        timestamp: '2026-10-14T16:00:06.000Z',
        type: 'user',
        uuid: `${sessionId}-u2`,
    },
    {
        cwd: '/home/user/kalu',
        message: {
            content: [{ text: 'The search fix looks correct.', type: 'text' }],
            id: 'msg_2',
            model: 'claude-opus-5-5',
            role: 'assistant',
        },
        parentUuid: `${sessionId}-u2`,
        sessionId,
        timestamp: '2026-10-14T16:01:00.000Z',
        type: 'assistant',
        uuid: `${sessionId}-a2`,
    },
    { aiTitle: 'Search fix review', sessionId, title: 'Search fix review', type: 'ai-title' },
];

const jsonl = (events: unknown[]) => `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;

describe('parseClaudeCodePayload', () => {
    it('should convert a raw Claude Code session transcript', () => {
        const [draft] = parseClaudeCodePayload(sessionEvents())!;

        expect(draft).toMatchObject({
            createdAtMs: Date.parse('2026-10-14T16:00:00.000Z'),
            id: SESSION,
            model: 'claude-opus-5-5',
            source: 'claude-code',
            title: 'Search fix review',
            updatedAtMs: Date.parse('2026-10-14T16:01:00.000Z'),
            workspacePath: '/home/user/kalu',
        });
        expect(draft?.metadata).toMatchObject({ gitBranch: 'next', version: '2.1.299' });
        const texts = draft?.messages.filter((message) => message.text).map(({ role, text }) => ({ role, text }));
        expect(texts).toContainEqual({ role: 'user', text: 'Review the search fix' });
        expect(texts).toContainEqual({ role: 'assistant', text: 'The search fix looks correct.' });
        expect(draft?.messages.some((message) => message.toolEvidence?.name === 'Bash')).toBe(true);
    });

    it('should not claim a payload without Claude Code session events', () => {
        expect(parseClaudeCodePayload([{ content: 'hi', role: 'user' }])).toBeNull();
    });

    it('should return one conversation per session in the payload', () => {
        const drafts = parseClaudeCodePayload([...sessionEvents(), ...sessionEvents('second-session')])!;
        expect(drafts.map((draft) => draft.id)).toEqual([SESSION, 'second-session']);
    });
});

describe('convertConversationPayload with Claude Code JSONL', () => {
    it('should convert JSONL text with an explicit source and keep the session id', async () => {
        const [conversation] = await convertConversationPayload({
            payload: jsonl(sessionEvents()),
            source: 'claude-code',
        });
        expect(conversation).toMatchObject({ id: SESSION, source: 'claude-code', title: 'Search fix review' });
        expect(conversation?.markdown).toContain('The search fix looks correct.');
    });

    it('should infer Claude Code JSONL without a source hint', async () => {
        const [conversation] = await convertConversationPayload({ payload: jsonl(sessionEvents()) });
        expect(conversation?.source).toBe('claude-code');
    });
});
