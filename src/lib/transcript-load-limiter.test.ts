import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import {
    resolveTotalTranscriptLoadConcurrency,
    resolveTranscriptLoadConcurrency,
    runWithTranscriptLoadLimit,
    type TranscriptLoadIntegration,
} from './transcript-load-limiter';

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
        expect(resolveTotalTranscriptLoadConcurrency(3)).toBe(16);
        expect(resolveTotalTranscriptLoadConcurrency(16)).toBe(32);
    });

    it('should enforce the concurrency limit within one integration', async () => {
        process.env.SPIRACHA_TRANSCRIPT_LOAD_LOGS = '0';
        let active = 0;
        let maxActive = 0;

        await Promise.all(
            Array.from({ length: 8 }, (_, index) =>
                runWithTranscriptLoadLimit(
                    async () => {
                        active += 1;
                        maxActive = Math.max(maxActive, active);
                        await Bun.sleep(2);
                        active -= 1;
                        return index;
                    },
                    { integration: 'codex', operation: 'test' },
                ),
            ),
        );

        expect(maxActive).toBeLessThanOrEqual(resolveTranscriptLoadConcurrency());
    });

    it('should not let blocked Kiro loads consume Codex capacity', async () => {
        process.env.SPIRACHA_TRANSCRIPT_LOAD_LOGS = '0';
        let releaseKiroLoads = () => {};
        const releaseKiro = new Promise<void>((resolve) => {
            releaseKiroLoads = resolve;
        });
        let markKiroCapacityReached = () => {};
        const kiroCapacityReached = new Promise<void>((resolve) => {
            markKiroCapacityReached = resolve;
        });
        let activeKiroLoads = 0;
        const kiroLoads = Array.from({ length: resolveTranscriptLoadConcurrency() }, () =>
            runWithTranscriptLoadLimit(
                async () => {
                    activeKiroLoads += 1;
                    if (activeKiroLoads === resolveTranscriptLoadConcurrency()) {
                        markKiroCapacityReached();
                    }
                    await releaseKiro;
                },
                { integration: 'kiro', operation: 'detail' },
            ),
        );

        await kiroCapacityReached;
        const codexLoad = runWithTranscriptLoadLimit(async () => 'codex-ready', {
            integration: 'codex',
            operation: 'full',
        });
        const outcome = await Promise.race([codexLoad, Bun.sleep(50).then(() => 'blocked')]);

        releaseKiroLoads();
        await Promise.all(kiroLoads);
        expect(outcome).toBe('codex-ready');
        await expect(codexLoad).resolves.toBe('codex-ready');
    });

    it('should retain a bounded aggregate concurrency across integrations', async () => {
        const integrations: TranscriptLoadIntegration[] = [
            'antigravity',
            'claude-code',
            'codex',
            'cursor',
            'grok',
            'kiro',
            'opencode',
            'qoder',
        ];
        let active = 0;
        let maxActive = 0;

        await Promise.all(
            integrations.flatMap((integration) =>
                Array.from({ length: resolveTranscriptLoadConcurrency() }, () =>
                    runWithTranscriptLoadLimit(
                        async () => {
                            active += 1;
                            maxActive = Math.max(maxActive, active);
                            await Bun.sleep(2);
                            active -= 1;
                        },
                        { integration, operation: 'aggregate-test' },
                    ),
                ),
            ),
        );

        expect(maxActive).toBeLessThanOrEqual(resolveTotalTranscriptLoadConcurrency());
    });

    it('should release a slot after a loader rejects', async () => {
        process.env.SPIRACHA_TRANSCRIPT_LOAD_LOGS = '0';

        await expect(
            runWithTranscriptLoadLimit(
                async () => {
                    throw new Error('load failed');
                },
                { integration: 'codex', operation: 'test' },
            ),
        ).rejects.toThrow('load failed');

        await expect(
            runWithTranscriptLoadLimit(async () => 'recovered', { integration: 'codex', operation: 'test' }),
        ).resolves.toBe('recovered');
    });

    it('should keep transcript load diagnostics quiet unless explicitly enabled', async () => {
        delete process.env.SPIRACHA_TRANSCRIPT_LOAD_LOGS;
        const infoSpy = spyOn(console, 'info').mockImplementation(() => undefined);

        try {
            await runWithTranscriptLoadLimit(async () => 'quiet', { integration: 'codex', operation: 'test' });
            expect(infoSpy).not.toHaveBeenCalled();

            process.env.SPIRACHA_TRANSCRIPT_LOAD_LOGS = '1';
            await runWithTranscriptLoadLimit(async () => 'logged', { integration: 'codex', operation: 'test' });
            expect(infoSpy).toHaveBeenCalledWith('[spiracha:transcript-load] start', expect.any(Object));
            expect(infoSpy).toHaveBeenCalledWith('[spiracha:transcript-load] finish', expect.any(Object));
        } finally {
            infoSpy.mockRestore();
        }
    });
});
