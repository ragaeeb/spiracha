import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectionActionsToolbar } from './selection-actions-toolbar';

describe('SelectionActionsToolbar', () => {
    afterEach(cleanup);

    it('should use the selected count when pluralizing action labels', () => {
        render(
            <SelectionActionsToolbar
                clearSelection={vi.fn()}
                itemLabel="session"
                selectedCount={1}
                onDeleteSelected={vi.fn()}
                onExportSelected={vi.fn()}
            />,
        );

        expect(screen.getByRole('button', { name: 'Export selected session' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Delete selected session' })).toBeTruthy();
    });

    it('should render useful empty guidance when no batch actions are available', () => {
        render(<SelectionActionsToolbar clearSelection={vi.fn()} itemLabel="session" selectedCount={0} />);

        expect(screen.getByText('Select sessions to manage them in a batch.')).toBeTruthy();
        expect(screen.queryByText(/undefined/u)).toBeNull();
    });
});
