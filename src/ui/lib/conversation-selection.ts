export type ConversationListSelectionProps = {
    authoritativeRowIds?: readonly string[];
    inventoryIdentity?: string;
};

export type ConversationListInventoryProps<T> = ConversationListSelectionProps & {
    authoritativeRows?: T[];
};

export type SelectionSummary = {
    hiddenCount: number;
    selectedCount: number;
    selectedIds: readonly string[];
    visibleSelectedCount: number;
};

export const lookupSelectedById = <T>(ids: readonly string[], itemsById: ReadonlyMap<string, T>): T[] =>
    ids.flatMap((id) => {
        const item = itemsById.get(id);
        return item === undefined ? [] : [item];
    });

export const lookupSelectedItems = <T>(ids: readonly string[], items: readonly T[], getId: (item: T) => string): T[] =>
    lookupSelectedById(ids, new Map(items.map((item) => [getId(item), item])));

export const conversationListSelection = (
    source: string,
    authoritativeRowIds: readonly string[],
    context?: string,
): Required<ConversationListSelectionProps> => ({
    authoritativeRowIds,
    inventoryIdentity: context ? `${source}:${context}` : source,
});

export const selectedIdsFromRecord = (selection: Record<string, boolean>): string[] =>
    Object.entries(selection).flatMap(([id, selected]) => (selected ? [id] : []));

export const summarizeSelection = (
    selectedIds: readonly string[],
    visibleIds: ReadonlySet<string> | readonly string[],
): SelectionSummary => {
    const visible = visibleIds instanceof Set ? visibleIds : new Set(visibleIds);
    const visibleSelectedCount = selectedIds.filter((id) => visible.has(id)).length;
    return {
        hiddenCount: selectedIds.length - visibleSelectedCount,
        selectedCount: selectedIds.length,
        selectedIds,
        visibleSelectedCount,
    };
};

export const formatSelectionCount = (itemLabel: string, summary: SelectionSummary): string => {
    const noun = `${itemLabel}${summary.selectedCount === 1 ? '' : 's'}`;
    if (summary.hiddenCount === 0) {
        return `${summary.selectedCount} ${noun} selected`;
    }
    return `${summary.selectedCount} ${noun} selected (${summary.hiddenCount} outside this view)`;
};

export const pruneSelectionToAuthoritative = (
    selection: Record<string, boolean>,
    authoritativeIds: ReadonlySet<string>,
): Record<string, boolean> => {
    const next = Object.fromEntries(
        Object.entries(selection).filter(([id, selected]) => selected && authoritativeIds.has(id)),
    );
    return Object.keys(next).length === Object.keys(selection).length ? selection : next;
};
