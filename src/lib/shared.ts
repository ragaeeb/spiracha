import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
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

export const readJsonlObjects = (
    filePath: string,
    diagnosticSource = 'jsonl',
): AsyncIterableIterator<Record<string, JsonValue>> => {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const lines = createInterface({
        crlfDelay: Infinity,
        input: stream,
    });
    const lineIterator = lines[Symbol.asyncIterator]();
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
