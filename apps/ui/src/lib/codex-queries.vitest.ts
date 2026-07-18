import { describe, expect, it } from 'vitest';
import { threadSnapshotQueryOptions } from './codex-queries';

describe('threadSnapshotQueryOptions', () => {
    it('should reuse the snapshot cache across transcript filter changes', () => {
        const first = threadSnapshotQueryOptions('thread-1');
        const second = threadSnapshotQueryOptions('thread-1');

        expect(first.queryKey).toEqual(['thread', 'thread-1']);
        expect(second.queryKey).toEqual(first.queryKey);
    });
});
