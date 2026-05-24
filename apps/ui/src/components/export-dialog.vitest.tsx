import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExportDialog } from './export-dialog';

describe('ExportDialog', () => {
    it('should submit default export options before any changes', async () => {
        const onExport = vi.fn();

        render(<ExportDialog open onExport={onExport} onOpenChange={vi.fn()} />);

        fireEvent.click(screen.getByText('Download export'));

        expect(onExport).toHaveBeenCalledWith({
            includeCommentary: false,
            includeTools: true,
            optimized: false,
            outputFormat: 'md',
        });
    });

    it('should submit the selected export options', async () => {
        const onExport = vi.fn();
        const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
        HTMLElement.prototype.scrollIntoView = vi.fn();

        render(<ExportDialog open onExport={onExport} onOpenChange={vi.fn()} />);

        try {
            fireEvent.click(screen.getAllByRole('checkbox')[0]);
            fireEvent.click(screen.getAllByRole('checkbox')[1]);
            fireEvent.click(screen.getByRole('combobox'));
            fireEvent.click(screen.getByText('Plain text (.txt)'));
            fireEvent.click(screen.getAllByRole('button', { name: 'Download export' })[0]!);

            expect(onExport).toHaveBeenCalledWith({
                includeCommentary: true,
                includeTools: true,
                optimized: true,
                outputFormat: 'txt',
            });
        } finally {
            HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
        }
    });

    it('should disable export submission while pending', () => {
        render(<ExportDialog open pending onExport={vi.fn()} onOpenChange={vi.fn()} />);

        expect((screen.getByRole('button', { name: 'Exporting...' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('should allow disabling tool-call inclusion and closing the dialog', () => {
        const onExport = vi.fn();
        const onOpenChange = vi.fn();

        render(<ExportDialog open onExport={onExport} onOpenChange={onOpenChange} />);

        fireEvent.click(screen.getAllByRole('checkbox')[2]!);
        fireEvent.click(screen.getByRole('button', { name: 'Download export' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onExport).toHaveBeenCalledWith({
            includeCommentary: false,
            includeTools: false,
            optimized: false,
            outputFormat: 'md',
        });
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});
