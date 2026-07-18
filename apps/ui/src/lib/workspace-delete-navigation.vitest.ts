import { describe, expect, it } from 'vitest';
import { isWorkspaceEmptiedByDelete, shouldNavigateToSourceIndexAfterDelete } from './workspace-delete-navigation';

const items = [{ id: 'session-1' }, { id: 'session-2' }];

describe('workspace delete navigation helpers', () => {
    it('should detect when every item in the current workspace was deleted', () => {
        expect(isWorkspaceEmptiedByDelete(items, ['session-1', 'session-2'], (item) => item.id)).toBe(true);
    });

    it('should keep the current workspace when undeleted items remain', () => {
        expect(isWorkspaceEmptiedByDelete(items, ['session-1'], (item) => item.id)).toBe(false);
    });

    it('should keep empty workspaces from forcing navigation on unrelated deletes', () => {
        expect(isWorkspaceEmptiedByDelete([], ['session-1'], (item: { id: string }) => item.id)).toBe(false);
    });

    it('should navigate to the source index when the deleted workspace no longer exists', () => {
        const workspaces = [{ key: 'workspace-b' }];

        expect(shouldNavigateToSourceIndexAfterDelete(workspaces, 'workspace-a', (item) => item.key)).toBe(true);
        expect(shouldNavigateToSourceIndexAfterDelete(workspaces, 'workspace-b', (item) => item.key)).toBe(false);
    });
});
