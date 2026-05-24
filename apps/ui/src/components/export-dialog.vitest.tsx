import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExportDialog } from './export-dialog';

describe('ExportDialog', () => {
    it('should submit default export options before any changes', async () => {
        const onExport = vi.fn();

        render(<ExportDialog open onExport={onExport} onOpenChange={vi.fn()} />);

        fireEvent.click(screen.getByText('Download export'));

        expect(onExport).toHaveBeenCalledWith({
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
            fireEvent.click(screen.getByRole('combobox'));
            fireEvent.click(screen.getByText('Plain text (.txt)'));
            fireEvent.click(screen.getAllByRole('button', { name: 'Download export' })[0]!);

            expect(onExport).toHaveBeenCalledWith({
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
});
