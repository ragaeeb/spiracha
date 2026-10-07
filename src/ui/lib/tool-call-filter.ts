/** Narrows a list to the threads an active tool call search matched; a null search leaves it untouched. */
export const filterToToolCallHits = <T>(
    items: T[],
    getId: (item: T) => string,
    hitsById: ReadonlyMap<string, unknown> | null,
): T[] => (hitsById ? items.filter((item) => hitsById.has(getId(item))) : items);
