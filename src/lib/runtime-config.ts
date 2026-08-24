export const DEFAULT_UI_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_UI_CACHE_MAX_BYTES = 256 * 1024 * 1024;
export const DEFAULT_UI_EXPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_UI_EXPORT_MAX_BYTES = 1024 * 1024 * 1024;
export const DEFAULT_UI_LARGE_EXPORT_THRESHOLD_BYTES = 128 * 1024 * 1024;

export type UiRuntimeConfig = {
    cacheBypass: boolean;
    cacheMaxAgeMs: number;
    cacheMaxBytes: number;
    exportMaxAgeMs: number;
    exportMaxBytes: number;
    largeExportThresholdBytes: number;
};

const parseBooleanFlag = (name: string, value: string | undefined): boolean => {
    if (value === undefined || value === '' || value === '0') {
        return false;
    }
    if (value === '1') {
        return true;
    }
    throw new Error(`${name} must be 0 or 1.`);
};

const parseNonNegativeInteger = (name: string, value: string | undefined, fallback: number): number => {
    if (value === undefined || value.trim() === '') {
        return fallback;
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new Error(`${name} must be a non-negative safe integer.`);
    }
    return parsed;
};

export const resolveUiRuntimeConfig = (env: NodeJS.ProcessEnv = process.env): UiRuntimeConfig => ({
    cacheBypass: parseBooleanFlag('SPIRACHA_UI_CACHE_BYPASS', env.SPIRACHA_UI_CACHE_BYPASS),
    cacheMaxAgeMs: parseNonNegativeInteger(
        'SPIRACHA_UI_CACHE_MAX_AGE_MS',
        env.SPIRACHA_UI_CACHE_MAX_AGE_MS,
        DEFAULT_UI_CACHE_MAX_AGE_MS,
    ),
    cacheMaxBytes: parseNonNegativeInteger(
        'SPIRACHA_UI_CACHE_MAX_BYTES',
        env.SPIRACHA_UI_CACHE_MAX_BYTES,
        DEFAULT_UI_CACHE_MAX_BYTES,
    ),
    exportMaxAgeMs: parseNonNegativeInteger(
        'SPIRACHA_UI_EXPORT_MAX_AGE_MS',
        env.SPIRACHA_UI_EXPORT_MAX_AGE_MS,
        DEFAULT_UI_EXPORT_MAX_AGE_MS,
    ),
    exportMaxBytes: parseNonNegativeInteger(
        'SPIRACHA_UI_EXPORT_MAX_BYTES',
        env.SPIRACHA_UI_EXPORT_MAX_BYTES,
        DEFAULT_UI_EXPORT_MAX_BYTES,
    ),
    largeExportThresholdBytes: parseNonNegativeInteger(
        'SPIRACHA_UI_LARGE_EXPORT_THRESHOLD_BYTES',
        env.SPIRACHA_UI_LARGE_EXPORT_THRESHOLD_BYTES,
        DEFAULT_UI_LARGE_EXPORT_THRESHOLD_BYTES,
    ),
});
