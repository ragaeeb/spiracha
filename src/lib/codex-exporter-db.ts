import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { withReadonlyDb } from './codex-browser-db';
import {
    type CodexCliOptions,
    DEFAULT_CODEX_DIR,
    type ExportTarget,
    type SpawnEdgeRow,
    type ThreadData,
    type ThreadRelations,
    type ThreadRow,
} from './codex-exporter-types';
import { getPortablePathBasename } from './shared';

export const loadThreadData = (dbPath: string, options: CodexCliOptions): ThreadData => {
    const threadsById = new Map<string, ThreadRow>();
    const parentByChildId = new Map<string, SpawnEdgeRow>();
    const childEdgesByParentId = new Map<string, SpawnEdgeRow[]>();

    try {
        withReadonlyDb(dbPath, (db) => {
            const threadQuery = buildThreadQuery(options);
            const threadRows = db.query(threadQuery.sql).all(...threadQuery.params) as ThreadRow[];

            for (const row of threadRows) {
                threadsById.set(row.id, row);
            }

            const edgeQuery = buildSpawnEdgeQuery([...threadsById.keys()], options);
            const edgeRows = db.query(edgeQuery.sql).all(...edgeQuery.params) as SpawnEdgeRow[];

            for (const row of edgeRows) {
                parentByChildId.set(row.child_thread_id, row);

                const existing = childEdgesByParentId.get(row.parent_thread_id) ?? [];
                existing.push(row);
                childEdgesByParentId.set(row.parent_thread_id, existing);
            }
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read thread database at ${dbPath}: ${message}`);
    }

    return {
        childEdgesByParentId,
        parentByChildId,
        threadsById,
    };
};

export const buildThreadQuery = (options: CodexCliOptions) => {
    const clauses: string[] = [];
    const params: string[] = [];

    if (options.threadIds.length > 0) {
        clauses.push(`id IN (${options.threadIds.map(() => '?').join(', ')})`);
        params.push(...options.threadIds);
    }

    if (options.cwdFilter) {
        clauses.push('cwd = ?');
        params.push(options.cwdFilter);
    }

    if (options.projectFilter) {
        clauses.push("(cwd = ? OR cwd LIKE ? ESCAPE '\\' OR cwd LIKE ? ESCAPE '\\')");
        const projectPattern = escapeSqlLike(options.projectFilter);
        params.push(options.projectFilter, `%/${projectPattern}`, `%\\${projectPattern}`);
    }

    return {
        params,
        sql: clauses.length > 0 ? `SELECT * FROM threads WHERE ${clauses.join(' AND ')}` : 'SELECT * FROM threads',
    };
};

export const buildSpawnEdgeQuery = (threadIds: string[], options: CodexCliOptions) => {
    const hasScopedFilters =
        options.threadIds.length > 0 || options.cwdFilter !== null || options.projectFilter !== null;

    if (!hasScopedFilters || threadIds.length === 0) {
        return {
            params: [] as string[],
            sql: 'SELECT * FROM thread_spawn_edges',
        };
    }

    const placeholders = threadIds.map(() => '?').join(', ');
    return {
        params: [...threadIds, ...threadIds],
        sql: `SELECT * FROM thread_spawn_edges WHERE parent_thread_id IN (${placeholders}) OR child_thread_id IN (${placeholders})`,
    };
};

export const findJsonlFiles = async (rootDir: string): Promise<string[]> => {
    const entries = await readdir(rootDir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
        const fullPath = path.join(rootDir, entry.name);

        if (entry.isDirectory()) {
            files.push(...(await findJsonlFiles(fullPath)));
            continue;
        }

        if (entry.isFile() && fullPath.endsWith('.jsonl')) {
            files.push(fullPath);
        }
    }

    files.sort();
    return files;
};

export const shouldScanFallbackSessionFiles = (options: CodexCliOptions) => {
    return !options.cwdFilter && !options.projectFilter && options.threadIds.length === 0;
};

export const buildExportTargets = (
    threadData: ThreadData,
    sessionFiles: string[],
    options: CodexCliOptions,
): ExportTarget[] => {
    const targets: ExportTarget[] = [];
    const seenSessionFiles = new Set<string>();
    const threadOrder = new Map(options.threadIds.map((threadId, index) => [threadId, index] as const));

    for (const thread of threadData.threadsById.values()) {
        if (!matchesFilters(thread.cwd, options)) {
            continue;
        }

        const sessionFile = path.resolve(thread.rollout_path);
        seenSessionFiles.add(sessionFile);

        targets.push({
            fallbackReason: null,
            outputRelativePath: toOutputRelativePath(sessionFile, options, thread.cwd),
            relations: getRelations(thread.id, threadData),
            sessionFile,
            thread,
        });
    }

    for (const sessionFile of sessionFiles) {
        const normalized = path.resolve(sessionFile);
        if (seenSessionFiles.has(normalized)) {
            continue;
        }

        targets.push({
            fallbackReason: 'missing_thread_row',
            outputRelativePath: toOutputRelativePath(normalized, options),
            relations: {
                childEdges: [],
                parentThreadId: null,
            },
            sessionFile: normalized,
            thread: null,
        });
    }

    if (options.threadIds.length > 0) {
        targets.sort((left, right) => {
            const leftOrder = left.thread
                ? (threadOrder.get(left.thread.id) ?? Number.MAX_SAFE_INTEGER)
                : Number.MAX_SAFE_INTEGER;
            const rightOrder = right.thread
                ? (threadOrder.get(right.thread.id) ?? Number.MAX_SAFE_INTEGER)
                : Number.MAX_SAFE_INTEGER;

            if (leftOrder !== rightOrder) {
                return leftOrder - rightOrder;
            }

            return left.outputRelativePath.localeCompare(right.outputRelativePath);
        });
    } else {
        targets.sort((left, right) => left.outputRelativePath.localeCompare(right.outputRelativePath));
    }

    return options.flat ? ensureUniqueFlatOutputPaths(targets) : targets;
};

export const matchesFilters = (
    value: string | null | undefined,
    options: Pick<CodexCliOptions, 'cwdFilter' | 'projectFilter'>,
): boolean => {
    return matchesCwdFilter(value, options.cwdFilter) && matchesProjectFilter(value, options.projectFilter);
};

export const toOutputRelativePath = (
    sessionFile: string,
    options: CodexCliOptions,
    projectCwd?: string | null,
): string => {
    const normalized = path.resolve(sessionFile);
    const inputRoot = path.resolve(options.inputDir);
    const codexRoot = path.resolve(DEFAULT_CODEX_DIR);
    const extension = options.outputFormat === 'txt' ? '.txt' : '.md';
    const flatName = toFlatFileName(normalized, extension, projectCwd);

    if (options.flat) {
        return flatName;
    }

    // Prefer preserving the input sessions tree when the rollout lives under the configured input root.
    if (normalized.startsWith(`${inputRoot}${path.sep}`)) {
        return path.relative(inputRoot, normalized).replace(/\.jsonl$/i, extension);
    }

    // Fall back to a stable Codex-relative path when the file is under ~/.codex.
    if (normalized.startsWith(`${codexRoot}${path.sep}`)) {
        return path.relative(codexRoot, normalized).replace(/\.jsonl$/i, extension);
    }

    // Otherwise collapse to the basename so ad hoc session files cannot escape the output directory.
    return path.basename(normalized).replace(/\.jsonl$/i, extension);
};

export const toCodexRelativePath = (targetPath: string): string => {
    const codexRoot = path.resolve(DEFAULT_CODEX_DIR);
    const normalized = path.resolve(targetPath);

    if (normalized.startsWith(`${codexRoot}${path.sep}`)) {
        return path.relative(codexRoot, normalized);
    }

    return normalized;
};

const escapeSqlLike = (value: string) => {
    return value.replace(/([\\%_])/g, '\\$1');
};

const getRelations = (threadId: string, threadData: ThreadData): ThreadRelations => {
    const parentEdge = threadData.parentByChildId.get(threadId) ?? null;
    const childEdges = [...(threadData.childEdgesByParentId.get(threadId) ?? [])].sort((left, right) =>
        left.child_thread_id.localeCompare(right.child_thread_id),
    );

    return {
        childEdges,
        parentThreadId: parentEdge?.parent_thread_id ?? null,
    };
};

const matchesCwdFilter = (value: string | null | undefined, cwdFilter: string | null): boolean => {
    if (!cwdFilter) {
        return true;
    }

    return value === cwdFilter;
};

const matchesProjectFilter = (value: string | null | undefined, projectFilter: string | null): boolean => {
    if (!projectFilter) {
        return true;
    }

    if (!value) {
        return false;
    }

    return getPortablePathBasename(value) === projectFilter;
};

const toFlatFileName = (sessionFile: string, extension: string, projectCwd?: string | null): string => {
    const normalized = path.resolve(sessionFile);
    const codexRoot = path.resolve(DEFAULT_CODEX_DIR);
    const relative = normalized.startsWith(`${codexRoot}${path.sep}`)
        ? path.relative(codexRoot, normalized)
        : path.basename(normalized);

    const flattened = relative.replace(/[\\/]/g, '__').replace(/\.jsonl$/i, extension);

    if (!projectCwd) {
        return flattened;
    }

    const portableProjectName = getPortablePathBasename(projectCwd);
    if (!portableProjectName) {
        return flattened;
    }

    return `${portableProjectName}${extension}`;
};

const ensureUniqueFlatOutputPaths = (targets: ExportTarget[]): ExportTarget[] => {
    const counts = new Map<string, number>();
    for (const target of targets) {
        counts.set(target.outputRelativePath, (counts.get(target.outputRelativePath) ?? 0) + 1);
    }

    return targets.map((target) => {
        if ((counts.get(target.outputRelativePath) ?? 0) < 2) {
            return target;
        }

        const suffix = getFlatCollisionSuffix(target);
        const extension = path.extname(target.outputRelativePath);
        const basename = extension ? target.outputRelativePath.slice(0, -extension.length) : target.outputRelativePath;

        return {
            ...target,
            outputRelativePath: `${basename}__${suffix}${extension}`,
        };
    });
};

const getFlatCollisionSuffix = (target: ExportTarget): string => {
    if (target.thread?.id) {
        return target.thread.id.slice(0, 8);
    }

    return path.basename(target.sessionFile, '.jsonl').slice(-8);
};
