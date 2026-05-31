type SearchValue = boolean | number | string | null | undefined;

const normalizeSearchToken = (value: string) => value.trim().toLowerCase();

export const tokenizeSearchQuery = (query: string): string[] => {
    const normalized = normalizeSearchToken(query);
    return normalized ? normalized.split(/\s+/u).filter(Boolean) : [];
};

export const matchesTextQuery = (query: string, values: SearchValue[]): boolean => {
    const tokens = tokenizeSearchQuery(query);
    if (tokens.length === 0) {
        return true;
    }

    const haystack = values
        .filter((value) => value !== null && value !== undefined)
        .map((value) => String(value).toLowerCase())
        .join('\n');

    return tokens.every((token) => haystack.includes(token));
};
