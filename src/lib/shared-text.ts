import { formatModelLabel as formatSharedModelLabel } from './model-label';

const INLINE_TITLE_MAX_CHARACTERS = 160;

const INLINE_TITLE_ELLIPSIS = '...';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type ExportFormat = 'md' | 'txt';

export type MetadataEntry = {
    key: string;
    value: unknown;
};

export const cleanInlineTitle = (value: string): string => {
    const firstLine =
        value
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? '';
    const compact = firstLine.replace(/\s+/g, ' ').trim();

    if (compact.length <= INLINE_TITLE_MAX_CHARACTERS) {
        return compact;
    }

    return `${compact.slice(0, INLINE_TITLE_MAX_CHARACTERS - INLINE_TITLE_ELLIPSIS.length).trimEnd()}${INLINE_TITLE_ELLIPSIS}`;
};

export const cleanExtractedText = (text: string): string => {
    return text.replace(/^\s*<\/?image>\s*$/gm, '').replace(/\n{3,}/g, '\n\n');
};

const CODEX_APP_DIRECTIVE_PATTERN =
    /^::(?:code-comment|created-thread|git-commit|git-create-branch|git-create-pr|git-push|git-stage)\{.*\}\s*$/u;

export const stripCodexAppDirectiveLines = (text: string): string => {
    return text
        .split('\n')
        .filter((line) => !CODEX_APP_DIRECTIVE_PATTERN.test(line.trim()))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};

export const formatModelLabel = formatSharedModelLabel;

export const asObject = (value: JsonValue): Record<string, JsonValue> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    return value as Record<string, JsonValue>;
};

export const asString = (value: JsonValue): string | null => {
    return typeof value === 'string' ? value : null;
};

export const asNumber = (value: JsonValue): number | null => {
    return typeof value === 'number' ? value : null;
};

export const asBoolean = (value: JsonValue): boolean => {
    return value === true;
};

const emittedParserDiagnostics = new Set<string>();

const getParserDiagnosticKey = (source: string, code: string, scope?: string): string =>
    `${source}:${code}${scope ? `:${scope}` : ''}`;

export const resetParserDiagnosticForTests = (source: string, code: string, scope?: string): void => {
    emittedParserDiagnostics.delete(getParserDiagnosticKey(source, code, scope));
};

export const warnParserDiagnosticOnce = (
    source: string,
    code: string,
    details: Record<string, unknown>,
    scope?: string,
): void => {
    const key = getParserDiagnosticKey(source, code, scope);
    if (emittedParserDiagnostics.has(key)) {
        return;
    }

    emittedParserDiagnostics.add(key);
    console.warn(`[spiracha:${source}] ${code}`, details);
};

export const renderDocumentTitle = (title: string, format: ExportFormat): string => {
    if (format === 'md') {
        return `# ${title}`;
    }

    return [title, '='.repeat(Math.max(title.length, 3))].join('\n');
};

export const renderMetadataBlock = (entries: MetadataEntry[], format: ExportFormat): string => {
    const filteredEntries = entries.filter(
        (entry) => entry.value !== null && entry.value !== undefined && entry.value !== '',
    );

    if (filteredEntries.length === 0) {
        return '';
    }

    if (format === 'md') {
        const lines = ['---'];
        for (const entry of filteredEntries) {
            lines.push(`${entry.key}: ${toMetadataValue(entry.value, 'md')}`);
        }
        lines.push('---');
        return `${lines.join('\n')}\n`;
    }

    const lines = ['Metadata', '--------'];
    for (const entry of filteredEntries) {
        lines.push(`${entry.key}: ${toMetadataValue(entry.value, 'txt')}`);
    }
    return `${lines.join('\n')}\n`;
};

export const renderSection = (title: string, body: string, format: ExportFormat): string => {
    const trimmedBody = body.trimEnd();
    if (!trimmedBody) {
        return '';
    }

    if (format === 'md') {
        return `## ${title}\n\n${trimmedBody}\n`;
    }

    return `${title}\n${'-'.repeat(Math.max(title.length, 3))}\n${trimmedBody}\n`;
};

export const renderCodeBlock = (text: string, format: ExportFormat): string => {
    if (format === 'md') {
        const fence = getBacktickFence(text, 3);
        return `${fence}text\n${text}\n${fence}`;
    }

    return text;
};

export const formatInlineLiteral = (value: string, format: ExportFormat): string => {
    return format === 'md' ? inlineCode(value) : value;
};

const getBacktickFence = (value: string, minimumLength: number): string => {
    const backtickRuns = value.match(/`+/gu) ?? [];
    const maxRunLength = backtickRuns.reduce((max, run) => Math.max(max, run.length), 0);
    return '`'.repeat(Math.max(minimumLength, maxRunLength + 1));
};

export const inlineCode = (value: string): string => {
    const fence = getBacktickFence(value, 1);
    const padded = value.startsWith('`') || value.endsWith('`') ? ` ${value} ` : value;
    return `${fence}${padded}${fence}`;
};

const toMetadataValue = (value: unknown, format: ExportFormat): string => {
    if (Array.isArray(value) || (value && typeof value === 'object')) {
        return JSON.stringify(value);
    }

    if (typeof value === 'string') {
        return format === 'md' ? JSON.stringify(value) : value;
    }

    if (typeof value === 'boolean' || typeof value === 'number') {
        return String(value);
    }

    return format === 'md' ? JSON.stringify(String(value)) : String(value);
};
