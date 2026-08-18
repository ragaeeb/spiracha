import type { CursorPruneResult } from '@spiracha/lib/cursor-exporter-types';
import { describe, expect, it } from 'vitest';
import {
    getCursorCleanupFailureMessage,
    getCursorCleanupFailures,
    hasCursorCleanupFailures,
} from './cursor-delete-result';

const result = (cleanupFailures: CursorPruneResult['cleanupFailures']): CursorPruneResult => ({
    bubblesDeleted: 0,
    cleanupFailures,
    composerDataDeleted: 0,
    composerIds: [],
    headersRemoved: 0,
    transcriptDirsRemoved: 0,
    transcriptDirsRemovedPaths: [],
    workspaceBucketsUpdated: 0,
});

describe('Cursor delete result helpers', () => {
    it('should flatten partial cleanup failures from every workspace result', () => {
        const failures = [{ error: 'busy', phase: 'workspace_buckets' as const }];

        expect(getCursorCleanupFailures([result(failures), result([])])).toEqual(failures);
        expect(getCursorCleanupFailureMessage(result(failures))).toContain('1 filesystem cleanup failure: busy. Retry');
    });

    it('should return no partial-cleanup message for a complete deletion', () => {
        expect(getCursorCleanupFailures(result([]))).toEqual([]);
        expect(getCursorCleanupFailureMessage(result([]))).toBeNull();
        expect(hasCursorCleanupFailures(result([]))).toBe(false);
    });

    it('should keep a workspace query mounted while cleanup can be retried', () => {
        expect(hasCursorCleanupFailures(result([{ error: 'busy', phase: 'workspace_history' }]))).toBe(true);
        expect(hasCursorCleanupFailures(undefined)).toBe(false);
    });
});
