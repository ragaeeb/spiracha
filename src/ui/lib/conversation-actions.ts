export type SupportedListAction = {
    disabled?: boolean;
    onSelect: () => void;
    state: 'supported';
    verb?: string;
};

export type DeclaredListAction = SupportedListAction | { reason: string; state: 'not_applicable' | 'unsupported' };

export type DeleteOutcomeStatus = 'cancelled' | 'cleanup_pending' | 'deleted' | 'failed' | 'missing';

export type SettledDeleteItem = {
    id: string;
    status: DeleteOutcomeStatus;
};

export const supportedListAction = (
    onSelect: () => void,
    extras: { disabled?: boolean; verb?: string } = {},
): SupportedListAction => ({
    onSelect,
    state: 'supported',
    ...(extras.disabled === undefined ? {} : { disabled: extras.disabled }),
    ...(extras.verb === undefined ? {} : { verb: extras.verb }),
});

export const applySettledDeleteSelection = (
    selectedIds: readonly string[],
    outcomes: readonly SettledDeleteItem[],
): string[] => {
    const drop = new Set(
        outcomes.flatMap((outcome) =>
            outcome.status === 'deleted' || outcome.status === 'missing' ? [outcome.id] : [],
        ),
    );
    const retain = outcomes.flatMap((outcome) =>
        outcome.status === 'failed' || outcome.status === 'cleanup_pending' ? [outcome.id] : [],
    );
    return [...new Set([...selectedIds.filter((id) => !drop.has(id)), ...retain])];
};

export const settledDeleteItemsFromUnknown = (result: unknown): SettledDeleteItem[] | null => {
    if (typeof result !== 'object' || result === null || !('outcomes' in result)) {
        return null;
    }
    const outcomes = (result as { outcomes: unknown }).outcomes;
    if (!Array.isArray(outcomes)) {
        return null;
    }
    return outcomes.flatMap((outcome) => {
        if (typeof outcome !== 'object' || outcome === null || !('id' in outcome) || !('status' in outcome)) {
            return [];
        }
        const id = (outcome as { id: unknown }).id;
        const status = (outcome as { status: unknown }).status;
        if (typeof id !== 'string' || typeof status !== 'string') {
            return [];
        }
        return [{ id, status: status as DeleteOutcomeStatus }];
    });
};

export const retryableDeleteIds = (outcomes: readonly SettledDeleteItem[]): string[] =>
    outcomes.flatMap((outcome) =>
        outcome.status === 'failed' || outcome.status === 'cleanup_pending' ? [outcome.id] : [],
    );
