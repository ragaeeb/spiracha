import { describe, expect, it } from 'bun:test';
import { mapWithConcurrency } from './concurrency';

describe('mapWithConcurrency', () => {
    it('should preserve result order while limiting concurrent work', async () => {
        let active = 0;
        let maxActive = 0;

        const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await Bun.sleep(1);
            active -= 1;
            return value * 2;
        });

        expect(results).toEqual([2, 4, 6, 8, 10]);
        expect(maxActive).toBeLessThanOrEqual(2);
    });

    it('should fall back to one worker for invalid limits', async () => {
        let active = 0;
        let maxActive = 0;

        const results = await mapWithConcurrency([1, 2, 3], Number.NaN, async (value) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await Bun.sleep(1);
            active -= 1;
            return value;
        });

        expect(results).toEqual([1, 2, 3]);
        expect(maxActive).toBe(1);
    });
});
