import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { finished } from 'node:stream/promises';
import { formatModelLabel as formatSharedModelLabel } from './model-label';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type ExportFormat = 'md' | 'txt';

export type MetadataEntry = {
    key: string;
    value: unknown;
};

export class CliUsageError extends Error {}

export const expandHome = (value: string): string => {
    if (!value) {
        return value;
    }

    if (value === '~') {
        return os.homedir();
    }

    if (value.startsWith('~/') || value.startsWith('~\\')) {
        return path.join(
            os.homedir(),
            ...value
                .slice(2)
                .split(/[\\/]+/u)
                .filter(Boolean),
        );
    }

    return value;
};

export const pathExists = async (target: string): Promise<boolean> => {
    try {
        await stat(target);
        return true;
    } catch {
        return false;
    }
};

export const isWorkspacePathQuery = (value: string): boolean => {
    const raw = value.trim();
    return raw.startsWith('/') || raw.startsWith('~') || raw.includes('/') || raw.includes('\\');
};

export const normalizeWorkspacePathQuery = (value: string): string => {
    return expandHome(value.trim())
        .replace(/[\\/]+$/u, '')
        .replace(/\\/gu, '/');
};

export const workspacePathMatchesQuery = (worktree: string, query: string): boolean => {
    const normalizedQuery = normalizeWorkspacePathQuery(query);
    const normalizedWorktree = normalizeWorkspacePathQuery(worktree);
    if (!normalizedQuery) {
        return false;
    }
    if (normalizedWorktree === normalizedQuery) {
        return true;
    }

    const suffix = normalizedQuery.replace(/^\/+/u, '');
    return Boolean(suffix) && normalizedWorktree.endsWith(`/${suffix}`);
};

export const cleanInlineTitle = (value: string): string => {
    const firstLine =
        value
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? '';
    const compact = firstLine.replace(/\s+/g, ' ').trim();

    if (compact.length <= 160) {
        return compact;
    }

    return `${compact.slice(0, 157).trimEnd()}...`;
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

export const readJsonlObjects = (filePath: string): AsyncIterableIterator<Record<string, JsonValue>> => {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const lines = createInterface({
        crlfDelay: Infinity,
        input: stream,
    });
    const lineIterator = lines[Symbol.asyncIterator]();
    let closed = false;
    let lineNumber = 0;

    const close = () => {
        if (closed) {
            return;
        }

        closed = true;
        lines.close();
        stream.destroy();
    };

    const readNext = async (): Promise<IteratorResult<Record<string, JsonValue>>> => {
        while (true) {
            const nextLine = await lineIterator.next();
            if (nextLine.done) {
                close();
                return { done: true, value: undefined as never };
            }

            lineNumber += 1;
            const trimmed = nextLine.value.trim();
            if (!trimmed) {
                continue;
            }

            try {
                return {
                    done: false,
                    value: JSON.parse(trimmed) as Record<string, JsonValue>,
                };
            } catch {
                console.warn('[spiracha:jsonl] invalid_json_line', { filePath, lineNumber });
            }
        }
    };

    const iterator: AsyncIterableIterator<Record<string, JsonValue>> = {
        [Symbol.asyncIterator]: () => iterator,
        next: async () => readNext(),
        return: async () => {
            close();
            return { done: true, value: undefined as never };
        },
        throw: async (error?: unknown) => {
            close();
            throw error;
        },
    };

    return iterator;
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
    const backtickRuns = value.match(/`+/g) ?? [];
    const maxRunLength = backtickRuns.reduce((max, run) => Math.max(max, run.length), 0);
    return '`'.repeat(Math.max(minimumLength, maxRunLength + 1));
};

export const inlineCode = (value: string): string => {
    const fence = getBacktickFence(value, 1);
    const padded = value.startsWith('`') || value.endsWith('`') ? ` ${value} ` : value;
    return `${fence}${padded}${fence}`;
};

export const writeExportFile = async (outputPath: string, content: string) => {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await Bun.write(outputPath, content);
};

export const createExportWriteStream = async (outputPath: string) => {
    await mkdir(path.dirname(outputPath), { recursive: true });
    return createWriteStream(outputPath, { encoding: 'utf8' });
};

export const finalizeExportWriteStream = async (stream: NodeJS.WritableStream) => {
    stream.end();
    await finished(stream);
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
