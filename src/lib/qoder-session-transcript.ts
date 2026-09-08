import path from 'node:path';
import { loadQoderAcpSession, type QoderAcpSessionUpdate, resolveQoderAcpSocketPath } from './qoder-acp-client';
import {
    type QoderSessionTranscript,
    type QoderTranscriptEntry,
    resolveQoderCliProjectsDir,
    resolveQoderGlobalStateDb,
    resolveQoderWorkspaceStorageDir,
} from './qoder-exporter-types';
import {
    buildLocalTranscriptEntryGroups,
    createStatsFromEntries,
    getLastActiveAtMs,
    getModelFallback,
    loadQoderRecords,
    pathExists,
    type QoderSessionRecord,
    type QoderStateData,
    readQoderStateData,
    toQoderSessionSummary,
} from './qoder-storage';
import {
    asJsonObject,
    getRawStringValue,
    normalizeQoderModelLabel,
    parseJsonValue,
    parseQoderAcpTranscriptUpdate,
    parseQoderCliTranscriptLine,
} from './qoder-transcript-parser';
import { coalesceQoderMessageChunks } from './qoder-transcript-phase';
import { asString } from './shared-text';

const ACP_RECENT_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

type QoderTranscriptReadOptions = {
    acpDrainMs?: number;
    acpSocketPath?: string | null;
    acpTimeoutMs?: number;
    enableAcp?: boolean;
};

type QoderCliTranscript = {
    entries: QoderTranscriptEntry[];
    model: string | null;
    path: string | null;
};

const getCliWorkspaceDirectoryName = (worktree: string): string => {
    return worktree.replace(/[\\/]+/gu, '-');
};

const getCliTranscriptCandidates = (projectsDir: string, record: QoderSessionRecord): string[] => {
    return [
        path.join(projectsDir, `${record.sessionId}.jsonl`),
        path.join(projectsDir, getCliWorkspaceDirectoryName(record.worktree), `${record.sessionId}.jsonl`),
    ];
};

const locateCliTranscriptPath = async (projectsDir: string, record: QoderSessionRecord): Promise<string | null> => {
    for (const candidate of getCliTranscriptCandidates(projectsDir, record)) {
        if (await pathExists(candidate)) {
            return candidate;
        }
    }

    return null;
};

const normalizeCliModel = (model: string | null, modelFallback: string | null): string | null => {
    if (!model) {
        return null;
    }

    if (model === 'auto') {
        return modelFallback;
    }

    return normalizeQoderModelLabel(model);
};

const readCliTranscriptEntries = async (
    projectsDir: string,
    record: QoderSessionRecord,
    modelFallback: string | null,
): Promise<QoderCliTranscript> => {
    const transcriptPath = await locateCliTranscriptPath(projectsDir, record);
    if (!transcriptPath) {
        return { entries: [], model: null, path: null };
    }

    const text = await Bun.file(transcriptPath)
        .text()
        .catch(() => '');
    let model: string | null = null;
    const entries = text.split(/\r?\n/u).flatMap((line, lineIndex) => {
        if (!line.trim()) {
            return [];
        }

        const raw = asJsonObject(parseJsonValue(line));
        model ??= normalizeCliModel(asString(raw?.model ?? null), modelFallback);
        return raw ? parseQoderCliTranscriptLine(raw, lineIndex, transcriptPath) : [];
    });

    return { entries, model, path: transcriptPath };
};

const getAcpModel = (events: QoderAcpSessionUpdate[]): string | null => {
    for (const event of [...events].reverse()) {
        if (event.update.sessionUpdate !== 'current_model_update') {
            continue;
        }

        const model = normalizeQoderModelLabel(getRawStringValue(event.update, ['modelId', 'model', 'modelName']));
        if (model) {
            return model;
        }
    }

    return null;
};

const getTaskIdForAcpLoad = (record: QoderSessionRecord): string | null => {
    return record.task?.id ?? (record.sessionId.replace(/\.session\.execution$/u, '') || null);
};

const shouldUseAcp = (
    record: QoderSessionRecord,
    state: QoderStateData,
    cliTranscript: QoderCliTranscript,
    options: QoderTranscriptReadOptions,
    globalStateDb: string,
    workspaceStorageDir: string,
): boolean => {
    if (options.enableAcp === false) {
        return false;
    }

    if (cliTranscript.entries.some((entry) => entry.role === 'assistant')) {
        return false;
    }

    if (options.acpSocketPath) {
        return true;
    }

    if (globalStateDb !== resolveQoderGlobalStateDb() || workspaceStorageDir !== resolveQoderWorkspaceStorageDir()) {
        return false;
    }

    const lastActiveAtMs = getLastActiveAtMs(record, state);
    return lastActiveAtMs !== null && Date.now() - lastActiveAtMs <= ACP_RECENT_SESSION_WINDOW_MS;
};

