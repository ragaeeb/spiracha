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
import { downloadTextFile } from '#/lib/download';
import { requestEvidenceExport } from '#/lib/evidence-export';
import type { ExportDialogOptions } from '#/lib/export-options';
import { useSettings } from '#/lib/settings-store';
import { EvidenceLensEditor } from './evidence-lens-editor';

type ExportDialogProps = {
    disabled?: boolean;
    errorMessage?: string | null;
    forceZipArchive?: boolean;
    focusedEvidenceTarget?: { id: string; source: ConversationSource };
    open: boolean;
    pending?: boolean;
    showCommentaryOption?: boolean;
    showToolsOption?: boolean;
    title?: string;
    onExport: (options: ExportDialogOptions) => void;
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

export function ExportDialog({
    disabled = false,
    errorMessage = null,
    forceZipArchive = false,
    focusedEvidenceTarget,
    open,
    pending = false,
    showCommentaryOption = true,
    showToolsOption = true,
    title = 'Export thread',
    onExport,
    onOpenChange,
}: ExportDialogProps) {
    const { settings, updateSetting } = useSettings();
    const [options, setOptions] = useState<ExportDialogOptions>(settings.exportDefaults);
    const [submitted, setSubmitted] = useState(false);
    const [mode, setMode] = useState<'focused' | 'full'>('full');
    const [lens, setLens] = useState<EvidenceLens>(DEFAULT_EVIDENCE_LENS);
    const [preview, setPreview] = useState<ConversationEvidenceExport | null>(null);
    const [evidenceError, setEvidenceError] = useState<string | null>(null);
    const [evidencePending, setEvidencePending] = useState(false);
    const submissionInProgress = useRef(false);
    const previousPending = useRef(pending);
    const effectiveZipArchive = forceZipArchive || options.zipArchive;
    const displayedError = evidenceError ?? errorMessage;
    const zipDescriptionId = useId();

    useEffect(() => {
        if (!open) {
            setOptions(settings.exportDefaults);
            setSubmitted(false);
            submissionInProgress.current = false;
            setMode('full');
            setLens(DEFAULT_EVIDENCE_LENS);
            setPreview(null);
            setEvidenceError(null);
            setEvidencePending(false);
        }
    }, [open, settings.exportDefaults]);

    useEffect(() => {
        if ((previousPending.current && !pending) || errorMessage) {
            setSubmitted(false);
            submissionInProgress.current = false;
        }
        previousPending.current = pending;
    }, [errorMessage, pending]);

    const loadEvidence = async () => {
        if (!focusedEvidenceTarget) {
            return null;
        }
        setEvidencePending(true);
        setEvidenceError(null);
        try {
            const result = await requestEvidenceExport(focusedEvidenceTarget, lens);
            setPreview(result);
            return result;
        } catch (error) {
            setEvidenceError(error instanceof Error ? error.message : 'Focused evidence export failed.');
            return null;
        } finally {
            setEvidencePending(false);
        }
    };

    const submitExport = async () => {
        if (submissionInProgress.current) {
            return;
        }
        submissionInProgress.current = true;
        setSubmitted(true);
        if (mode === 'focused') {
            const result = preview ?? (await loadEvidence());
            if (result && focusedEvidenceTarget) {
                downloadTextFile(
                    `${focusedEvidenceTarget.source}-${focusedEvidenceTarget.id}-focused-evidence.md`,
                    result.markdown,
                    'text/markdown; charset=utf-8',
                );
            }
            submissionInProgress.current = false;
            setSubmitted(false);
            return;
        }
        updateSetting('exportDefaults', options);
        onExport({ ...options, zipArchive: effectiveZipArchive });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)] sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription className="text-[var(--muted-foreground)]">
                        Choose the transcript format and export options.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5 py-2">
                    {focusedEvidenceTarget ? (
                        <div className="space-y-2">
                            <label className="font-medium text-sm" htmlFor="export-mode">
                                Export mode
                            </label>
                            <Select
                                value={mode}
                                onValueChange={(value) => {
                                    setMode(value as 'focused' | 'full');
                                    setPreview(null);
                                    setEvidenceError(null);
                                }}
                            >
                                <SelectTrigger
                                    id="export-mode"
                                    className="border-[var(--border)] bg-[var(--panel-secondary)] text-[var(--foreground)]"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="full">Full transcript</SelectItem>
                                    <SelectItem value="focused">Focused evidence</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    ) : null}
                    {mode === 'focused' && focusedEvidenceTarget ? (
                        <EvidenceLensEditor
                            lens={lens}
                            onChange={(nextLens) => {
                                setLens(nextLens);
                                setPreview(null);
                                setEvidenceError(null);
                            }}
                        />
                    ) : (
                        <FullExportControls
                            effectiveZipArchive={effectiveZipArchive}
                            forceZipArchive={forceZipArchive}
                            options={options}
                            showCommentaryOption={showCommentaryOption}
                            showToolsOption={showToolsOption}
                            zipDescriptionId={zipDescriptionId}
                            onChange={(nextOptions) => setOptions((current) => ({ ...current, ...nextOptions }))}
                        />
                    )}
                </div>

                {preview && mode === 'focused' ? <EvidencePreview preview={preview} /> : null}
                {displayedError ? <p className="text-[var(--destructive)] text-sm">{displayedError}</p> : null}

                <DialogFooter>
                    <Button className="rounded-full" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    {mode === 'focused' ? (
                        <Button
                            className="rounded-full"
                            variant="outline"
                            disabled={evidencePending || disabled}
                            onClick={loadEvidence}
                        >
                            {evidencePending ? 'Previewing...' : 'Preview evidence'}
                        </Button>
                    ) : null}
                    <Button
                        className="rounded-full"
                        disabled={pending || evidencePending || disabled || submitted}
                        onClick={submitExport}
                    >
                        {pending || evidencePending ? 'Exporting...' : 'Download export'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
