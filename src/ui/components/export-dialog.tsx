import { DEFAULT_EVIDENCE_LENS } from '@spiracha/lib/conversation-data/evidence-lens';
import { isSupportedOriginalRawSource } from '@spiracha/lib/conversation-data/source-catalog';
import type {
    ConversationEvidenceExport,
    ConversationSource,
    EvidenceLens,
} from '@spiracha/lib/conversation-data/types';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '#/components/ui/button';
import { Checkbox } from '#/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '#/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/components/ui/select';
import {
    cancelActiveDownloads,
    type DownloadLifecycleState,
    downloadRawBase64File,
    downloadTextFile,
    downloadUrlFileWithCancellation,
    resetActiveDownloads,
    useDownloadCancellation,
} from '#/lib/download';
import { requestEvidenceExport } from '#/lib/evidence-export';
import {
    type ExportDialogOptions,
    type ExportDraftOptions,
    type ExportLifecycleCallbacks,
    type RawJsonExportOptions,
    readStoredZipPassword,
    storeZipPassword,
} from '#/lib/export-options';
import { useSettings } from '#/lib/settings-store';
import { exportRawConversationsFn } from '#/lib/source-raw-export-server';
import { EvidenceLensEditor } from './evidence-lens-editor';

type ExportDialogProps = {
    disabled?: boolean;
    errorMessage?: string | null;
    forceZipArchive?: boolean;
    focusedEvidenceTarget?: { id: string; source: ConversationSource };
    open: boolean;
    onRawJsonExport?: (options: RawJsonExportOptions, callbacks: ExportLifecycleCallbacks) => void;
    pending?: boolean;
    rawExport?: { ids: readonly string[]; source: ConversationSource };
    skippedThreadCount?: number;
    showCommentaryOption?: boolean;
    showRawJsonOption?: boolean;
    showToolsOption?: boolean;
    title?: string;
    onExport: (options: ExportDialogOptions, callbacks: ExportLifecycleCallbacks) => void;
    onOpenChange: (open: boolean) => void;
};

type ExportFormat = 'focused' | 'json' | 'md' | 'txt';

type FormatAvailability = { focused: boolean; json: boolean };

// The default depends on what the current props support, so it is resolved on every render rather than stored.
const resolveExportFormat = (chosen: ExportFormat | null, available: FormatAvailability): ExportFormat => {
    const candidate = chosen ?? (available.json ? 'json' : 'md');
    if ((candidate === 'json' && !available.json) || (candidate === 'focused' && !available.focused)) {
        return 'md';
    }

    return candidate;
};

type OutputFormatSelectProps = {
    available: FormatAvailability;
    format: ExportFormat;
    onChange: (format: ExportFormat) => void;
};

const OutputFormatSelect = ({ available, format, onChange }: OutputFormatSelectProps) => (
    <div className="space-y-2">
        <label className="font-medium text-sm" htmlFor="output-format">
            Output format
        </label>
        <Select value={format} onValueChange={(value) => onChange(value as ExportFormat)}>
            <SelectTrigger
                id="output-format"
                className="border-[var(--border)] bg-[var(--panel-secondary)] text-[var(--foreground)]"
            >
                <SelectValue placeholder="Choose a format" />
            </SelectTrigger>
            <SelectContent className="border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)] shadow-[var(--panel-shadow)]">
                {available.json ? <SelectItem value="json">JSON (original transcript)</SelectItem> : null}
                <SelectItem value="md">Markdown (.md)</SelectItem>
                <SelectItem value="txt">Plain text (.txt)</SelectItem>
                {available.focused ? <SelectItem value="focused">Focused evidence (.md)</SelectItem> : null}
            </SelectContent>
        </Select>
    </div>
);

type IncludeOptionProps = {
    checked: boolean;
    description: string;
    disabled: boolean;
    label: string;
    onCheckedChange: (checked: boolean) => void;
};

const IncludeOption = ({ checked, description, disabled, label, onCheckedChange }: IncludeOptionProps) => (
    <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-secondary)] p-3">
        <Checkbox
            aria-label={label}
            checked={checked}
            disabled={disabled}
            onCheckedChange={(next) => onCheckedChange(next === true)}
        />
        <span className="space-y-1">
            <span className="block font-medium text-sm">{label}</span>
            <span className="block text-[var(--muted-foreground)] text-sm">{description}</span>
        </span>
    </div>
);

