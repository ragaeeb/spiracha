export const isWorkspaceEmptiedByDelete = <TItem>(
    items: TItem[],
    deletedIds: string[],
    getItemId: (item: TItem) => string,
) => {
    if (items.length === 0 || deletedIds.length === 0) {
        return false;
    }

    const deletedIdSet = new Set(deletedIds);
    return items.every((item) => deletedIdSet.has(getItemId(item)));
};

export const shouldNavigateToSourceIndexAfterDelete = <TWorkspace>(
    workspaces: TWorkspace[],
    deletedWorkspaceKey: string,
    getWorkspaceKey: (workspace: TWorkspace) => string,
) => {
    return !workspaces.some((workspace) => getWorkspaceKey(workspace) === deletedWorkspaceKey);
};
