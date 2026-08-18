import { describe, expect, it } from 'bun:test';
import { getCursorBubbleKeyRange } from './cursor-id';

describe('Cursor bubble key ranges', () => {
    it('should bound a composer prefix before the semicolon terminator', () => {
        expect(getCursorBubbleKeyRange('thread')).toEqual({
            end: 'bubbleId:thread;',
            start: 'bubbleId:thread:',
        });
    });
});
