import { rename, rm } from 'node:fs/promises';

type JsonObject = Record<string, unknown>;

export type CodexGlobalStateCleanupResult = {
    changed: boolean;
    removedThreadIds: string[];
    writingBlockFlagsSet: string[];
};

const asObject = (value: unknown): JsonObject | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    return value as JsonObject;
};

const threadIdSet = (threadIds: readonly string[]) => new Set(threadIds.filter((threadId) => threadId.length > 0));

const removeObjectKeys = (value: unknown, threadIds: Set<string>, removedThreadIds: Set<string>) => {
    const object = asObject(value);
    if (!object) {
        return;
    }

    for (const key of Object.keys(object)) {
        if (!threadIds.has(key)) {
            continue;
        }

        delete object[key];
        removedThreadIds.add(key);
    }
};

const removeThreadIdArrayEntries = (value: unknown, threadIds: Set<string>, removedThreadIds: Set<string>) => {
    if (!Array.isArray(value)) {
        return;
    }

    const retained = value.filter((entry) => {
        if (typeof entry !== 'string' || !threadIds.has(entry)) {
            return true;
        }

        removedThreadIds.add(entry);
        return false;
    });

    value.splice(0, value.length, ...retained);
};

const removeAtomKeysForThreads = (atomState: JsonObject, threadIds: Set<string>, removedThreadIds: Set<string>) => {
    for (const key of Object.keys(atomState)) {
        const matchingThreadId = [...threadIds].find((threadId) => key.includes(threadId));
        if (!matchingThreadId) {
            continue;
        }

        delete atomState[key];
        removedThreadIds.add(matchingThreadId);
    }
};

const removeThreadBindings = (value: unknown, threadIds: Set<string>, removedThreadIds: Set<string>) => {
    const bindings = asObject(value);
    if (!bindings) {
        return;
    }

    for (const [key, binding] of Object.entries(bindings)) {
        const matchingThreadId = [...threadIds].find(
            (threadId) => key.includes(threadId) || (typeof binding === 'string' && binding.includes(threadId)),
        );
        if (!matchingThreadId) {
            continue;
        }

        delete bindings[key];
        removedThreadIds.add(matchingThreadId);
    }
};

const removeSidebarThreadIds = (value: unknown, threadIds: Set<string>, removedThreadIds: Set<string>) => {
    const projects = asObject(value);
    if (!projects) {
        return;
    }

    for (const project of Object.values(projects)) {
        const projectObject = asObject(project);
        if (!projectObject) {
            continue;
        }

        removeThreadIdArrayEntries(projectObject.threadIds, threadIds, removedThreadIds);
    }
};

export const removeCodexGlobalStateThreadReferences = (
    state: JsonObject,
    threadIds: readonly string[],
): CodexGlobalStateCleanupResult => {
    const requestedThreadIds = threadIdSet(threadIds);
    if (requestedThreadIds.size === 0) {
        return { changed: false, removedThreadIds: [], writingBlockFlagsSet: [] };
    }

    const removedThreadIds = new Set<string>();
    const writingBlockFlagsSet = new Set<string>();
    removeThreadIdArrayEntries(state['projectless-thread-ids'], requestedThreadIds, removedThreadIds);
    removeSidebarThreadIds(state['sidebar-project-thread-orders'], requestedThreadIds, removedThreadIds);
    removeObjectKeys(state['thread-workspace-root-hints'], requestedThreadIds, removedThreadIds);

    const atomState = asObject(state['electron-persisted-atom-state']);
    if (atomState) {
        removeAtomKeysForThreads(atomState, requestedThreadIds, removedThreadIds);
        removeObjectKeys(atomState['heartbeat-thread-permissions-by-id'], requestedThreadIds, removedThreadIds);
        removeObjectKeys(atomState['prompt-history'], requestedThreadIds, removedThreadIds);
        removeObjectKeys(atomState['thread-descriptions-v1'], requestedThreadIds, removedThreadIds);
        removeThreadBindings(atomState['client-thread-bindings-v1'], requestedThreadIds, removedThreadIds);

        for (const threadId of requestedThreadIds) {
            const key = `codex-writing-block-deleted-thread-v1:${threadId}`;
            if (atomState[key] === true) {
                writingBlockFlagsSet.add(threadId);
                continue;
            }

            atomState[key] = true;
            writingBlockFlagsSet.add(threadId);
        }
    }

    return {
        changed: removedThreadIds.size > 0 || writingBlockFlagsSet.size > 0,
        removedThreadIds: threadIds.filter((threadId) => removedThreadIds.has(threadId)),
        writingBlockFlagsSet: threadIds.filter((threadId) => writingBlockFlagsSet.has(threadId)),
    };
};

let globalStateMutationQueue = Promise.resolve();

export const removeCodexGlobalStateThreadReferencesFromFile = async (
    globalStatePath: string,
    threadIds: readonly string[],
): Promise<CodexGlobalStateCleanupResult> => {
    const runMutation = async (): Promise<CodexGlobalStateCleanupResult> => {
        if (!(await Bun.file(globalStatePath).exists())) {
            return { changed: false, removedThreadIds: [], writingBlockFlagsSet: [] };
        }

        const state = asObject(await Bun.file(globalStatePath).json());
        if (!state) {
            return { changed: false, removedThreadIds: [], writingBlockFlagsSet: [] };
        }

        const result = removeCodexGlobalStateThreadReferences(state, threadIds);
        if (!result.changed) {
            return result;
        }

        const temporaryPath = `${globalStatePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
        try {
            await Bun.write(temporaryPath, JSON.stringify(state));
            await rename(temporaryPath, globalStatePath);
        } catch (error) {
            await rm(temporaryPath, { force: true });
            throw error;
        }

        return result;
    };

    const mutation = globalStateMutationQueue.then(runMutation, runMutation);
    globalStateMutationQueue = mutation.then(
        () => undefined,
        () => undefined,
    );
    return mutation;
};
