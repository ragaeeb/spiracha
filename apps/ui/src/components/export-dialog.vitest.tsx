import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsProvider } from '#/lib/settings-store';
import { ExportDialog } from './export-dialog';

afterEach(() => {
    cleanup();
    window.localStorage.clear();
});

describe('ExportDialog', () => {
    it('should build, validate, preview, and download focused evidence through the shared flow', async () => {
        const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
        HTMLElement.prototype.scrollIntoView = vi.fn();
        const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
            Response.json({
                data: {
                    markdown: '# Focused evidence: Thread 1\n',
                    meta: {
                        approximateTokens: 8,
                        episodeCount: 1,
                        generatedAt: '2026-07-19T12:00:00.000Z',
                        omission: {
                            budgetReached: false,
                            deduplicatedDiagnostics: 0,
                            inputCharacters: 100,
                            inputEvents: 4,
                            omittedBinaryPayloads: 0,
                            omittedEvents: 2,
                            selectedEvents: 2,
                            truncatedArrays: 0,
                            truncatedFields: 0,
                        },
                        projectedCharacters: 29,
                        rendererVersion: 'focused-evidence/v2',
                    },
                },
            }),
        );
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:evidence'), revokeObjectURL: vi.fn() });
        const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
        render(
            <ExportDialog
                focusedEvidenceTarget={{ id: 'thread-1', source: 'codex' }}
                open
                onExport={vi.fn()}
                onOpenChange={vi.fn()}
            />,
        );

        try {
            fireEvent.click(screen.getByRole('combobox', { name: 'Export mode' }));
            fireEvent.click(screen.getByText('Focused evidence'));
            expect(screen.getByTestId('evidence-lens-editor')).toBeTruthy();
            fireEvent.change(screen.getByRole('textbox', { name: 'Artifact glob' }), {
                target: { value: 'reports/**/*.json' },
            });
            fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!);
            fireEvent.click(screen.getByRole('button', { name: 'Preview evidence' }));
            expect(await screen.findByText(/4 inspected events, 1 episodes, 29 characters/)).toBeTruthy();
            fireEvent.click(screen.getByRole('button', { name: 'Download export' }));
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/v1/conversations/codex/thread-1/evidence');
        } finally {
            HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
            anchorClick.mockRestore();
            vi.unstubAllGlobals();
        }
    });
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

    it('should prevent duplicate submissions before pending state propagates', () => {
        const onExport = vi.fn();
        render(<ExportDialog open onExport={onExport} onOpenChange={vi.fn()} />);
        const submit = screen.getByRole('button', { name: 'Download export' });

        fireEvent.click(submit);
        fireEvent.click(submit);

        expect(onExport).toHaveBeenCalledTimes(1);
        expect((submit as HTMLButtonElement).disabled).toBe(true);
    });

    it('should disable export submission without showing pending text when disabled', () => {
        render(<ExportDialog disabled open onExport={vi.fn()} onOpenChange={vi.fn()} />);

        expect((screen.getByRole('button', { name: 'Download export' }) as HTMLButtonElement).disabled).toBe(true);
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

    it('should remember successfully submitted options after closing and reopening', () => {
        const onExport = vi.fn();
        const renderDialog = (open: boolean) => (
            <SettingsProvider>
                <ExportDialog open={open} onExport={onExport} onOpenChange={vi.fn()} />
            </SettingsProvider>
        );
        const { rerender } = render(renderDialog(true));

        fireEvent.click(screen.getByRole('checkbox', { name: /include metadata/i }));
        fireEvent.click(screen.getByRole('checkbox', { name: /include commentary/i }));
        fireEvent.click(screen.getByRole('checkbox', { name: /zip archive/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Download export' }));

        rerender(renderDialog(false));
        rerender(renderDialog(true));

        fireEvent.click(screen.getByRole('button', { name: 'Download export' }));

        expect(onExport).toHaveBeenLastCalledWith({
            includeCommentary: true,
            includeMetadata: false,
            includeTools: true,
            outputFormat: 'md',
            zipArchive: true,
        });
    });

    it('should discard canceled drafts without overwriting submitted defaults', () => {
        const onExport = vi.fn();
        const onOpenChange = vi.fn();
        const renderDialog = (open: boolean) => (
            <SettingsProvider>
                <ExportDialog open={open} onExport={onExport} onOpenChange={onOpenChange} />
            </SettingsProvider>
        );
        const { rerender } = render(renderDialog(true));

        fireEvent.click(screen.getByRole('checkbox', { name: /include commentary/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Download export' }));
        rerender(renderDialog(false));
        rerender(renderDialog(true));
        fireEvent.click(screen.getByRole('checkbox', { name: /include commentary/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        rerender(renderDialog(false));
        rerender(renderDialog(true));
        fireEvent.click(screen.getByRole('button', { name: 'Download export' }));

        expect(onExport).toHaveBeenLastCalledWith({
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
            zipArchive: false,
        });
    });

    it('should not persist forced multi-thread zip as the single-thread default', () => {
        const onExport = vi.fn();
        const renderDialog = (open: boolean, forceZipArchive: boolean) => (
            <SettingsProvider>
                <ExportDialog
                    forceZipArchive={forceZipArchive}
                    open={open}
                    onExport={onExport}
                    onOpenChange={vi.fn()}
                />
            </SettingsProvider>
        );
        const { rerender } = render(renderDialog(true, true));

        fireEvent.click(screen.getByRole('button', { name: 'Download export' }));
        rerender(renderDialog(false, true));
        rerender(renderDialog(true, false));
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

    it('should hide unsupported transcript filters instead of offering ignored options', () => {
        const onExport = vi.fn();
        render(
            <ExportDialog
                open
                showCommentaryOption={false}
                showToolsOption={false}
                title="Export opaque conversation"
                onExport={onExport}
                onOpenChange={vi.fn()}
            />,
        );
        const dialog = screen.getByRole('dialog', { name: 'Export opaque conversation' });
        const dialogQueries = within(dialog);

        expect(dialogQueries.queryByRole('checkbox', { name: /include commentary/i })).toBeNull();
        expect(dialogQueries.queryByRole('checkbox', { name: /include tool calls/i })).toBeNull();
        expect(dialogQueries.queryByText(/whether the export includes tool calls/i)).toBeNull();
        expect(dialogQueries.getByText('Choose the transcript format and export options.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Download export' }));
        expect(onExport).toHaveBeenCalledWith({
            includeCommentary: false,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
            zipArchive: false,
        });
    });
});
