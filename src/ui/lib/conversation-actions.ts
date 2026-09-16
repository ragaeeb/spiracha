import { useCallback, useState } from 'react';

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

export type ConversationActionRequest<TOptions> = {
    ids: readonly string[];
    inventoryIdentity: string;
    operationId: string;
    options: TOptions;
};

let nextOperationSeq = 0;

export const supportedListAction = (
    onSelect: () => void,
    extras: { disabled?: boolean; verb?: string } = {},
): SupportedListAction => ({
    onSelect,
    state: 'supported',
    ...(extras.disabled === undefined ? {} : { disabled: extras.disabled }),
    ...(extras.verb === undefined ? {} : { verb: extras.verb }),
});

export const snapshotConversationAction = <TOptions>(
    inventoryIdentity: string,
    ids: readonly string[],
    options: TOptions,
): ConversationActionRequest<TOptions> | null => {
    if (ids.length === 0) {
        return null;
    }
    nextOperationSeq += 1;
    return {
        ids: Object.freeze([...ids]),
        inventoryIdentity,
        operationId: `op-${nextOperationSeq}`,
        options: Object.freeze({ ...options }) as TOptions,
    };
};

export const canBeginConversationOperation = (inFlightOperationId: string | null, ids: readonly string[]): boolean =>
    inFlightOperationId === null && ids.length > 0;

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

export const retryableDeleteIds = (outcomes: readonly SettledDeleteItem[]): string[] =>
    outcomes.flatMap((outcome) =>
        outcome.status === 'failed' || outcome.status === 'cleanup_pending' ? [outcome.id] : [],
    );

export const useConversationActions = (inventoryIdentity: string) => {
    const [inFlightOperationId, setInFlightOperationId] = useState<string | null>(null);
    const confirm = <TOptions>(ids: readonly string[], options: TOptions) => {
        if (!canBeginConversationOperation(inFlightOperationId, ids)) {
            return null;
        }
        const request = snapshotConversationAction(inventoryIdentity, ids, options);
        if (!request) {
            return null;
        }
        setInFlightOperationId(request.operationId);
        return request;
    };
    const cancel = useCallback(() => {
        setInFlightOperationId(null);
    }, []);
    const settle = useCallback((operationId: string) => {
        setInFlightOperationId((current) => (current === operationId ? null : current));
    }, []);
    return { cancel, confirm, inFlightOperationId, settle };
};
