import type { CursorCleanupFailure, CursorPruneResult } from '@spiracha/lib/cursor-exporter-types';

export const getCursorCleanupFailures = (result: CursorPruneResult | CursorPruneResult[]): CursorCleanupFailure[] => {
    const results = Array.isArray(result) ? result : [result];
    return results.flatMap((entry) => entry.cleanupFailures ?? []);
};

export const getCursorCleanupFailureMessage = (result: CursorPruneResult | CursorPruneResult[]): string | null => {
    const failures = getCursorCleanupFailures(result);
    if (failures.length === 0) {
        return null;
    }

    const details = failures.map(({ error, path }) => (path ? `${path}: ${error}` : error)).join('; ');
    return `Deletion completed with ${failures.length} filesystem cleanup failure${failures.length === 1 ? '' : 's'}: ${details}. Retry to attempt the failed cleanup again.`;
};

export const hasCursorCleanupFailures = (result: CursorPruneResult | CursorPruneResult[] | undefined): boolean =>
    result !== undefined && getCursorCleanupFailures(result).length > 0;
