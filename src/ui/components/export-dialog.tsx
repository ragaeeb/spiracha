import { DEFAULT_EVIDENCE_LENS } from '@spiracha/lib/conversation-data/evidence-lens';
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
    downloadTextFile,
    downloadUrlFileWithCancellation,
    resetActiveDownloads,
    useDownloadCancellation,
} from '#/lib/download';
import { requestEvidenceExport } from '#/lib/evidence-export';
import type { ExportDialogOptions, ExportLifecycleCallbacks } from '#/lib/export-options';
import { useSettings } from '#/lib/settings-store';
import { EvidenceLensEditor } from './evidence-lens-editor';

type ExportDialogProps = {
    disabled?: boolean;
    errorMessage?: string | null;
    forceZipArchive?: boolean;
    focusedEvidenceTarget?: { id: string; source: ConversationSource };
    open: boolean;
    pending?: boolean;
    skippedThreadCount?: number;
    showCommentaryOption?: boolean;
    showToolsOption?: boolean;
    title?: string;
    onExport: (options: ExportDialogOptions, callbacks: ExportLifecycleCallbacks) => void;
    onOpenChange: (open: boolean) => void;
};

type FullExportControlsProps = {
    effectiveZipArchive: boolean;
    forceZipArchive: boolean;
    options: ExportDialogOptions;
    showCommentaryOption: boolean;
    showToolsOption: boolean;
    zipDescriptionId: string;
    onChange: (options: Partial<ExportDialogOptions>) => void;
};

const FullExportControls = ({
    effectiveZipArchive,
    forceZipArchive,
    options,
    showCommentaryOption,
    showToolsOption,
    zipDescriptionId,
    onChange,
}: FullExportControlsProps) => (
    <>
        <div className="space-y-2">
            <label className="font-medium text-sm" htmlFor="output-format">
                Output format
            </label>
            <Select
                value={options.outputFormat}
                onValueChange={(value) => onChange({ outputFormat: value as 'md' | 'txt' })}
            >
                <SelectTrigger
                    id="output-format"
                    className="border-[var(--border)] bg-[var(--panel-secondary)] text-[var(--foreground)]"
                >
                    <SelectValue placeholder="Choose a format" />
                </SelectTrigger>
                <SelectContent className="border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)] shadow-[var(--panel-shadow)]">
                    <SelectItem value="md">Markdown (.md)</SelectItem>
                    <SelectItem value="txt">Plain text (.txt)</SelectItem>
                </SelectContent>
            </Select>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-secondary)] p-3">
            <Checkbox
                aria-label="Include metadata"
                checked={options.includeMetadata}
                onCheckedChange={(checked) => onChange({ includeMetadata: checked === true })}
            />
            <span className="space-y-1">
                <span className="block font-medium text-sm">Include metadata</span>
                <span className="block text-[var(--muted-foreground)] text-sm">
                    Includes the chat metadata section at the top of the exported transcript.
                </span>
            </span>
        </div>
        {showCommentaryOption ? (
            <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-secondary)] p-3">
                <Checkbox
                    aria-label="Include commentary"
                    checked={options.includeCommentary}
                    onCheckedChange={(checked) => onChange({ includeCommentary: checked === true })}
                />
                <span className="space-y-1">
                    <span className="block font-medium text-sm">Include commentary</span>
                    <span className="block text-[var(--muted-foreground)] text-sm">
                        Includes assistant commentary-phase updates in the exported transcript.
                    </span>
                </span>
            </div>
        ) : null}
        {showToolsOption ? (
            <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-secondary)] p-3">
                <Checkbox
                    aria-label="Include tool calls"
                    checked={options.includeTools}
                    onCheckedChange={(checked) => onChange({ includeTools: checked === true })}
                />
                <span className="space-y-1">
                    <span className="block font-medium text-sm">Include tool calls</span>
                    <span className="block text-[var(--muted-foreground)] text-sm">
                        Includes tool-call summaries and tool-output summaries in the export.
                    </span>
                </span>
            </div>
        ) : null}
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-secondary)] p-3">
            <Checkbox
                aria-label="Zip archive"
                aria-describedby={zipDescriptionId}
                checked={effectiveZipArchive}
                disabled={forceZipArchive}
                onCheckedChange={(checked) => onChange({ zipArchive: checked === true })}
            />
            <span className="space-y-1">
                <span className="block font-medium text-sm">Zip archive</span>
                <span className="block text-[var(--muted-foreground)] text-sm" id={zipDescriptionId}>
                    {forceZipArchive
                        ? 'Required when exporting multiple threads.'
                        : 'Downloads the exported transcript inside a .zip archive.'}
                </span>
            </span>
        </div>
    </>
);

const EvidencePreview = ({ preview }: { preview: ConversationEvidenceExport }) => (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-secondary)] p-3 text-sm">
        Preview: {preview.meta.omission.inputEvents} inspected events, {preview.meta.episodeCount} episodes,{' '}
        {preview.meta.projectedCharacters} characters (~{preview.meta.approximateTokens} tokens),{' '}
        {preview.meta.omission.omittedEvents} omissions.
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

type ExportModeContentProps = {
    effectiveZipArchive: boolean;
    focusedEvidenceTarget?: { id: string; source: ConversationSource };
    forceZipArchive: boolean;
    lens: EvidenceLens;
    mode: ExportMode;
    options: ExportDialogOptions;
    preview: ConversationEvidenceExport | null;
    showCommentaryOption: boolean;
    showToolsOption: boolean;
    zipDescriptionId: string;
    onLensChange: (lens: EvidenceLens) => void;
    onModeChange: (mode: ExportMode) => void;
    onOptionsChange: (options: Partial<ExportDialogOptions>) => void;
};

