import { describe, expect, it } from 'bun:test';
import { createConcurrencyLimiter, mapWithConcurrency } from './concurrency';

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

describe('createConcurrencyLimiter', () => {
    it('should bound independent async jobs through one shared queue', async () => {
        const limit = createConcurrencyLimiter(2);
        let active = 0;
        let maxActive = 0;

        const results = await Promise.all(
            [1, 2, 3, 4, 5].map((value) =>
                limit(async () => {
                    active += 1;
                    maxActive = Math.max(maxActive, active);
                    await Bun.sleep(1);
                    active -= 1;
                    return value * 3;
                }),
            ),
        );

        expect(results).toEqual([3, 6, 9, 12, 15]);
        expect(maxActive).toBeLessThanOrEqual(2);
    });
});
