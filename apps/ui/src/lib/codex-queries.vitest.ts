import { describe, expect, it } from 'vitest';
import {
    threadSnapshotQueryOptions,
    threadTranscriptPreviewQueryOptions,
    threadTranscriptQueryOptions,
} from './codex-queries';

describe('threadSnapshotQueryOptions', () => {
    it('should reuse the snapshot cache across transcript filter changes', () => {
        const first = threadSnapshotQueryOptions('thread-1');
        const second = threadSnapshotQueryOptions('thread-1');

        expect(first.queryKey).toEqual(['thread', 'thread-1']);
        expect(second.queryKey).toEqual(first.queryKey);
    });

    it('should not passively refresh thread data while live mode is disabled', () => {
        const queries = [
            threadSnapshotQueryOptions('thread-1'),
            threadTranscriptPreviewQueryOptions('thread-1'),
            threadTranscriptQueryOptions('thread-1'),
        ];

        for (const query of queries) {
            expect(query.refetchOnReconnect).toBe(false);
            expect(query.refetchOnWindowFocus).toBe(false);
        }
    });
});