type ZipControlsProps = {
    effectiveZipArchive: boolean;
    options: ExportDraftOptions;
    zipDescriptionId: string;
    zipRequired: boolean;
    onChange: (options: Partial<ExportDraftOptions>) => void;
};

const ZipControls = ({ effectiveZipArchive, options, zipDescriptionId, zipRequired, onChange }: ZipControlsProps) => (
    <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-secondary)] p-3">
        <div className="flex items-start gap-3">
            <Checkbox
                aria-label="Zip archive"
                aria-describedby={zipDescriptionId}
                checked={effectiveZipArchive}
                disabled={zipRequired}
                onCheckedChange={(checked) => onChange({ zipArchive: checked === true })}
            />
            <span className="space-y-1">
                <span className="block font-medium text-sm">Zip archive</span>
                <span className="block text-[var(--muted-foreground)] text-sm" id={zipDescriptionId}>
                    {zipRequired
                        ? 'Required when exporting multiple threads.'
                        : 'Downloads the exported transcript inside a .zip archive.'}
                </span>
            </span>
        </div>
        {effectiveZipArchive ? (
            <div className="space-y-2 pl-7">
                <label className="font-medium text-sm" htmlFor="zip-password">
                    ZIP password (optional)
                </label>
                <input
                    autoComplete="new-password"
                    className="flex h-9 w-full rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[var(--foreground)] text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    id="zip-password"
                    onChange={(event) => onChange({ zipPassword: event.target.value })}
                    type="password"
                    value={options.zipPassword}
                />
                <p className="text-[var(--muted-foreground)] text-sm">
                    Uses AES-256 encryption. Leave blank for an unprotected archive.
                </p>
            </div>
        ) : null}
    </div>
);

type TranscriptOptionsProps = {
    effectiveZipArchive: boolean;
    format: ExportFormat;
    options: ExportDraftOptions;
    showCommentaryOption: boolean;
    showToolsOption: boolean;
    zipDescriptionId: string;
    zipRequired: boolean;
    onChange: (options: Partial<ExportDraftOptions>) => void;
};

// The original JSON always carries metadata, commentary and tool calls, so those options are shown on and fixed.
const TranscriptOptions = ({
    effectiveZipArchive,
    format,
    options,
    showCommentaryOption,
    showToolsOption,
    zipDescriptionId,
    zipRequired,
    onChange,
}: TranscriptOptionsProps) => {
    const isJson = format === 'json';

    return (
        <>
            {isJson ? (
                <p className="rounded-xl border border-[var(--border)] bg-[var(--panel-secondary)] p-3 text-sm">
                    Downloads the source transcript unchanged, without filtering or Markdown rendering. Metadata,
                    commentary and tool calls are always included.
                </p>
            ) : null}
            <IncludeOption
                checked={isJson || options.includeMetadata}
                description="Includes the chat metadata section at the top of the exported transcript."
                disabled={isJson}
                label="Include metadata"
                onCheckedChange={(includeMetadata) => onChange({ includeMetadata })}
            />
            {showCommentaryOption ? (
                <IncludeOption
                    checked={isJson || options.includeCommentary}
                    description="Includes assistant commentary-phase updates in the exported transcript."
                    disabled={isJson}
                    label="Include commentary"
                    onCheckedChange={(includeCommentary) => onChange({ includeCommentary })}
                />
            ) : null}
            {showToolsOption ? (
                <IncludeOption
                    checked={isJson || options.includeTools}
                    description="Includes tool-call summaries and tool-output summaries in the export."
                    disabled={isJson}
                    label="Include tool calls"
                    onCheckedChange={(includeTools) => onChange({ includeTools })}
                />
            ) : null}
            <ZipControls
                effectiveZipArchive={effectiveZipArchive}
                options={options}
                zipDescriptionId={zipDescriptionId}
                zipRequired={zipRequired}
                onChange={onChange}
            />
        </>
    );
};

const EvidencePreview = ({ preview }: { preview: ConversationEvidenceExport }) => (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-secondary)] p-3 text-sm">
        Preview: {preview.meta.omission.inputEvents} inspected events, {preview.meta.episodeCount} episodes,{' '}
        {preview.meta.projectedCharacters} characters (~{preview.meta.approximateTokens} tokens),{' '}
        {preview.meta.omission.omittedEvents} omissions.
        {preview.meta.omission.renderedEvents !== undefined ? (
            <p>
                {preview.meta.omission.renderedEvents} rendered bodies; {preview.meta.omission.renderedMatchedEvents} of{' '}
                {preview.meta.omission.matchedEvents} matching events rendered.
            </p>
        ) : null}
        {preview.meta.omission.candidateLimitReached ? (
            <p>Selection limit reached. Opening and recent evidence were prioritized.</p>
        ) : null}
        {preview.meta.omission.budgetReached || preview.meta.omission.sectionBudgetReached ? (
            <p>Some evidence did not fit. Narrow the lens or increase its budgets.</p>
        ) : null}
    </div>
);

