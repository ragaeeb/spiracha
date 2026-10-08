import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { asObject, type JsonValue } from './shared-text';

export class CliUsageError extends Error {}

export const readDirectoryEntriesIfExists = async (directoryPath: string) => {
    try {
        return await readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
        if ((error as { code?: unknown }).code === 'ENOENT') {
            return [];
        }
        throw error;
    }
};

export const toFileUri = (filePath: string): string => pathToFileURL(filePath).href;

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

/** Splits on `\n` (dropping a trailing `\r`) only; node:readline also splits on U+2028/U+2029, which JSON strings may contain unescaped. */
export async function* splitJsonlLines(stream: AsyncIterable<string | Buffer>): AsyncGenerator<string> {
    const decoder = new TextDecoder();
    // Only a record's unfinished tail is retained; each chunk is searched for newlines exactly once.
    let fragment = '';
    for await (const chunk of stream) {
        const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
        let start = 0;
        let newlineIndex = text.indexOf('\n');
        while (newlineIndex >= 0) {
            const line = fragment + text.slice(start, newlineIndex);
            fragment = '';
            yield line.endsWith('\r') ? line.slice(0, -1) : line;
            start = newlineIndex + 1;
            newlineIndex = text.indexOf('\n', start);
        }
        fragment += text.slice(start);
    }
    fragment += decoder.decode();
    if (fragment) {
        yield fragment;
    }
}

/**
 * Streams JSON object records, skipping blank lines, malformed JSON, and non-object
 * JSON values. Emits one aggregated warning with count/path/first bad line on close;
 * this tolerant source-reader policy differs from strict supplied-payload conversion.
 * Consume with for-await (or call return/throw on early exit) so the iterator closes
 * the line splitter and destroys its stream. Streaming does not impose a per-line byte cap.
 * Do not use successful iteration as proof that every source record was preserved.
 */
export const readJsonlObjects = (
    filePath: string,
    diagnosticSource = 'jsonl',
): AsyncIterableIterator<Record<string, JsonValue>> => {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const lineIterator = splitJsonlLines(stream);
    let closed = false;
    let invalidRecordCount = 0;
    let firstInvalidLineNumber: number | null = null;
    let lineNumber = 0;

    const warnAboutInvalidRecords = () => {
        if (invalidRecordCount > 0) {
            console.warn(`[spiracha:${diagnosticSource}] skipped invalid records`, {
                count: invalidRecordCount,
                filePath,
                firstLineNumber: firstInvalidLineNumber,
            });
            invalidRecordCount = 0;
        }
    };

    const close = () => {
        if (closed) {
            return;
        }

        warnAboutInvalidRecords();
        closed = true;
        void lineIterator.return(undefined);
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
                const parsed = JSON.parse(trimmed) as JsonValue;
                const object = asObject(parsed);
                if (!object) {
                    invalidRecordCount += 1;
                    firstInvalidLineNumber ??= lineNumber;
                    continue;
                }

                return {
                    done: false,
                    value: object,
                };
            } catch {
                invalidRecordCount += 1;
                firstInvalidLineNumber ??= lineNumber;
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
