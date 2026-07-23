import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readMiniMaxCodeSessionTranscript } from './minimax-code-db';
import { writeMiniMaxCodeSessionFixture } from './minimax-code-test-helpers';
import { renderMiniMaxCodeTranscript } from './minimax-code-transcript';

const tempRoots: string[] = [];

describe('MiniMax Code transcript renderer', () => {
    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    it('should render user, reasoning, commentary, tool, and final-answer sections', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'minimax-code-transcript-test-'));
        tempRoots.push(tempRoot);
        const sessionsDir = path.join(tempRoot, 'v2', 'sessions');
        const fixture = await writeMiniMaxCodeSessionFixture({
            sessionsDir,
            workspacePath: path.join(tempRoot, 'project'),
        });
        const transcript = await readMiniMaxCodeSessionTranscript(sessionsDir, fixture.sessionId);
        if (!transcript) {
            throw new Error('Expected MiniMax Code fixture transcript');
        }

        const markdown = renderMiniMaxCodeTranscript(transcript, {
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
        });

        expect(markdown).toContain('# Refactor evidence extraction module');
        expect(markdown).toContain('## User');
        expect(markdown).toContain('## Reasoning');
        expect(markdown).toContain("complete picture. Let me also look at what's");
        expect(markdown).toContain('## Tool Call');
        expect(markdown).toContain('grep -rn \\"evidence-extraction\\"');
        expect(markdown).toContain('## Tool Output');
        expect(markdown).toContain('## Assistant');
        expect(markdown).toContain('The detailed decomposition plan is ready.');
    });

    it('should omit commentary and tools while retaining user messages and the final answer', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'minimax-code-transcript-test-'));
        tempRoots.push(tempRoot);
        const sessionsDir = path.join(tempRoot, 'v2', 'sessions');
        const fixture = await writeMiniMaxCodeSessionFixture({
            sessionsDir,
            workspacePath: path.join(tempRoot, 'project'),
        });
        const transcript = await readMiniMaxCodeSessionTranscript(sessionsDir, fixture.sessionId);
        if (!transcript) {
            throw new Error('Expected MiniMax Code fixture transcript');
        }

        const text = renderMiniMaxCodeTranscript(transcript, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'txt',
        });

        expect(text).toContain('Come up with a plan to decompose and refactor');
        expect(text).toContain('The detailed decomposition plan is ready.');
        expect(text).not.toContain('complete picture');
        expect(text).not.toContain('Tool Call');
        expect(text).not.toContain("I'll investigate this thoroughly");
    });
});
