export type TextQuerySearch = {
    q?: string;
};

export type AnalyticsSearch = {
    project?: string;
};

type SearchRecord = Record<string, unknown>;

const asNonBlankString = (value: unknown) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return undefined;
    }

    return value;
};

export const parseTextQuerySearch = (search: SearchRecord): TextQuerySearch => {
    const q = asNonBlankString(search.q);
    return q ? { q } : {};
};

export const parseAnalyticsSearch = (search: SearchRecord): AnalyticsSearch => {
    const project = asNonBlankString(search.project);
    return project ? { project } : {};
};

export const withTextQuerySearch = (current: SearchRecord, query: string): SearchRecord & TextQuerySearch => {
    const next = { ...current };
    if (query.trim().length > 0) {
        next.q = query;
    } else {
        delete next.q;
    }

    return next as SearchRecord & TextQuerySearch;
};

export const withAnalyticsProjectSearch = (
    current: SearchRecord,
    project: string | null,
): SearchRecord & AnalyticsSearch => {
    const next = { ...current };
    if (project && project.trim().length > 0) {
        next.project = project;
    } else {
        delete next.project;
    }

    return next as SearchRecord & AnalyticsSearch;
};
