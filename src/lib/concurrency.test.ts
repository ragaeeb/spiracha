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

    it('should stop starting queued work after a mapper rejects', async () => {
        const started: number[] = [];
        let inFlightWorkFinished = false;

        await expect(
            mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
                started.push(value);
                if (value === 1) {
                    throw new Error('mapper failed');
                }
                await Bun.sleep(5);
                inFlightWorkFinished = true;
                return value;
            }),
        ).rejects.toThrow('mapper failed');

        expect(started).toEqual([1, 2]);
        expect(inFlightWorkFinished).toBe(true);
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

describe('limiter cancellation', () => {
    it('should remove aborted queued work without running it', async () => {
        const limit = createConcurrencyLimiter(1);
        const gate = Promise.withResolvers<void>();
        const active = limit(() => gate.promise);
        const controller = new AbortController();
        let ran = false;
        const queued = limit(
            async () => {
                ran = true;
            },
            { signal: controller.signal },
        );
        controller.abort();
        await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
        gate.resolve();
        await active;
        await expect(limit(async () => 'next')).resolves.toBe('next');
        expect(ran).toBe(false);
    });

    it('should abort active callers but retain capacity until their work settles', async () => {
        const limit = createConcurrencyLimiter(1);
        const gate = Promise.withResolvers<void>();
        const started = Promise.withResolvers<AbortSignal>();
        const controller = new AbortController();
        const active = limit(
            async (signal) => {
                started.resolve(signal);
                await gate.promise;
            },
            { signal: controller.signal },
        );
        const signal = await started.promise;
        controller.abort(new Error('cancelled'));
        await expect(active).rejects.toThrow('cancelled');
        expect(signal.aborted).toBe(true);
        let ran = false;
        const next = limit(async () => {
            ran = true;
        });
        await Promise.resolve();
        expect(ran).toBe(false);
        gate.resolve();
        await next;
        expect(ran).toBe(true);
    });

    it('should time out queued work and preserve completed results after a later abort', async () => {
        const limit = createConcurrencyLimiter(1);
        const gate = Promise.withResolvers<void>();
        const active = limit(() => gate.promise);
        await expect(limit(async () => 'never', { timeoutMs: 1 })).rejects.toMatchObject({ name: 'TimeoutError' });
        gate.resolve();
        await active;
        const controller = new AbortController();
        const result = limit(async () => 'done', { signal: controller.signal });
        await expect(result).resolves.toBe('done');
        controller.abort();
        await expect(result).resolves.toBe('done');
    });

    it('should propagate active timeout and drain after rejection cleanup', async () => {
        const limit = createConcurrencyLimiter(1);
        const cleaned = Promise.withResolvers<void>();
        const result = limit(
            async (signal) => {
                await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
                cleaned.resolve();
                throw signal.reason;
            },
            { timeoutMs: 1 },
        );
        await expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
        await cleaned.promise;
        await expect(limit(async () => 'drained')).resolves.toBe('drained');
    });

    it('should reject pre-aborted work and invalid deadlines without admitting it', async () => {
        const limit = createConcurrencyLimiter(1);
        const task = async () => {
            throw new Error('must not run');
        };
        await expect(limit(task, { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
        await expect(limit(task, { timeoutMs: -1 })).rejects.toThrow('timeoutMs');
        await expect(limit(task, { timeoutMs: 2_147_483_648 })).rejects.toThrow('timeoutMs');
        await expect(limit(async () => 'within-range', { timeoutMs: 2_147_483_647 })).resolves.toBe('within-range');
    });
});
