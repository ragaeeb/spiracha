import { useEffect, useId, useState } from 'react';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '#/components/ui/alert-dialog';
import { Button } from '#/components/ui/button';
import { Checkbox } from '#/components/ui/checkbox';

type DeleteConfirmDialogProps = {
    confirmLabel?: string;
    defaultDeleteSessionFiles?: boolean;
    description: string;
    errorMessage?: string | null;
    open: boolean;
    showDeleteSessionFilesOption?: boolean;
    title: string;
    onConfirm: (options: { deleteSessionFiles: boolean }) => void;
    onOpenChange: (open: boolean) => void;
};

export function DeleteConfirmDialog({
    confirmLabel = 'Delete',
    defaultDeleteSessionFiles = false,
    description,
    errorMessage = null,
    open,
    showDeleteSessionFilesOption = false,
    title,
    onConfirm,
    onOpenChange,
}: DeleteConfirmDialogProps) {
    const checkboxId = useId();
    const checkboxDescriptionId = useId();
    const [deleteSessionFiles, setDeleteSessionFiles] = useState(defaultDeleteSessionFiles);

    useEffect(() => {
        if (!open) {
            setDeleteSessionFiles(defaultDeleteSessionFiles);
        }
    }, [defaultDeleteSessionFiles, open]);

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent className="border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)]">
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription className="text-[var(--muted-foreground)]">
                        {description}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {showDeleteSessionFilesOption ? (
                    <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--background)]/70 px-4 py-3 text-sm">
                        <Checkbox
                            aria-label="Delete Session files"
                            aria-describedby={checkboxDescriptionId}
                            checked={deleteSessionFiles}
                            id={checkboxId}
                            onCheckedChange={(checked) => setDeleteSessionFiles(checked === true)}
                        />
                        <span className="space-y-1">
                            <label className="block font-medium" htmlFor={checkboxId}>
                                Delete Session files
                            </label>
                            <span className="block text-[var(--muted-foreground)] text-xs" id={checkboxDescriptionId}>
                                Remove the rollout JSONL from disk as well, so Codex cannot backfill this thread later.
                            </span>
                        </span>
                    </div>
                ) : null}
                {errorMessage ? <p className="text-[var(--destructive)] text-sm">{errorMessage}</p> : null}
                <AlertDialogFooter>
                    <AlertDialogCancel className="border-[var(--border)]">Cancel</AlertDialogCancel>
                    <Button
                        className="bg-[var(--destructive)] text-[var(--destructive-foreground)] hover:bg-[var(--destructive)]/90"
                        type="button"
                        onClick={() => onConfirm({ deleteSessionFiles })}
                    >
                        {confirmLabel}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
