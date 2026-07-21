export type TextQuerySearch = {
    q?: string;
};

export type AnalyticsSearch = {
    project?: string;
};

export type ThreadTranscriptSearch = {
    commentary?: boolean;
    extra?: boolean;
    full?: boolean;
    q?: string;
    raw?: boolean;
    sort?: 'earliest' | 'latest';
    tools?: boolean;
    user?: boolean;
};

export type TranscriptDisplayState = {
    showCommentary: boolean;
    showExtraEvents: boolean;
    showRawJson: boolean;
    showToolCalls: boolean;
    showUserMessages: boolean;
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

const asBooleanSearch = (value: unknown) => {
    if (value === true || value === 'true' || value === '1') {
        return true;
    }

    if (value === false || value === 'false' || value === '0') {
        return false;
    }

    return undefined;
};

const setBooleanSearchParam = (target: SearchRecord, key: keyof ThreadTranscriptSearch, value: boolean) => {
    if (value) {
        target[key] = true;
        return;
    }

    delete target[key];
};

const setTextSearchParam = (target: SearchRecord, key: keyof ThreadTranscriptSearch, value: string | undefined) => {
    const trimmed = asNonBlankString(value);
    if (trimmed) {
        target[key] = trimmed;
        return;
    }

    delete target[key];
};

const setThreadSortSearchParam = (target: SearchRecord, value: ThreadTranscriptSearch['sort']) => {
    if (value === 'latest') {
        target.sort = 'latest';
        return;
    }

    delete target.sort;
};

export const parseThreadTranscriptSearch = (search: SearchRecord): ThreadTranscriptSearch => {
    const q = asNonBlankString(search.q);
    const sort = search.sort === 'latest' ? 'latest' : undefined;
    const parsed: ThreadTranscriptSearch = q ? { q } : {};
    const tools = asBooleanSearch(search.tools);
    const commentary = asBooleanSearch(search.commentary);
    const extra = asBooleanSearch(search.extra);
    const full = asBooleanSearch(search.full);
    const raw = asBooleanSearch(search.raw);
    const user = asBooleanSearch(search.user);

    if (tools) {
        parsed.tools = true;
    }
    if (commentary) {
        parsed.commentary = true;
    }
    if (extra) {
        parsed.extra = true;
    }
    if (full) {
        parsed.full = true;
    }
    if (raw) {
        parsed.raw = true;
    }
    if (user) {
        parsed.user = true;
    }
    if (sort) {
        parsed.sort = sort;
    }

    return parsed;
};

export const getTranscriptDisplayState = (search: ThreadTranscriptSearch): TranscriptDisplayState => ({
    showCommentary: search.commentary === true,
    showExtraEvents: search.extra === true,
    showRawJson: search.raw === true,
    showToolCalls: search.tools === true,
    showUserMessages: search.user === true,
});

export const withThreadTranscriptSearch = (
    current: SearchRecord,
    patch: Partial<ThreadTranscriptSearch>,
): SearchRecord & ThreadTranscriptSearch => {
    const next = { ...current };

    if ('q' in patch) {
        setTextSearchParam(next, 'q', patch.q);
    }
    if ('sort' in patch) {
        setThreadSortSearchParam(next, patch.sort);
    }

    if ('tools' in patch && typeof patch.tools === 'boolean') {
        setBooleanSearchParam(next, 'tools', patch.tools);
    }
    if ('commentary' in patch && typeof patch.commentary === 'boolean') {
        setBooleanSearchParam(next, 'commentary', patch.commentary);
    }
    if ('extra' in patch && typeof patch.extra === 'boolean') {
        setBooleanSearchParam(next, 'extra', patch.extra);
    }
    if ('full' in patch && typeof patch.full === 'boolean') {
        setBooleanSearchParam(next, 'full', patch.full);
    }
    if ('raw' in patch && typeof patch.raw === 'boolean') {
        setBooleanSearchParam(next, 'raw', patch.raw);
    }
    if ('user' in patch && typeof patch.user === 'boolean') {
        setBooleanSearchParam(next, 'user', patch.user);
    }

    return next as SearchRecord & ThreadTranscriptSearch;
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
