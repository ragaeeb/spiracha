import { describe, expect, it } from 'bun:test';
import { getConversationPathMatch } from './path-match';

describe('drive-root workspace matching', () => {
    it('should include Windows drive descendants without matching other drives', async () => {
        const match = await getConversationPathMatch('C:\\', 'C:\\Users\\alice\\project');
        expect(match?.kind).toBe('descendant');
        expect(await getConversationPathMatch('C:/', 'D:/project')).toBeNull();
        expect((await getConversationPathMatch('C:/', 'C:/'))?.kind).toBe('exact');
    });
});
