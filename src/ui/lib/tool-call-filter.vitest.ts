import { describe, expect, it } from 'vitest';
import { filterToToolCallHits } from './tool-call-filter';

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('filterToToolCallHits', () => {
    it('should keep every item while no tool call search is active', () => {
        expect(filterToToolCallHits(items, (item) => item.id, null)).toBe(items);
    });

    it('should keep only items whose id has a hit, preserving order', () => {
        const hits = new Map([
            ['c', {}],
            ['a', {}],
        ]);

        expect(filterToToolCallHits(items, (item) => item.id, hits)).toEqual([{ id: 'a' }, { id: 'c' }]);
    });
});