const ExportModeContent = ({
    effectiveZipArchive,
    focusedEvidenceTarget,
    forceZipArchive,
    lens,
    mode,
    options,
    preview,
    showCommentaryOption,
    showToolsOption,
    zipDescriptionId,
    onLensChange,
    onModeChange,
    onOptionsChange,
}: ExportModeContentProps) => (
    <>
        {focusedEvidenceTarget ? (
            <div className="space-y-2">
                <label className="font-medium text-sm" htmlFor="export-mode">
                    Export mode
                </label>
                <Select value={mode} onValueChange={(value) => onModeChange(value as ExportMode)}>
                    <SelectTrigger
                        id="export-mode"
                        className="border-[var(--border)] bg-[var(--panel-secondary)] text-[var(--foreground)]"
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="full">Full transcript</SelectItem>
                        <SelectItem value="focused">Focused evidence</SelectItem>
                        {RAW_EXPORT_SOURCES.has(focusedEvidenceTarget.source) ? (
                            <SelectItem value="raw">Raw source JSON</SelectItem>
                        ) : null}
                    </SelectContent>
                </Select>
            </div>
        ) : null}
        {mode === 'focused' && focusedEvidenceTarget ? (
            <EvidenceLensEditor lens={lens} onChange={onLensChange} />
        ) : mode === 'raw' ? (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--panel-secondary)] p-3 text-sm">
                Downloads the source transcript unchanged, without filtering or Markdown rendering.
            </p>
        ) : (
            <FullExportControls
                effectiveZipArchive={effectiveZipArchive}
                forceZipArchive={forceZipArchive}
                options={options}
                showCommentaryOption={showCommentaryOption}
                showToolsOption={showToolsOption}
                zipDescriptionId={zipDescriptionId}
                onChange={onOptionsChange}
            />
        )}
        {preview && mode === 'focused' ? <EvidencePreview preview={preview} /> : null}
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
    mode: ExportMode;
    pending: boolean;
    submitted: boolean;
    onCancel: () => void;
    onPreview: () => void;
    onSubmit: () => void;
};

type ExportMode = 'focused' | 'full' | 'raw';

const RAW_EXPORT_SOURCES = new Set<ConversationSource>([
    'antigravity',
    'claude-code',
    'cline',
    'codex',
    'grok',
    'kiro',
    'minimax-code',
    'qoder',
]);

const ExportDialogFooter = ({
    disabled,
    evidencePending,
    mode,
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
        {mode === 'focused' ? (
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
    pending = false,
    skippedThreadCount = 0,
    showCommentaryOption = true,
    showToolsOption = true,
    title = 'Export thread',
    onExport,
    onOpenChange,
}: ExportDialogProps) {
    const { settings, updateSetting } = useSettings();
    const [options, setOptions] = useState<ExportDialogOptions>(settings.exportDefaults);
    const [submitted, setSubmitted] = useState(false);
    const [mode, setMode] = useState<ExportMode>('full');
    const [lens, setLens] = useState<EvidenceLens>(DEFAULT_EVIDENCE_LENS);
    const [preview, setPreview] = useState<ConversationEvidenceExport | null>(null);
    const [exportError, setExportError] = useState<string | null>(null);
    const [evidencePending, setEvidencePending] = useState(false);
    const [downloadState, setDownloadState] = useState<DownloadLifecycleState | null>(null);
    const submissionInProgress = useRef(false);
    const submissionToken = useRef(0);
    const previousPending = useRef(pending);
    const effectiveZipArchive = forceZipArchive || options.zipArchive;
    const displayedError = exportError ?? errorMessage;
    const downloadCancellation = useDownloadCancellation();
    const zipDescriptionId = useId();
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
            setOptions(settings.exportDefaults);
            setSubmitted(false);
            submissionInProgress.current = false;
            setMode('full');
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

    const submitExport = async () => {
        if (submissionInProgress.current) {
            return;
        }
        submissionInProgress.current = true;
        const token = submissionToken.current + 1;
        submissionToken.current = token;
        setSubmitted(true);
        setDownloadState('preparing');
        if (mode === 'focused') {
            await submitFocusedExport(token);
            return;
        }
        if (mode === 'raw' && focusedEvidenceTarget) {
            const { id, source } = focusedEvidenceTarget;
            try {
                await downloadUrlFileWithCancellation(
                    downloadCancellation,
                    `${source}-${id}.jsonl`,
                    `/api/v1/conversations/${source}/${encodeURIComponent(id)}/raw`,
                    { onStateChange: setDownloadState },
                );
            } catch (error) {
                setExportError(error instanceof Error ? error.message : 'Raw transcript export failed.');
            } finally {
                submissionInProgress.current = false;
                setSubmitted(false);
            }
            return;
        }
        updateSetting('exportDefaults', options);
        onExport({ ...options, zipArchive: effectiveZipArchive }, { onDownloadStateChange: setDownloadState });
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
                    <ExportModeContent
                        effectiveZipArchive={effectiveZipArchive}
                        focusedEvidenceTarget={focusedEvidenceTarget}
                        forceZipArchive={forceZipArchive}
                        lens={lens}
                        mode={mode}
                        options={options}
                        preview={preview}
                        showCommentaryOption={showCommentaryOption}
                        showToolsOption={showToolsOption}
                        zipDescriptionId={zipDescriptionId}
                        onLensChange={(nextLens) => {
                            setLens(nextLens);
                            setPreview(null);
                            setExportError(null);
                        }}
                        onModeChange={(nextMode) => {
                            setMode(nextMode);
                            setPreview(null);
                            setExportError(null);
                        }}
                        onOptionsChange={(nextOptions) => setOptions((current) => ({ ...current, ...nextOptions }))}
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
                    mode={mode}
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