const readAcpTranscriptEntries = async (
    record: QoderSessionRecord,
    state: QoderStateData,
    cliTranscript: QoderCliTranscript,
    options: QoderTranscriptReadOptions,
    globalStateDb: string,
    workspaceStorageDir: string,
): Promise<{ entries: QoderTranscriptEntry[]; model: string | null; socketPath: string | null }> => {
    if (!shouldUseAcp(record, state, cliTranscript, options, globalStateDb, workspaceStorageDir)) {
        return { entries: [], model: null, socketPath: null };
    }

    const loaded = await loadQoderAcpSession({
        cwd: record.worktree,
        drainMs: options.acpDrainMs,
        sessionId: record.sessionId,
        socketPath: options.acpSocketPath ?? resolveQoderAcpSocketPath(),
        taskId: getTaskIdForAcpLoad(record),
        timeoutMs: options.acpTimeoutMs,
    });
    if (!loaded) {
        return { entries: [], model: null, socketPath: null };
    }

    return {
        entries: coalesceQoderMessageChunks(
            loaded.events
                .map((event, index) => parseQoderAcpTranscriptUpdate(event, index))
                .filter((entry): entry is QoderTranscriptEntry => Boolean(entry)),
        ),
        model: getAcpModel(loaded.events),
        socketPath: loaded.socketPath,
    };
};

const buildTranscriptEntries = async (
    record: QoderSessionRecord,
    state: QoderStateData,
    cliProjectsDir: string,
    modelFallback: string | null,
    options: QoderTranscriptReadOptions,
    globalStateDb: string,
    workspaceStorageDir: string,
): Promise<{
    acpSocketPath: string | null;
    cliTranscriptPath: string | null;
    entries: QoderTranscriptEntry[];
    model: string | null;
}> => {
    const { historyEntries, operationEntries } = buildLocalTranscriptEntryGroups(record, state);
    const cliTranscript = await readCliTranscriptEntries(cliProjectsDir, record, modelFallback);
    const acpTranscript = await readAcpTranscriptEntries(
        record,
        state,
        cliTranscript,
        options,
        globalStateDb,
        workspaceStorageDir,
    );
    const transcriptEntries = cliTranscript.entries.some((entry) => entry.role === 'assistant')
        ? cliTranscript.entries
        : acpTranscript.entries;
    const shouldIncludeHistory = !transcriptEntries.some((entry) => entry.role === 'user');

    return {
        acpSocketPath: acpTranscript.socketPath,
        cliTranscriptPath: cliTranscript.path,
        entries: [...(shouldIncludeHistory ? historyEntries : []), ...transcriptEntries, ...operationEntries],
        model: acpTranscript.model ?? cliTranscript.model ?? modelFallback,
    };
};

export const readQoderSessionTranscript = async (
    globalStateDb: string,
    workspaceStorageDir: string,
    sessionId: string,
    cliProjectsDir = resolveQoderCliProjectsDir(),
    options: QoderTranscriptReadOptions = {},
): Promise<QoderSessionTranscript | null> => {
    const { modelConfig, records, workspaceStorageIds } = await loadQoderRecords(globalStateDb, workspaceStorageDir);
    const record = records.find((candidate) => candidate.sessionId === sessionId);
    if (!record) {
        return null;
    }

    const state = await readQoderStateData(workspaceStorageDir, workspaceStorageIds, record);
    const modelFallback = getModelFallback(modelConfig);
    const { acpSocketPath, cliTranscriptPath, entries, model } = await buildTranscriptEntries(
        record,
        state,
        cliProjectsDir,
        modelFallback,
        options,
        globalStateDb,
        workspaceStorageDir,
    );
    const stats = createStatsFromEntries(entries, state.snapshotFileCount);

    return {
        entries,
        rawSession: {
            histories: record.histories.map((history) => history.raw),
            sourceAcpSocketPath: acpSocketPath,
            sourceCliTranscriptPath: cliTranscriptPath,
            sourceStatePath: state.statePath,
            state: state.rawState,
            task: record.task?.raw ?? null,
            workspaceStorageId: record.workspaceStorageId,
        },
        renderablePartCount: stats.renderablePartCount,
        session: toQoderSessionSummary(record, state, stats, model),
    };
};
