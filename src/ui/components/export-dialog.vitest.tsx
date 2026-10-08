import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as download from '#/lib/download';
import { ZIP_PASSWORD_STORAGE_KEY } from '#/lib/export-options';
import { SettingsProvider } from '#/lib/settings-store';
import { ExportDialog } from './export-dialog';

const { exportRawConversationsFnMock } = vi.hoisted(() => ({
    exportRawConversationsFnMock: vi.fn(),
}));

vi.mock('#/lib/source-raw-export-server', () => ({
    exportRawConversationsFn: exportRawConversationsFnMock,
}));

afterEach(() => {
    cleanup();
    window.localStorage.clear();
});

describe('ExportDialog', () => {
    const withScrollIntoView = async (run: () => Promise<void> | void) => {
        const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
        HTMLElement.prototype.scrollIntoView = vi.fn();
        try {
            await run();
        } finally {
            HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
        }
    };
    const chooseFormat = (label: string) => {
        fireEvent.click(screen.getByRole('combobox', { name: 'Output format' }));
        fireEvent.click(screen.getByText(label));
    };

    it('should open on JSON and download raw source bytes with the adapter filename', async () => {
        const downloadRaw = vi.spyOn(download, 'downloadRawBase64File').mockImplementation(() => undefined);
        exportRawConversationsFnMock.mockResolvedValue({
            contentBase64: 'AP/AQQ0K',
            fileName: 'messages.jsonl',
            mimeType: 'application/json',
            mode: 'download_base64',
        });

        try {
            await withScrollIntoView(async () => {
                render(
                    <ExportDialog
                        focusedEvidenceTarget={{ id: 'thread-1', source: 'codex' }}
                        open
                        onExport={vi.fn()}
                        onOpenChange={vi.fn()}
                    />,
                );
                expect(screen.queryByRole('combobox', { name: 'Export mode' })).toBeNull();
                expect(screen.getByRole('combobox', { name: 'Output format' }).textContent).toContain('JSON');
                fireEvent.click(screen.getByRole('button', { name: 'Download export' }));

                await waitFor(() =>
                    expect(downloadRaw).toHaveBeenCalledWith('messages.jsonl', 'AP/AQQ0K', 'application/json', {
                        onStateChange: expect.any(Function),
                    }),
                );
                expect(exportRawConversationsFnMock).toHaveBeenCalledWith({
                    data: { ids: ['thread-1'], source: 'codex', zipArchive: false, zipPassword: '' },
                });
            });
        } finally {
            downloadRaw.mockRestore();
        }
    });

    it('should not offer JSON when a source has no standalone JSON transcript', async () => {
        await withScrollIntoView(() => {
            render(
                <ExportDialog
                    focusedEvidenceTarget={{ id: 'session-1', source: 'opencode' }}
                    open
                    onExport={vi.fn()}
                    onOpenChange={vi.fn()}
                />,
            );
            const format = screen.getByRole('combobox', { name: 'Output format' });
            expect(format.textContent).toContain('Markdown');
            fireEvent.click(format);

            expect(screen.queryByRole('option', { name: 'JSON (original transcript)' })).toBeNull();
            expect(screen.getByRole('option', { name: 'Focused evidence (.md)' })).toBeTruthy();
        });
    });

    it('should offer and download original Grok Bot blob bytes', async () => {
        const downloadRaw = vi.spyOn(download, 'downloadRawBase64File').mockImplementation(() => undefined);
        exportRawConversationsFnMock.mockResolvedValue({
            contentBase64: 'AP/AQQ0K',
            fileName: 'replica.blob',
            mimeType: 'application/json',
            mode: 'download_base64',
        });

        try {
            await withScrollIntoView(async () => {
                render(
                    <ExportDialog
                        focusedEvidenceTarget={{ id: 'chat-1', source: 'grok-bot' }}
                        open
                        onExport={vi.fn()}
                        onOpenChange={vi.fn()}
                    />,
                );
                fireEvent.click(screen.getByRole('button', { name: 'Download export' }));

                await waitFor(() =>
                    expect(downloadRaw).toHaveBeenCalledWith('replica.blob', 'AP/AQQ0K', 'application/json', {
                        onStateChange: expect.any(Function),
                    }),
                );
                expect(exportRawConversationsFnMock).toHaveBeenCalledWith({
                    data: { ids: ['chat-1'], source: 'grok-bot', zipArchive: false, zipPassword: '' },
                });
            });
        } finally {
            downloadRaw.mockRestore();
        }
    });

    it('should offer JSON in the output format list for bulk exports', async () => {
        await withScrollIntoView(() => {
            render(<ExportDialog open showRawJsonOption onExport={vi.fn()} onOpenChange={vi.fn()} />);

            fireEvent.click(screen.getByRole('combobox', { name: 'Output format' }));

            expect(screen.getByRole('option', { name: 'JSON (original transcript)' })).toBeTruthy();
            expect(screen.getByRole('option', { name: 'Markdown (.md)' })).toBeTruthy();
            expect(screen.getByRole('option', { name: 'Plain text (.txt)' })).toBeTruthy();
        });
    });

    it('should submit the bulk raw JSON export callback', async () => {
        const onRawJsonExport = vi.fn();

        await withScrollIntoView(() => {
            render(
                <ExportDialog
                    open
                    onExport={vi.fn()}
                    onOpenChange={vi.fn()}
                    onRawJsonExport={onRawJsonExport}
                    showRawJsonOption
                />,
            );

            fireEvent.click(screen.getByRole('button', { name: 'Download export' }));

            expect(onRawJsonExport).toHaveBeenCalledWith(
                expect.objectContaining({ zipArchive: false, zipPassword: '' }),
                { onDownloadStateChange: expect.any(Function) },
            );
        });
    });

    it('should require a zip when exporting several JSON transcripts', async () => {
        const downloadUrlFile = vi.spyOn(download, 'downloadUrlFileWithCancellation').mockResolvedValue(undefined);
        exportRawConversationsFnMock.mockResolvedValue({
            downloadUrl: '/__exports/cline-raw.zip',
            fileName: 'cline-raw.zip',
            mimeType: 'application/zip',
            mode: 'download_url',
        });

        try {
            await withScrollIntoView(async () => {
                render(
                    <ExportDialog
                        open
                        onExport={vi.fn()}
                        onOpenChange={vi.fn()}
                        rawExport={{ ids: ['task-1', 'task-2'], source: 'cline' }}
                    />,
                );

                const zip = screen.getByRole('checkbox', { name: /zip archive/i }) as HTMLButtonElement;
                expect(zip.getAttribute('aria-checked')).toBe('true');
                expect(zip.disabled).toBe(true);
                fireEvent.click(screen.getByRole('button', { name: 'Download export' }));

                await waitFor(() =>
                    expect(exportRawConversationsFnMock).toHaveBeenCalledWith({
                        data: { ids: ['task-1', 'task-2'], source: 'cline', zipArchive: true, zipPassword: '' },
                    }),
                );
                expect(downloadUrlFile).toHaveBeenCalledWith(
                    expect.any(Object),
                    'cline-raw.zip',
                    '/__exports/cline-raw.zip',
                    { onStateChange: expect.any(Function) },
                );
            });
        } finally {
            downloadUrlFile.mockRestore();
        }
    });

    it('should let a single JSON transcript be zipped with an optional password', async () => {
        const downloadUrlFile = vi.spyOn(download, 'downloadUrlFileWithCancellation').mockResolvedValue(undefined);
        exportRawConversationsFnMock.mockResolvedValue({
            downloadUrl: '/__exports/cline-raw.zip',
            fileName: 'cline-raw.zip',
            mimeType: 'application/zip',
            mode: 'download_url',
        });

        try {
            await withScrollIntoView(async () => {
                render(
                    <ExportDialog
                        open
                        onExport={vi.fn()}
                        onOpenChange={vi.fn()}
                        rawExport={{ ids: ['task-1'], source: 'cline' }}
                    />,
                );

                const zip = screen.getByRole('checkbox', { name: /zip archive/i }) as HTMLButtonElement;
                expect(zip.disabled).toBe(false);
                expect(zip.getAttribute('aria-checked')).toBe('false');
                fireEvent.click(zip);
                fireEvent.change(screen.getByLabelText('ZIP password (optional)'), { target: { value: 'secret' } });
                fireEvent.click(screen.getByRole('button', { name: 'Download export' }));

                await waitFor(() =>
                    expect(exportRawConversationsFnMock).toHaveBeenCalledWith({
                        data: { ids: ['task-1'], source: 'cline', zipArchive: true, zipPassword: 'secret' },
                    }),
                );
            });
        } finally {
            downloadUrlFile.mockRestore();
        }
    });

    it('should not zip a single JSON transcript or send a remembered password while zip is off', async () => {
        window.localStorage.setItem(ZIP_PASSWORD_STORAGE_KEY, 'remembered');
        const downloadRaw = vi.spyOn(download, 'downloadRawBase64File').mockImplementation(() => undefined);
        exportRawConversationsFnMock.mockResolvedValue({
            contentBase64: 'AP/AQQ0K',
            fileName: 'messages.jsonl',
            mimeType: 'application/x-ndjson',
            mode: 'download_base64',
        });

        try {
            await withScrollIntoView(async () => {
                render(
                    <ExportDialog
                        open
                        onExport={vi.fn()}
                        onOpenChange={vi.fn()}
                        rawExport={{ ids: ['task-1'], source: 'cline' }}
                    />,
                );
                fireEvent.click(screen.getByRole('button', { name: 'Download export' }));

                await waitFor(() =>
                    expect(exportRawConversationsFnMock).toHaveBeenCalledWith({
                        data: { ids: ['task-1'], source: 'cline', zipArchive: false, zipPassword: '' },
                    }),
                );
            });
        } finally {
            downloadRaw.mockRestore();
        }
    });

    it('should lock the include options on while JSON is selected and restore the choices for other formats', async () => {
        await withScrollIntoView(() => {
            render(<ExportDialog open showRawJsonOption onExport={vi.fn()} onOpenChange={vi.fn()} />);
            const checkbox = (name: RegExp) => screen.getByRole('checkbox', { name }) as HTMLButtonElement;

            for (const name of [/include metadata/i, /include commentary/i, /include tool calls/i]) {
                expect(checkbox(name).getAttribute('aria-checked')).toBe('true');
                expect(checkbox(name).disabled).toBe(true);
            }

            chooseFormat('Markdown (.md)');
            expect(checkbox(/include commentary/i).disabled).toBe(false);
            expect(checkbox(/include commentary/i).getAttribute('aria-checked')).toBe('false');
            fireEvent.click(checkbox(/include commentary/i));
            expect(checkbox(/include commentary/i).getAttribute('aria-checked')).toBe('true');

            chooseFormat('JSON (original transcript)');
            expect(checkbox(/include tool calls/i).disabled).toBe(true);
            chooseFormat('Markdown (.md)');
            expect(checkbox(/include commentary/i).getAttribute('aria-checked')).toBe('true');
        });
    });

    it('should open on JSON again after exporting another format', async () => {
        const onExport = vi.fn();
        const renderDialog = (open: boolean) => (
            <SettingsProvider>
                <ExportDialog open={open} showRawJsonOption onExport={onExport} onOpenChange={vi.fn()} />
            </SettingsProvider>
        );

        await withScrollIntoView(() => {
            const { rerender } = render(renderDialog(true));
            chooseFormat('Markdown (.md)');
            fireEvent.click(screen.getByRole('button', { name: 'Download export' }));
            expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ outputFormat: 'md' }), expect.any(Object));

            rerender(renderDialog(false));
            rerender(renderDialog(true));

            expect(screen.getByRole('combobox', { name: 'Output format' }).textContent).toContain('JSON');
        });
    });

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
                            budgetReached: true,
                            candidateLimitReached: true,
                            deduplicatedDiagnostics: 0,
                            inputCharacters: 100,
                            inputEvents: 4,
                            matchedEvents: 2,
                            omittedBinaryPayloads: 0,
                            omittedEvents: 2,
                            renderedEvents: 1,
                            renderedMatchedEvents: 1,
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
        const downloadTextFile = vi
            .spyOn(download, 'downloadTextFile')
            .mockImplementation((_fileName, _content, _mimeType, options) => {
                options?.onStateChange?.('ready');
                options?.onStateChange?.('downloading');
            });

        try {
            render(
                <ExportDialog
                    focusedEvidenceTarget={{ id: 'thread-1', source: 'codex' }}
                    open
                    onExport={vi.fn()}
                    onOpenChange={vi.fn()}
                />,
            );
            fireEvent.click(screen.getByRole('combobox', { name: 'Output format' }));
            fireEvent.click(screen.getByText('Focused evidence (.md)'));
            expect(screen.getByTestId('evidence-lens-editor')).toBeTruthy();
            fireEvent.change(screen.getByRole('textbox', { name: 'Artifact glob' }), {
                target: { value: 'reports/**/*.json' },
            });
            fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!);
            fireEvent.click(screen.getByRole('button', { name: 'Preview evidence' }));
            expect(await screen.findByText(/4 inspected events, 1 episodes, 29 characters/)).toBeTruthy();
            expect(screen.getByText(/1 rendered bodies; 1 of 2 matching events rendered/)).toBeTruthy();
            expect(screen.getByText(/Selection limit reached/)).toBeTruthy();
            fireEvent.click(screen.getByRole('button', { name: 'Download export' }));
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/v1/conversations/codex/thread-1/evidence');
            expect(downloadTextFile).toHaveBeenCalledWith(
                'codex-thread-1-focused-evidence.md',
                '# Focused evidence: Thread 1\n',
                'text/markdown; charset=utf-8',
                { onStateChange: expect.any(Function) },
            );
            expect(screen.getByRole('status').textContent).toBe('Starting download...');
        } finally {
            HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
            anchorClick.mockRestore();
            downloadTextFile.mockRestore();
            vi.unstubAllGlobals();
        }
    });
    it('should submit default export options before any changes', async () => {
        const onExport = vi.fn();

        render(<ExportDialog open onExport={onExport} onOpenChange={vi.fn()} />);

        fireEvent.click(screen.getByText('Download export'));

        expect(onExport).toHaveBeenCalledWith(
            expect.objectContaining({
                includeCommentary: false,
                includeMetadata: true,
                includeTools: true,
                outputFormat: 'md',
                zipArchive: false,
            }),
            expect.any(Object),
        );
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

            expect(onExport).toHaveBeenCalledWith(
                expect.objectContaining({
                    includeCommentary: true,
                    includeMetadata: false,
                    includeTools: true,
                    outputFormat: 'txt',
                    zipArchive: false,
                }),
                expect.any(Object),
            );
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
        const cancelActiveDownloads = vi.spyOn(download, 'cancelActiveDownloads');

        render(<ExportDialog open onExport={onExport} onOpenChange={onOpenChange} />);

        fireEvent.click(screen.getByRole('checkbox', { name: /include tool calls/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Download export' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onExport).toHaveBeenCalledWith(
            expect.objectContaining({
                includeCommentary: false,
                includeMetadata: true,
                includeTools: false,
                outputFormat: 'md',
                zipArchive: false,
            }),
            expect.any(Object),
        );
        expect(onOpenChange).toHaveBeenCalledWith(false);
        expect(cancelActiveDownloads).toHaveBeenCalledTimes(1);
        cancelActiveDownloads.mockRestore();
    });

    it('should reset cancelled downloads when the controlled dialog reopens', async () => {
        const onOpenChange = vi.fn();
        const resetActiveDownloads = vi.spyOn(download, 'resetActiveDownloads');
        const renderDialog = (open: boolean) => (
            <ExportDialog open={open} onExport={vi.fn()} onOpenChange={onOpenChange} />
        );
        const { rerender } = render(renderDialog(false));

        rerender(renderDialog(true));

        await waitFor(() => expect(resetActiveDownloads).toHaveBeenCalledTimes(1));
        resetActiveDownloads.mockRestore();
    });

    it('should not download focused evidence after the dialog is cancelled', async () => {
        const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
        HTMLElement.prototype.scrollIntoView = vi.fn();
        let resolveFetch: ((response: Response) => void) | undefined;
        const fetchPromise = new Promise<Response>((resolve) => {
            resolveFetch = resolve;
        });
        const fetchMock = vi.fn(() => fetchPromise);
        const downloadTextFile = vi.spyOn(download, 'downloadTextFile');
        const onOpenChange = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        try {
            render(
                <ExportDialog
                    focusedEvidenceTarget={{ id: 'thread-1', source: 'codex' }}
                    open
                    onExport={vi.fn()}
                    onOpenChange={onOpenChange}
                />,
            );
            fireEvent.click(screen.getByRole('combobox', { name: 'Output format' }));
            fireEvent.click(screen.getByText('Focused evidence (.md)'));
            fireEvent.click(screen.getByRole('button', { name: 'Download export' }));
            fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
            resolveFetch?.(
                Response.json({
                    data: {
                        markdown: '# Focused evidence\n',
                        meta: {
                            approximateTokens: 1,
                            episodeCount: 1,
                            generatedAt: '2026-07-19T12:00:00.000Z',
                            omission: {
                                budgetReached: false,
                                deduplicatedDiagnostics: 0,
                                inputCharacters: 1,
                                inputEvents: 1,
                                omittedBinaryPayloads: 0,
                                omittedEvents: 0,
                                selectedEvents: 1,
                                truncatedArrays: 0,
                                truncatedFields: 0,
                            },
                            projectedCharacters: 20,
                            rendererVersion: 'focused-evidence/v2',
                        },
                    },
                }),
            );

            await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
            expect(onOpenChange).toHaveBeenCalledWith(false);
            expect(downloadTextFile).not.toHaveBeenCalled();
        } finally {
            HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
            downloadTextFile.mockRestore();
            vi.unstubAllGlobals();
        }
    });

    it('should mark focused preparation as failed when no export result is returned', async () => {
        const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
        HTMLElement.prototype.scrollIntoView = vi.fn();
        const fetchMock = vi.fn(async () => Response.json({ error: { message: 'No evidence' } }));
        vi.stubGlobal('fetch', fetchMock);

        try {
            render(
                <ExportDialog
                    focusedEvidenceTarget={{ id: 'thread-1', source: 'codex' }}
                    open
                    onExport={vi.fn()}
                    onOpenChange={vi.fn()}
                />,
            );
            fireEvent.click(screen.getByRole('combobox', { name: 'Output format' }));
            fireEvent.click(screen.getByText('Focused evidence (.md)'));
            fireEvent.click(screen.getByRole('button', { name: 'Download export' }));

            await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Export failed.'));
        } finally {
            HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
            vi.unstubAllGlobals();
        }
    });

    it('should expose full export lifecycle updates and partial export counts', () => {
        const onExport = vi.fn((_options, lifecycle) => {
            lifecycle.onDownloadStateChange?.('ready');
        });

        render(<ExportDialog open skippedThreadCount={2} onExport={onExport} onOpenChange={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: 'Download export' }));

        expect(screen.getAllByRole('status').map((status) => status.textContent)).toContain('Export ready.');
        expect(screen.getByText('Export completed with 2 skipped threads.')).toBeTruthy();
    });

    it('should submit zip archive when selected', () => {
        const onExport = vi.fn();

        render(<ExportDialog open onExport={onExport} onOpenChange={vi.fn()} />);

        fireEvent.click(screen.getByRole('checkbox', { name: /zip archive/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Download export' }));

        expect(onExport).toHaveBeenCalledWith(
            expect.objectContaining({
                includeCommentary: false,
                includeMetadata: true,
                includeTools: true,
                outputFormat: 'md',
                zipArchive: true,
            }),
            expect.any(Object),
        );
    });

    it('should remember the ZIP password in local storage and restore it on reopen', () => {
        const onExport = vi.fn();
        const renderDialog = (open: boolean) => (
            <SettingsProvider>
                <ExportDialog open={open} onExport={onExport} onOpenChange={vi.fn()} />
            </SettingsProvider>
        );
        const { rerender } = render(renderDialog(true));

        expect(screen.queryByLabelText('ZIP password (optional)')).toBeNull();
        fireEvent.click(screen.getByRole('checkbox', { name: /zip archive/i }));
        const passwordInput = screen.getByLabelText('ZIP password (optional)') as HTMLInputElement;
        const password = '  reusable password 🔐  ';
        fireEvent.change(passwordInput, { target: { value: password } });

        expect(window.localStorage.getItem(ZIP_PASSWORD_STORAGE_KEY)).toBe(password);
        fireEvent.click(screen.getByRole('button', { name: 'Download export' }));
        expect(onExport).toHaveBeenCalledWith(
            expect.objectContaining({ zipArchive: true, zipPassword: password }),
            expect.any(Object),
        );

        rerender(renderDialog(false));
        rerender(renderDialog(true));

        expect((screen.getByLabelText('ZIP password (optional)') as HTMLInputElement).value).toBe(password);
    });

    it('should force zip archive for multi-thread exports', () => {
        const onExport = vi.fn();

        render(<ExportDialog forceZipArchive open onExport={onExport} onOpenChange={vi.fn()} />);

        const zipArchive = screen.getByRole('checkbox', { name: /zip archive/i }) as HTMLButtonElement;
        expect(zipArchive.getAttribute('aria-checked')).toBe('true');
        expect(zipArchive.disabled).toBe(true);
        expect(screen.getByText('Required when exporting multiple threads.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Download export' }));

        expect(onExport).toHaveBeenCalledWith(
            expect.objectContaining({
                includeCommentary: false,
                includeMetadata: true,
                includeTools: true,
                outputFormat: 'md',
                zipArchive: true,
            }),
            expect.any(Object),
        );
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

        expect(onExport).toHaveBeenLastCalledWith(
            expect.objectContaining({
                includeCommentary: true,
                includeMetadata: false,
                includeTools: true,
                outputFormat: 'md',
                zipArchive: true,
            }),
            expect.any(Object),
        );
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

        expect(onExport).toHaveBeenLastCalledWith(
            expect.objectContaining({
                includeCommentary: true,
                includeMetadata: true,
                includeTools: true,
                outputFormat: 'md',
                zipArchive: false,
            }),
            expect.any(Object),
        );
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

        expect(onExport).toHaveBeenLastCalledWith(
            expect.objectContaining({
                includeCommentary: false,
                includeMetadata: true,
                includeTools: true,
                outputFormat: 'md',
                zipArchive: false,
            }),
            expect.any(Object),
        );
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
        expect(onExport).toHaveBeenCalledWith(
            expect.objectContaining({
                includeCommentary: false,
                includeMetadata: true,
                includeTools: true,
                outputFormat: 'md',
                zipArchive: false,
            }),
            expect.any(Object),
        );
    });
});
