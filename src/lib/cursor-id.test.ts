import { describe, expect, it } from 'bun:test';
import { getCursorBubbleKeyRange, getCursorComposerDataKeyRange } from './cursor-id';

describe('Cursor bubble key ranges', () => {
    it('should bound composerData keys before the semicolon terminator', () => {
        expect(getCursorComposerDataKeyRange()).toEqual({
            end: 'composerData;',
            start: 'composerData:',
        });
    });

    it('should bound a composer prefix before the semicolon terminator', () => {
        expect(getCursorBubbleKeyRange('thread')).toEqual({
            end: 'bubbleId:thread;',
            start: 'bubbleId:thread:',
        });
    });
});
