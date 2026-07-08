import { Download, Trash2, X } from 'lucide-react';
import { Button } from '#/components/ui/button';

type SelectionActionsToolbarProps = {
    clearSelection: () => void;
    deleteDisabled?: boolean;
    exportDisabled?: boolean;
    itemLabel: string;
    onDeleteSelected?: () => void;
    onExportSelected?: () => void;
    selectedCount: number;
};

const pluralize = (count: number, itemLabel: string) => `${itemLabel}${count === 1 ? '' : 's'}`;

export const SelectionActionsToolbar = ({
    clearSelection,
    deleteDisabled = false,
    exportDisabled = false,
    itemLabel,
    onDeleteSelected,
    onExportSelected,
    selectedCount,
}: SelectionActionsToolbarProps) => {
    if (selectedCount === 0) {
        const actions = [onExportSelected ? 'export' : null, onDeleteSelected ? 'delete' : null].filter(Boolean);
        const actionText =
            actions.length === 2 ? `${actions[0]} or ${actions[1]} them in a batch` : `${actions[0]} them in a batch`;

        return (
            <p className="text-[var(--muted-foreground)] text-sm">
                Select {pluralize(2, itemLabel)} to {actionText}.
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
                {selectedCount} {pluralize(selectedCount, itemLabel)} selected
            </p>
            <div className="flex flex-wrap gap-2">
                {onExportSelected ? (
                    <Button
                        className="rounded-full"
                        disabled={exportDisabled}
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={onExportSelected}
                    >
                        <Download className="mr-2 size-4" />
                        Export selected {pluralize(2, itemLabel)}
                    </Button>
                ) : null}
                {onDeleteSelected ? (
                    <Button
                        className="rounded-full border-[var(--destructive)]/20 text-[var(--destructive)]"
                        disabled={deleteDisabled}
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={onDeleteSelected}
                    >
                        <Trash2 className="mr-2 size-4" />
                        Delete selected {pluralize(2, itemLabel)}
                    </Button>
                ) : null}
                <Button className="rounded-full" size="sm" type="button" variant="ghost" onClick={clearSelection}>
                    <X className="mr-2 size-4" />
                    Clear selection
                </Button>
            </div>
        </div>
    );
};
