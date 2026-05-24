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
    open: boolean;
    pending?: boolean;
    title?: string;
    onExport: (options: {
        includeCommentary: boolean;
        includeTools: boolean;
        optimized: boolean;
        outputFormat: 'md' | 'txt';
    }) => void;
    onOpenChange: (open: boolean) => void;
};

export function ExportDialog({
    open,
    pending = false,
    title = 'Export thread',
    onExport,
    onOpenChange,
}: ExportDialogProps) {
    const [outputFormat, setOutputFormat] = useState<'md' | 'txt'>('md');
    const [optimized, setOptimized] = useState(false);
    const [includeCommentary, setIncludeCommentary] = useState(false);
    const [includeTools, setIncludeTools] = useState(true);

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
                                className="border-[var(--border)] bg-[var(--panel-secondary)]"
                            >
                                <SelectValue placeholder="Choose a format" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="md">Markdown (.md)</SelectItem>
                                <SelectItem value="txt">Plain text (.txt)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-secondary)] p-3">
                        <Checkbox checked={optimized} onCheckedChange={(checked) => setOptimized(checked === true)} />
                        <span className="space-y-1">
                            <span className="block font-medium text-sm">Optimized transcript</span>
                            <span className="block text-[var(--muted-foreground)] text-sm">
                                Removes metadata and condenses the transcript for readability and token efficiency.
                            </span>
                        </span>
                    </div>

                    <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-secondary)] p-3">
                        <Checkbox
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
                </div>

                <DialogFooter>
                    <Button className="rounded-full" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        className="rounded-full"
                        disabled={pending}
                        onClick={() => onExport({ includeCommentary, includeTools, optimized, outputFormat })}
                    >
                        {pending ? 'Exporting...' : 'Download export'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
