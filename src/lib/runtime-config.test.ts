import { describe, expect, it } from 'bun:test';
import {
    DEFAULT_UI_CACHE_MAX_AGE_MS,
    DEFAULT_UI_CACHE_MAX_BYTES,
    DEFAULT_UI_EXPORT_MAX_AGE_MS,
    DEFAULT_UI_EXPORT_MAX_BYTES,
    DEFAULT_UI_LARGE_EXPORT_THRESHOLD_BYTES,
    resolveUiRuntimeConfig,
} from './runtime-config';

describe('UI runtime configuration', () => {
    it('should expose bounded lifecycle defaults', () => {
        expect(resolveUiRuntimeConfig({})).toEqual({
            cacheBypass: false,
            cacheMaxAgeMs: DEFAULT_UI_CACHE_MAX_AGE_MS,
            cacheMaxBytes: DEFAULT_UI_CACHE_MAX_BYTES,
            exportMaxAgeMs: DEFAULT_UI_EXPORT_MAX_AGE_MS,
            exportMaxBytes: DEFAULT_UI_EXPORT_MAX_BYTES,
            largeExportThresholdBytes: DEFAULT_UI_LARGE_EXPORT_THRESHOLD_BYTES,
        });
    });

    it('should parse explicit development and artifact lifecycle controls', () => {
        expect(
            resolveUiRuntimeConfig({
                SPIRACHA_UI_CACHE_BYPASS: '1',
                SPIRACHA_UI_CACHE_MAX_AGE_MS: '2500',
                SPIRACHA_UI_CACHE_MAX_BYTES: '4096',
                SPIRACHA_UI_EXPORT_MAX_AGE_MS: '5000',
                SPIRACHA_UI_EXPORT_MAX_BYTES: '8192',
                SPIRACHA_UI_LARGE_EXPORT_THRESHOLD_BYTES: '16384',
            }),
        ).toEqual({
            cacheBypass: true,
            cacheMaxAgeMs: 2500,
            cacheMaxBytes: 4096,
            exportMaxAgeMs: 5000,
            exportMaxBytes: 8192,
            largeExportThresholdBytes: 16384,
        });
    });

    it('should fail loudly for malformed or unsafe lifecycle controls', () => {
        expect(() => resolveUiRuntimeConfig({ SPIRACHA_UI_CACHE_BYPASS: 'yes' })).toThrow('SPIRACHA_UI_CACHE_BYPASS');
        expect(() => resolveUiRuntimeConfig({ SPIRACHA_UI_CACHE_MAX_BYTES: '-1' })).toThrow(
            'SPIRACHA_UI_CACHE_MAX_BYTES',
        );
        expect(() => resolveUiRuntimeConfig({ SPIRACHA_UI_EXPORT_MAX_AGE_MS: '1.5' })).toThrow(
            'SPIRACHA_UI_EXPORT_MAX_AGE_MS',
        );
    });
});
