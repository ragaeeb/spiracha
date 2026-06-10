export type TextQuerySearch = {
    q?: string;
};

export type AnalyticsSearch = {
    project?: string;
};

type SearchRecord = Record<string, unknown>;

const asNonBlankString = (value: unknown) => {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
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
    const q = asNonBlankString(query);
    if (q) {
        next.q = q;
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
    const trimmedProject = asNonBlankString(project);
    if (trimmedProject) {
        next.project = trimmedProject;
    } else {
        delete next.project;
    }

    return next as SearchRecord & AnalyticsSearch;
};

const ALL_PROJECTS_SELECT_VALUE = '__all__';
const PROJECT_SELECT_PREFIX = 'project:';

export const encodeAnalyticsProjectSelectValue = (project: string | null) => {
    return project ? `${PROJECT_SELECT_PREFIX}${project}` : ALL_PROJECTS_SELECT_VALUE;
};

export const decodeAnalyticsProjectSelectValue = (value: string) => {
    return value === ALL_PROJECTS_SELECT_VALUE || !value.startsWith(PROJECT_SELECT_PREFIX)
        ? null
        : value.slice(PROJECT_SELECT_PREFIX.length);
};