const getDownloadStateMessage = (state: DownloadLifecycleState) => {
    switch (state) {
        case 'preparing':
            return 'Preparing export...';
        case 'ready':
            return 'Export ready.';
        case 'downloading':
            return 'Starting download...';
        case 'cancelled':
            return 'Export cancelled.';
        case 'failed':
            return 'Export failed.';
    }
};

const DownloadStateMessage = ({ state }: { state: DownloadLifecycleState | null }) =>
    state ? (
        <p aria-live="polite" className="text-[var(--muted-foreground)] text-sm" role="status">
            {getDownloadStateMessage(state)}
        </p>
    ) : null;

type ExportContentProps = {
    available: FormatAvailability;
    effectiveZipArchive: boolean;
    focusedEvidenceTarget?: { id: string; source: ConversationSource };
    format: ExportFormat;
    lens: EvidenceLens;
    options: ExportDraftOptions;
    preview: ConversationEvidenceExport | null;
    showCommentaryOption: boolean;
    showToolsOption: boolean;
    zipDescriptionId: string;
    zipRequired: boolean;
    onFormatChange: (format: ExportFormat) => void;
    onLensChange: (lens: EvidenceLens) => void;
    onOptionsChange: (options: Partial<ExportDraftOptions>) => void;
};

const ExportContent = ({
    available,
    effectiveZipArchive,
    focusedEvidenceTarget,
    format,
    lens,
    options,
    preview,
    showCommentaryOption,
    showToolsOption,
    zipDescriptionId,
    zipRequired,
    onFormatChange,
    onLensChange,
    onOptionsChange,
}: ExportContentProps) => (
    <>
        <OutputFormatSelect available={available} format={format} onChange={onFormatChange} />
        {format === 'focused' && focusedEvidenceTarget ? (
            <EvidenceLensEditor lens={lens} onChange={onLensChange} />
        ) : (
            <TranscriptOptions
                effectiveZipArchive={effectiveZipArchive}
                format={format}
                options={options}
                showCommentaryOption={showCommentaryOption}
                showToolsOption={showToolsOption}
                zipDescriptionId={zipDescriptionId}
                zipRequired={zipRequired}
                onChange={onOptionsChange}
            />
        )}
        {preview && format === 'focused' ? <EvidencePreview preview={preview} /> : null}
    </>
);

type ExportDialogStatusProps = {
    displayedError: string | null;
    downloadState: DownloadLifecycleState | null;
    skippedThreadCount: number;
};

const ExportDialogStatus = ({ displayedError, downloadState, skippedThreadCount }: ExportDialogStatusProps) => (
    <>
        <DownloadStateMessage state={downloadState} />
        {skippedThreadCount > 0 ? (
            <p aria-live="polite" className="text-[var(--muted-foreground)] text-sm" role="status">
                Export completed with {skippedThreadCount} skipped {skippedThreadCount === 1 ? 'thread' : 'threads'}.
            </p>
        ) : null}
        {displayedError ? <p className="text-[var(--destructive)] text-sm">{displayedError}</p> : null}
    </>
);

type ExportDialogFooterProps = {
    disabled: boolean;
    evidencePending: boolean;
    format: ExportFormat;
    pending: boolean;
    submitted: boolean;
    onCancel: () => void;
    onPreview: () => void;
    onSubmit: () => void;
};

const ExportDialogFooter = ({
    disabled,
    evidencePending,
    format,
    pending,
    submitted,
    onCancel,
    onPreview,
    onSubmit,
}: ExportDialogFooterProps) => (
    <DialogFooter>
        <Button className="rounded-full" variant="outline" onClick={onCancel}>
            Cancel
        </Button>
        {format === 'focused' ? (
            <Button
                className="rounded-full"
                variant="outline"
                disabled={evidencePending || disabled}
                onClick={onPreview}
            >
                {evidencePending ? 'Previewing...' : 'Preview evidence'}
            </Button>
        ) : null}
        <Button
            className="rounded-full"
            disabled={pending || evidencePending || disabled || submitted}
            onClick={onSubmit}
        >
            {pending || evidencePending ? 'Exporting...' : 'Download export'}
        </Button>
    </DialogFooter>
);

