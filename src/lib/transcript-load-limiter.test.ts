import { afterEach, describe, expect, it } from 'bun:test';
import { resolveTranscriptLoadConcurrency, runWithTranscriptLoadLimit } from './transcript-load-limiter';

const originalLogSetting = process.env.SPIRACHA_TRANSCRIPT_LOAD_LOGS;

afterEach(() => {
    if (originalLogSetting === undefined) {
        delete process.env.SPIRACHA_TRANSCRIPT_LOAD_LOGS;
    } else {
        process.env.SPIRACHA_TRANSCRIPT_LOAD_LOGS = originalLogSetting;
    }
});

describe('transcript load limiter', () => {
    it('should clamp configured concurrency to the safe maximum', () => {
        expect(resolveTranscriptLoadConcurrency('999')).toBe(16);
        expect(resolveTranscriptLoadConcurrency('0')).toBe(3);
        expect(resolveTranscriptLoadConcurrency('invalid')).toBe(3);
    });

    it('should enforce the shared concurrency limit', async () => {
        process.env.SPIRACHA_TRANSCRIPT_LOAD_LOGS = '0';
        let active = 0;
        let maxActive = 0;

        await Promise.all(
            Array.from({ length: 8 }, (_, index) =>
                runWithTranscriptLoadLimit(async () => {
                    active += 1;
                    maxActive = Math.max(maxActive, active);
                    await Bun.sleep(2);
                    active -= 1;
                    return index;
                }),
            ),
        );

        expect(maxActive).toBeLessThanOrEqual(resolveTranscriptLoadConcurrency());
    });

    it('should release a slot after a loader rejects', async () => {
        process.env.SPIRACHA_TRANSCRIPT_LOAD_LOGS = '0';

        await expect(
            runWithTranscriptLoadLimit(async () => {
                throw new Error('load failed');
            }),
        ).rejects.toThrow('load failed');

        await expect(runWithTranscriptLoadLimit(async () => 'recovered')).resolves.toBe('recovered');
    });
});
