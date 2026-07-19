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
import type { ExportDialogOptions } from '#/lib/export-options';
import { useSettings } from '#/lib/settings-store';

type ExportDialogProps = {
    disabled?: boolean;
    errorMessage?: string | null;
    forceZipArchive?: boolean;
    open: boolean;
    pending?: boolean;
    showCommentaryOption?: boolean;
    showToolsOption?: boolean;
    title?: string;
    onExport: (options: ExportDialogOptions) => void;
    onOpenChange: (open: boolean) => void;
};

export function ExportDialog({
    disabled = false,
    errorMessage = null,
    forceZipArchive = false,
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
    const submissionInProgress = useRef(false);
    const previousPending = useRef(pending);
    const effectiveZipArchive = forceZipArchive || options.zipArchive;
    const zipDescriptionId = useId();

    useEffect(() => {
        if (!open) {
            setOptions(settings.exportDefaults);
            setSubmitted(false);
            submissionInProgress.current = false;
        }
    }, [open, settings.exportDefaults]);

    useEffect(() => {
        if ((previousPending.current && !pending) || errorMessage) {
            setSubmitted(false);
            submissionInProgress.current = false;
        }
        previousPending.current = pending;
    }, [errorMessage, pending]);

    const updateOption = <K extends keyof ExportDialogOptions>(key: K, value: ExportDialogOptions[K]) => {
        setOptions((current) => ({ ...current, [key]: value }));
    };

    const submitExport = () => {
        if (submissionInProgress.current) {
            return;
        }
        submissionInProgress.current = true;
        setSubmitted(true);
        updateSetting('exportDefaults', options);
        onExport({ ...options, zipArchive: effectiveZipArchive });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)]">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription className="text-[var(--muted-foreground)]">
                        Choose the transcript format and export options.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5 py-2">
                    <div className="space-y-2">
                        <label className="font-medium text-sm" htmlFor="output-format">
                            Output format
                        </label>
                        <Select
                            value={options.outputFormat}
                            onValueChange={(value) => updateOption('outputFormat', value as 'md' | 'txt')}
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
                            onCheckedChange={(checked) => updateOption('includeMetadata', checked === true)}
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
                                onCheckedChange={(checked) => updateOption('includeCommentary', checked === true)}
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
                                onCheckedChange={(checked) => updateOption('includeTools', checked === true)}
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
                            onCheckedChange={(checked) => updateOption('zipArchive', checked === true)}
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
                </div>

                {errorMessage ? <p className="text-[var(--destructive)] text-sm">{errorMessage}</p> : null}

                <DialogFooter>
                    <Button className="rounded-full" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button className="rounded-full" disabled={pending || disabled || submitted} onClick={submitExport}>
                        {pending ? 'Exporting...' : 'Download export'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