export function ExportDialog({
    disabled = false,
    errorMessage = null,
    forceZipArchive = false,
    focusedEvidenceTarget,
    open,
    onRawJsonExport,
    pending = false,
    rawExport,
    skippedThreadCount = 0,
    showCommentaryOption = true,
    showRawJsonOption = false,
    showToolsOption = true,
    title = 'Export thread',
    onExport,
    onOpenChange,
}: ExportDialogProps) {
    const { settings, updateSetting } = useSettings();
    const [options, setOptions] = useState<ExportDraftOptions>(() => ({
        ...settings.exportDefaults,
        zipPassword: readStoredZipPassword(),
    }));
    const [submitted, setSubmitted] = useState(false);
    const [chosenFormat, setChosenFormat] = useState<ExportFormat | null>(null);
    const [lens, setLens] = useState<EvidenceLens>(DEFAULT_EVIDENCE_LENS);
    const [preview, setPreview] = useState<ConversationEvidenceExport | null>(null);
    const [exportError, setExportError] = useState<string | null>(null);
    const [evidencePending, setEvidencePending] = useState(false);
    const [downloadState, setDownloadState] = useState<DownloadLifecycleState | null>(null);
    const submissionInProgress = useRef(false);
    const submissionToken = useRef(0);
    const previousPending = useRef(pending);
    const displayedError = exportError ?? errorMessage;
    const downloadCancellation = useDownloadCancellation();
    const zipDescriptionId = useId();
    const hasRawJsonExport =
        rawExport !== undefined && rawExport.ids.length > 0 && isSupportedOriginalRawSource(rawExport.source);
    const available: FormatAvailability = {
        focused: focusedEvidenceTarget !== undefined,
        json:
            showRawJsonOption ||
            hasRawJsonExport ||
            (focusedEvidenceTarget !== undefined && isSupportedOriginalRawSource(focusedEvidenceTarget.source)),
    };
    const format = resolveExportFormat(chosenFormat, available);
    const jsonTargetCount = focusedEvidenceTarget ? 1 : (rawExport?.ids.length ?? 1);
    const zipRequired = forceZipArchive || (format === 'json' && jsonTargetCount > 1);
    const effectiveZipArchive = zipRequired || options.zipArchive;
    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen) {
            submissionToken.current += 1;
            cancelActiveDownloads();
        }
        onOpenChange(nextOpen);
    };

    useEffect(() => {
        if (open) {
            resetActiveDownloads();
        }
    }, [open]);

    useEffect(() => {
        if (!open) {
            submissionToken.current += 1;
            setOptions({
                ...settings.exportDefaults,
                zipPassword: readStoredZipPassword(),
            });
            setSubmitted(false);
            submissionInProgress.current = false;
            setChosenFormat(null);
            setLens(DEFAULT_EVIDENCE_LENS);
            setPreview(null);
            setExportError(null);
            setEvidencePending(false);
            setDownloadState(null);
        }
    }, [open, settings.exportDefaults]);

    useEffect(() => {
        if ((previousPending.current && !pending) || errorMessage) {
            setSubmitted(false);
            submissionInProgress.current = false;
            setDownloadState(errorMessage ? 'failed' : null);
        }
        previousPending.current = pending;
    }, [errorMessage, pending]);

    const loadEvidence = async () => {
        if (!focusedEvidenceTarget) {
            return null;
        }
        setEvidencePending(true);
        setExportError(null);
        try {
            const result = await requestEvidenceExport(focusedEvidenceTarget, lens);
            setPreview(result);
            return result;
        } catch (error) {
            setExportError(error instanceof Error ? error.message : 'Focused evidence export failed.');
            return null;
        } finally {
            setEvidencePending(false);
        }
    };

    const submitFocusedExport = async (token: number) => {
        const result = preview ?? (await loadEvidence());
        if (submissionToken.current !== token) {
            return;
        }
        if (!result || !focusedEvidenceTarget) {
            setDownloadState('failed');
            submissionInProgress.current = false;
            setSubmitted(false);
            return;
        }
        if (submissionToken.current !== token) {
            return;
        }
        downloadTextFile(
            `${focusedEvidenceTarget.source}-${focusedEvidenceTarget.id}-focused-evidence.md`,
            result.markdown,
            'text/markdown; charset=utf-8',
            { onStateChange: setDownloadState },
        );
        submissionInProgress.current = false;
        setSubmitted(false);
    };

    const submitBulkRawExport = async () => {
        const target = focusedEvidenceTarget
            ? { ids: [focusedEvidenceTarget.id], source: focusedEvidenceTarget.source }
            : rawExport;
        try {
            if (!target || target.ids.length === 0 || !isSupportedOriginalRawSource(target.source)) {
                throw new Error('Original raw export is unavailable for this selection.');
            }
            const download = await exportRawConversationsFn({
                data: {
                    ids: [...target.ids],
                    source: target.source,
                    zipArchive: effectiveZipArchive,
                    zipPassword: effectiveZipArchive ? options.zipPassword : '',
                },
            });
            if (download.mode === 'download_base64') {
                downloadRawBase64File(download.fileName, download.contentBase64, download.mimeType, {
                    onStateChange: setDownloadState,
                });
            } else {
                await downloadUrlFileWithCancellation(downloadCancellation, download.fileName, download.downloadUrl, {
                    onStateChange: setDownloadState,
                });
            }
        } catch (error) {
            setExportError(error instanceof Error ? error.message : 'Raw transcript export failed.');
        } finally {
            submissionInProgress.current = false;
            setSubmitted(false);
        }
    };

    const submitRawExport = async () => {
        if (focusedEvidenceTarget || hasRawJsonExport) {
            await submitBulkRawExport();
            return;
        }

        if (onRawJsonExport) {
            onRawJsonExport(
                {
                    zipArchive: effectiveZipArchive,
                    zipPassword: effectiveZipArchive ? options.zipPassword : '',
                },
                { onDownloadStateChange: setDownloadState },
            );
            return;
        }

        setExportError('Raw JSON export is unavailable.');
        setDownloadState('failed');
        submissionInProgress.current = false;
        setSubmitted(false);
    };

    const submitExport = async () => {
        if (submissionInProgress.current) {
            return;
        }
        submissionInProgress.current = true;
        const token = submissionToken.current + 1;
        submissionToken.current = token;
        setSubmitted(true);
        setDownloadState('preparing');
        if (format === 'focused') {
            await submitFocusedExport(token);
            return;
        }
        updateSetting('exportDefaults', {
            includeCommentary: options.includeCommentary,
            includeMetadata: options.includeMetadata,
            includeTools: options.includeTools,
            zipArchive: options.zipArchive,
        });
        if (format === 'json') {
            await submitRawExport();
            return;
        }
        onExport(
            { ...options, outputFormat: format, zipArchive: effectiveZipArchive },
            { onDownloadStateChange: setDownloadState },
        );
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)] sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription className="text-[var(--muted-foreground)]">
                        Choose the transcript format and export options.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5 py-2">
                    <ExportContent
                        available={available}
                        effectiveZipArchive={effectiveZipArchive}
                        focusedEvidenceTarget={focusedEvidenceTarget}
                        format={format}
                        lens={lens}
                        options={options}
                        preview={preview}
                        showCommentaryOption={showCommentaryOption}
                        showToolsOption={showToolsOption}
                        zipDescriptionId={zipDescriptionId}
                        zipRequired={zipRequired}
                        onFormatChange={(nextFormat) => {
                            setChosenFormat(nextFormat);
                            setPreview(null);
                            setExportError(null);
                        }}
                        onLensChange={(nextLens) => {
                            setLens(nextLens);
                            setPreview(null);
                            setExportError(null);
                        }}
                        onOptionsChange={(nextOptions) => {
                            if (nextOptions.zipPassword !== undefined) {
                                storeZipPassword(nextOptions.zipPassword);
                            }
                            setOptions((current) => ({ ...current, ...nextOptions }));
                        }}
                    />
                </div>

                <ExportDialogStatus
                    displayedError={displayedError}
                    downloadState={downloadState}
                    skippedThreadCount={skippedThreadCount}
                />
                <ExportDialogFooter
                    disabled={disabled}
                    evidencePending={evidencePending}
                    format={format}
                    pending={pending}
                    submitted={submitted}
                    onCancel={() => handleOpenChange(false)}
                    onPreview={loadEvidence}
                    onSubmit={submitExport}
                />
            </DialogContent>
        </Dialog>
    );
}
