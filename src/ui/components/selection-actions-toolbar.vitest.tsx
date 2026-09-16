import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supportedListAction } from '#/lib/conversation-actions';
import { ConversationSelectionActions, SelectionActionsToolbar } from './selection-actions-toolbar';

describe('SelectionActionsToolbar', () => {
    afterEach(cleanup);

    it('should use the selected count when pluralizing action labels', () => {
        render(
            <ConversationSelectionActions
                clearSelection={vi.fn()}
                deleteAction={supportedListAction(vi.fn())}
                exportAction={supportedListAction(vi.fn())}
                itemLabel="session"
                selectedCount={1}
            />,
        );

        expect(screen.getByRole('button', { name: 'Export selected session' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Delete selected session' })).toBeTruthy();
        expect(screen.getByRole('status').textContent).toBe('1 session selected');
    });

    it('should announce hidden selected ids outside the current view', () => {
        render(
            <ConversationSelectionActions
                clearSelection={vi.fn()}
                deleteAction={supportedListAction(vi.fn())}
                exportAction={supportedListAction(vi.fn())}
                hiddenSelectedCount={1}
                itemLabel="session"
                selectedCount={2}
            />,
        );

        expect(screen.getByRole('status').textContent).toBe('2 sessions selected (1 outside this view)');
    });

    it('should require declared batch actions instead of hiding them with optional callbacks', () => {
        render(
            <SelectionActionsToolbar
                clearSelection={vi.fn()}
                deleteAction={{
                    reason: 'Original files and deletion stay on the Codex Cloud account.',
                    state: 'unsupported',
                }}
                exportAction={supportedListAction(vi.fn())}
                itemLabel="thread"
                selectedCount={0}
            />,
        );

        expect(screen.getByText(/Select threads to export them in a batch/)).toBeTruthy();
        expect(screen.getByText(/Original files and deletion stay on the Codex Cloud account/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Delete/i })).toBeNull();
    });

    it('should render useful empty guidance when no batch actions are applicable', () => {
        render(
            <SelectionActionsToolbar
                clearSelection={vi.fn()}
                deleteAction={{ reason: 'Workspace inventory does not delete conversations.', state: 'not_applicable' }}
                exportAction={{
                    reason: 'Workspace inventory does not export conversations.',
                    state: 'not_applicable',
                }}
                itemLabel="session"
                selectedCount={0}
            />,
        );

        expect(screen.getByText(/Select sessions to manage them in a batch/)).toBeTruthy();
        expect(screen.queryByText(/undefined/u)).toBeNull();
    });

    it('should label web removals without calling them a source-store delete', () => {
        render(
            <ConversationSelectionActions
                clearSelection={vi.fn()}
                deleteAction={supportedListAction(vi.fn(), { verb: 'Remove' })}
                exportAction={supportedListAction(vi.fn())}
                itemLabel="imported conversation"
                selectedCount={1}
            />,
        );

        expect(screen.getByRole('button', { name: 'Remove selected imported conversation' })).toBeTruthy();
    });
});
