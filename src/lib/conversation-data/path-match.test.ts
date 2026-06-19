import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { getConversationPathMatch } from './path-match';

describe('conversation path matching', () => {
    it('should match exact workspace paths', async () => {
        await expect(
            getConversationPathMatch('/Users/example/workspace/fgh', '/Users/example/workspace/fgh'),
        ).resolves.toMatchObject({
            candidatePath: '/Users/example/workspace/fgh',
            kind: 'exact',
            requestedPath: '/Users/example/workspace/fgh',
        });
    });

    it('should match conversations nested under the requested project root', async () => {
        await expect(
            getConversationPathMatch('/Users/example/workspace/fgh', '/Users/example/workspace/fgh/packages/ui'),
        ).resolves.toMatchObject({
            candidatePath: '/Users/example/workspace/fgh/packages/ui',
            kind: 'descendant',
        });
    });

    it('should not match unrelated projects with the same basename', async () => {
        await expect(
            getConversationPathMatch('/Users/example/workspace/fgh', '/Users/other/workspace/fgh'),
        ).resolves.toBeNull();
    });

    it('should normalize trailing separators and home-prefixed paths', async () => {
        const requested = path.join('~', 'workspace', 'fgh');
        const candidate = path.join(process.env.HOME ?? '/Users/example', 'workspace', 'fgh', 'reviews');

        await expect(getConversationPathMatch(requested, candidate)).resolves.toMatchObject({
            kind: 'descendant',
        });
    });
});
