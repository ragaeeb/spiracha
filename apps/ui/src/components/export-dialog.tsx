import { useState } from 'react';
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

type ExportDialogProps = {
    forceZipArchive?: boolean;
    open: boolean;
    pending?: boolean;
    title?: string;
    onExport: (options: {
        includeCommentary: boolean;
        includeMetadata: boolean;
        includeTools: boolean;
        outputFormat: 'md' | 'txt';
        zipArchive: boolean;
    }) => void;
    onOpenChange: (open: boolean) => void;
};

export function ExportDialog({
    forceZipArchive = false,
    open,
    pending = false,
    title = 'Export thread',
    onExport,
    onOpenChange,
}: ExportDialogProps) {
    const [outputFormat, setOutputFormat] = useState<'md' | 'txt'>('md');
    const [includeMetadata, setIncludeMetadata] = useState(true);
    const [includeCommentary, setIncludeCommentary] = useState(false);
    const [includeTools, setIncludeTools] = useState(true);
    const [zipArchive, setZipArchive] = useState(false);
    const effectiveZipArchive = forceZipArchive || zipArchive;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)]">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription className="text-[var(--muted-foreground)]">
                        Choose the transcript format and whether the export includes tool calls.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5 py-2">
                    <div className="space-y-2">
                        <label className="font-medium text-sm" htmlFor="output-format">
                            Output format
                        </label>
                        <Select value={outputFormat} onValueChange={(value) => setOutputFormat(value as 'md' | 'txt')}>
                            <SelectTrigger
                                id="output-format"
                                className="border-[var(--border)] bg-[var(--panel-secondary)] text-[var(--foreground)]"
                            >
                                <SelectValue placeholder="Choose a format" />
                            </SelectTrigger>
                            <SelectContent className="border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)] shadow-[var(--panel-shadow)]">
                                <SelectItem
                                    className="focus:bg-[var(--panel-secondary)] focus:text-[var(--foreground)] data-[highlighted]:bg-[var(--panel-secondary)] data-[highlighted]:text-[var(--foreground)]"
                                    value="md"
                                >
                                    Markdown (.md)
                                </SelectItem>
                                <SelectItem
                                    className="focus:bg-[var(--panel-secondary)] focus:text-[var(--foreground)] data-[highlighted]:bg-[var(--panel-secondary)] data-[highlighted]:text-[var(--foreground)]"
                                    value="txt"
                                >
                                    Plain text (.txt)
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-secondary)] p-3">
                        <Checkbox
                            aria-label="Include metadata"
                            checked={includeMetadata}
                            onCheckedChange={(checked) => setIncludeMetadata(checked === true)}
                        />
                        <span className="space-y-1">
                            <span className="block font-medium text-sm">Include metadata</span>
                            <span className="block text-[var(--muted-foreground)] text-sm">
                                Includes the chat metadata section at the top of the exported transcript.
                            </span>
                        </span>
                    </div>

                    <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-secondary)] p-3">
                        <Checkbox
                            aria-label="Include commentary"
                            checked={includeCommentary}
                            onCheckedChange={(checked) => setIncludeCommentary(checked === true)}
                        />
                        <span className="space-y-1">
                            <span className="block font-medium text-sm">Include commentary</span>
                            <span className="block text-[var(--muted-foreground)] text-sm">
                                Includes assistant commentary-phase updates in the exported transcript.
                            </span>
                        </span>
                    </div>

                    <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-secondary)] p-3">
                        <Checkbox
                            aria-label="Include tool calls"
                            checked={includeTools}
                            onCheckedChange={(checked) => setIncludeTools(checked === true)}
                        />
                        <span className="space-y-1">
                            <span className="block font-medium text-sm">Include tool calls</span>
                            <span className="block text-[var(--muted-foreground)] text-sm">
                                Includes tool-call summaries and tool-output summaries in the export.
                            </span>
                        </span>
                    </div>

                    <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-secondary)] p-3">
                        <Checkbox
                            aria-label="Zip archive"
                            checked={effectiveZipArchive}
                            disabled={forceZipArchive}
                            onCheckedChange={(checked) => setZipArchive(checked === true)}
                        />
                        <span className="space-y-1">
                            <span className="block font-medium text-sm">Zip archive</span>
                            <span className="block text-[var(--muted-foreground)] text-sm">
                                Downloads the exported transcript inside a .zip archive.
                            </span>
                        </span>
                    </div>
                </div>

                <DialogFooter>
                    <Button className="rounded-full" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        className="rounded-full"
                        disabled={pending}
                        onClick={() =>
                            onExport({
                                includeCommentary,
                                includeMetadata,
                                includeTools,
                                outputFormat,
                                zipArchive: effectiveZipArchive,
                            })
                        }
                    >
                        {pending ? 'Exporting...' : 'Download export'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
