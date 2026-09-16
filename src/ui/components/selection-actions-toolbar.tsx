import { Download, Trash2, X } from 'lucide-react';
import { Button } from '#/components/ui/button';
import type { DeclaredListAction, SupportedListAction } from '#/lib/conversation-actions';
import { formatSelectionCount } from '#/lib/conversation-selection';

export type { DeclaredListAction, SupportedListAction };

type ConversationSelectionActionsProps = {
    clearSelection: () => void;
    deleteAction: DeclaredListAction;
    exportAction: DeclaredListAction;
    hiddenSelectedCount?: number;
    itemLabel: string;
    selectedCount: number;
};

const pluralize = (count: number, itemLabel: string) => `${itemLabel}${count === 1 ? '' : 's'}`;

const actionVerb = (action: DeclaredListAction, fallback: string) =>
    action.state === 'supported' ? (action.verb ?? fallback) : null;

const ActionButton = ({
    action,
    itemLabel,
    selectedCount,
    variant,
}: {
    action: SupportedListAction;
    itemLabel: string;
    selectedCount: number;
    variant: 'delete' | 'export';
}) => {
    const verb = action.verb ?? (variant === 'delete' ? 'Delete' : 'Export');
    return (
        <Button
            className={
                variant === 'delete'
                    ? 'rounded-full border-[var(--destructive)]/20 text-[var(--destructive)]'
                    : 'rounded-full'
            }
            disabled={action.disabled}
            size="sm"
            type="button"
            variant="outline"
            onClick={action.onSelect}
        >
            {variant === 'delete' ? <Trash2 className="mr-2 size-4" /> : <Download className="mr-2 size-4" />}
            {verb} selected {pluralize(selectedCount, itemLabel)}
        </Button>
    );
};

export const ConversationSelectionActions = ({
    clearSelection,
    deleteAction,
    exportAction,
    hiddenSelectedCount = 0,
    itemLabel,
    selectedCount,
}: ConversationSelectionActionsProps) => {
    if (selectedCount === 0) {
        const verbs = [actionVerb(exportAction, 'export'), actionVerb(deleteAction, 'delete')].filter(
            (verb): verb is string => verb !== null,
        );
        const actionText =
            verbs.length === 2
                ? `${verbs[0]} or ${verbs[1]} them in a batch`
                : verbs.length === 1
                  ? `${verbs[0]} them in a batch`
                  : 'manage them in a batch';
        const exceptionReason =
            deleteAction.state === 'supported'
                ? exportAction.state === 'supported'
                    ? null
                    : exportAction.reason
                : deleteAction.reason;

        return (
            <p className="text-[var(--muted-foreground)] text-sm">
                Select {pluralize(2, itemLabel)} to {actionText}.{exceptionReason ? ` ${exceptionReason}` : ''}
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm" role="status">
                {formatSelectionCount(itemLabel, {
                    hiddenCount: hiddenSelectedCount,
                    selectedCount,
                    selectedIds: [],
                    visibleSelectedCount: selectedCount - hiddenSelectedCount,
                })}
            </p>
            <div className="flex flex-wrap gap-2">
                {exportAction.state === 'supported' ? (
                    <ActionButton
                        action={exportAction}
                        itemLabel={itemLabel}
                        selectedCount={selectedCount}
                        variant="export"
                    />
                ) : null}
                {deleteAction.state === 'supported' ? (
                    <ActionButton
                        action={deleteAction}
                        itemLabel={itemLabel}
                        selectedCount={selectedCount}
                        variant="delete"
                    />
                ) : null}
                <Button className="rounded-full" size="sm" type="button" variant="ghost" onClick={clearSelection}>
                    <X className="mr-2 size-4" />
                    Clear selection
                </Button>
            </div>
        </div>
    );
};

export const SelectionActionsToolbar = ConversationSelectionActions;
