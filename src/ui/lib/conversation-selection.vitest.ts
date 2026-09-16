import { describe, expect, it } from 'vitest';
import {
    conversationListSelection,
    formatSelectionCount,
    lookupSelectedById,
    lookupSelectedItems,
    pruneSelectionToAuthoritative,
    selectedIdsFromRecord,
    summarizeSelection,
} from './conversation-selection';

describe('conversation selection', () => {
    it('should look up selected ids from full membership including filtered-out rows', () => {
        const itemsById = new Map([
            ['keep', { id: 'keep', title: 'Visible' }],
            ['hidden', { id: 'hidden', title: 'Hidden by filter' }],
        ]);

        expect(lookupSelectedById(['hidden', 'keep', 'gone'], itemsById)).toEqual([
            { id: 'hidden', title: 'Hidden by filter' },
            { id: 'keep', title: 'Visible' },
        ]);
        expect(lookupSelectedItems(['hidden', 'keep'], [...itemsById.values()], (item) => item.id)).toEqual([
            { id: 'hidden', title: 'Hidden by filter' },
            { id: 'keep', title: 'Visible' },
        ]);
        expect(conversationListSelection('command-code', ['session-1'], 'ws-1')).toEqual({
            authoritativeRowIds: ['session-1'],
            inventoryIdentity: 'command-code:ws-1',
        });
        expect(conversationListSelection('grok-bot', ['chat-1']).inventoryIdentity).toBe('grok-bot');
    });

    it('should announce hidden selected ids that are outside the current view', () => {
        const summary = summarizeSelection(['row-1', 'row-2'], ['row-2']);

        expect(summary).toEqual({
            hiddenCount: 1,
            selectedCount: 2,
            selectedIds: ['row-1', 'row-2'],
            visibleSelectedCount: 1,
        });
        expect(formatSelectionCount('session', summary)).toBe('2 sessions selected (1 outside this view)');
    });

    it('should drop selected ids that leave the authoritative membership', () => {
        const next = pruneSelectionToAuthoritative({ 'row-1': true, 'row-2': true }, new Set(['row-2']));

        expect(selectedIdsFromRecord(next)).toEqual(['row-2']);
    });
});
