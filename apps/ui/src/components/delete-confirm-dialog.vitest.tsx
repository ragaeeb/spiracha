import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeleteConfirmDialog } from './delete-confirm-dialog';

describe('DeleteConfirmDialog', () => {
    it('should submit deleteSessionFiles as false by default', () => {
        const onConfirm = vi.fn();

        render(
            <DeleteConfirmDialog
                description="Delete this thread."
                open
                showDeleteSessionFilesOption
                title="Delete thread?"
                onConfirm={onConfirm}
                onOpenChange={vi.fn()}
            />,
        );

        fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);

        expect(onConfirm).toHaveBeenCalledWith({
            deleteSessionFiles: false,
        });
    });

    it('should submit the delete session file option when enabled', () => {
        const onConfirm = vi.fn();

        render(
            <DeleteConfirmDialog
                description="Delete this thread."
                open
                showDeleteSessionFilesOption
                title="Delete thread?"
                onConfirm={onConfirm}
                onOpenChange={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByRole('checkbox', { name: 'Delete Session files' }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);

        expect(onConfirm).toHaveBeenCalledWith({
            deleteSessionFiles: true,
        });
    });

    it('should reset the delete session file option after the dialog closes and reopens', () => {
        const onConfirm = vi.fn();
        const { rerender } = render(
            <DeleteConfirmDialog
                description="Delete this thread."
                open
                showDeleteSessionFilesOption
                title="Delete thread?"
                onConfirm={onConfirm}
                onOpenChange={vi.fn()}
            />,
        );

        const checkbox = screen.getByRole('checkbox', { name: 'Delete Session files' });
        fireEvent.click(checkbox);
        expect(checkbox.getAttribute('aria-checked')).toBe('true');

        rerender(
            <DeleteConfirmDialog
                description="Delete this thread."
                open={false}
                showDeleteSessionFilesOption
                title="Delete thread?"
                onConfirm={onConfirm}
                onOpenChange={vi.fn()}
            />,
        );
        rerender(
            <DeleteConfirmDialog
                description="Delete this thread."
                open
                showDeleteSessionFilesOption
                title="Delete thread?"
                onConfirm={onConfirm}
                onOpenChange={vi.fn()}
            />,
        );

        expect(screen.getByRole('checkbox', { name: 'Delete Session files' }).getAttribute('aria-checked')).toBe(
            'false',
        );
    });
});
