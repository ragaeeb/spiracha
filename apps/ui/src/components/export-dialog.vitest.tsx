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
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
            zipArchive: false,
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
                includeMetadata: false,
                includeTools: true,
                outputFormat: 'txt',
                zipArchive: false,
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

        fireEvent.click(screen.getByRole('checkbox', { name: /include tool calls/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Download export' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onExport).toHaveBeenCalledWith({
            includeCommentary: false,
            includeMetadata: true,
            includeTools: false,
            outputFormat: 'md',
            zipArchive: false,
        });
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('should submit zip archive when selected', () => {
        const onExport = vi.fn();

        render(<ExportDialog open onExport={onExport} onOpenChange={vi.fn()} />);

        fireEvent.click(screen.getByRole('checkbox', { name: /zip archive/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Download export' }));

        expect(onExport).toHaveBeenCalledWith({
            includeCommentary: false,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
            zipArchive: true,
        });
    });

    it('should force zip archive for multi-thread exports', () => {
        const onExport = vi.fn();

        render(<ExportDialog forceZipArchive open onExport={onExport} onOpenChange={vi.fn()} />);

        const zipArchive = screen.getByRole('checkbox', { name: /zip archive/i }) as HTMLButtonElement;
        expect(zipArchive.getAttribute('aria-checked')).toBe('true');
        expect(zipArchive.disabled).toBe(true);
        expect(screen.getByText('Required when exporting multiple threads.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Download export' }));

        expect(onExport).toHaveBeenCalledWith({
            includeCommentary: false,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
            zipArchive: true,
        });
    });

    it('should reset local options after closing and reopening', () => {
        const onExport = vi.fn();
        const { rerender } = render(<ExportDialog open onExport={onExport} onOpenChange={vi.fn()} />);

        fireEvent.click(screen.getByRole('checkbox', { name: /include metadata/i }));
        fireEvent.click(screen.getByRole('checkbox', { name: /include commentary/i }));
        fireEvent.click(screen.getByRole('checkbox', { name: /zip archive/i }));

        rerender(<ExportDialog open={false} onExport={onExport} onOpenChange={vi.fn()} />);
        rerender(<ExportDialog open onExport={onExport} onOpenChange={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: 'Download export' }));

        expect(onExport).toHaveBeenLastCalledWith({
            includeCommentary: false,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
            zipArchive: false,
        });
    });

    it('should show export errors inline while dialog remains open', () => {
        render(<ExportDialog errorMessage="Could not export thread" open onExport={vi.fn()} onOpenChange={vi.fn()} />);

        expect(screen.getByText('Could not export thread')).toBeTruthy();
    });
});
