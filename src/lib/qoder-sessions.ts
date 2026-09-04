import { mapWithConcurrency } from './concurrency';
import { getPortablePathBasename } from './portable-path';
import type { QoderSessionSummary, QoderWorkspaceGroup } from './qoder-exporter-types';
import { resolveQoderGlobalStateDb, resolveQoderWorkspaceStorageDir } from './qoder-exporter-types';
import {
    getModelFallback,
    getWorkspaceKey,
    getWorkspaceLabel,
    getWorkspaceUri,
    getWorktreeFromWorkspaceKey,
    loadQoderRecords,
    maxNullable,
    readQoderRecordSummary,
    type SessionStats,
    toIso,
} from './qoder-storage';
import { isWorkspacePathQuery, workspacePathMatchesQuery } from './shared';

const READ_CONCURRENCY = 8;

const compareNullableMsDesc = (left: number | null, right: number | null): number => {
    return (right ?? 0) - (left ?? 0);
};

const sumSessions = (sessions: QoderSessionSummary[], key: keyof SessionStats): number => {
    return sessions.reduce((total, session) => total + session[key], 0);
};

const toWorkspaceGroup = (worktree: string, sessions: QoderSessionSummary[]): QoderWorkspaceGroup => {
    const lastActiveAtMs = sessions.reduce<number | null>((latest, session) => {
        return maxNullable(latest, session.lastActiveAtMs);
    }, null);

    return {
        assistantMessageCount: sumSessions(sessions, 'assistantMessageCount'),
        fileOperationCount: sumSessions(sessions, 'fileOperationCount'),
        key: getWorkspaceKey(worktree),
        label: getWorkspaceLabel(worktree),
        lastActiveAtIso: toIso(lastActiveAtMs),
        lastActiveAtMs,
        messageCount: sumSessions(sessions, 'messageCount'),
        renderablePartCount: sumSessions(sessions, 'renderablePartCount'),
        sessionCount: sessions.length,
        snapshotFileCount: sumSessions(sessions, 'snapshotFileCount'),
        uri: getWorkspaceUri(worktree),
        userMessageCount: sumSessions(sessions, 'userMessageCount'),
        workspaceStorageIds: [...new Set(sessions.flatMap((session) => session.workspaceStorageId ?? []))],
        worktree,
    };
};

export const listQoderWorkspaceGroups = async (
    globalStateDb = resolveQoderGlobalStateDb(),
    workspaceStorageDir = resolveQoderWorkspaceStorageDir(),
): Promise<QoderWorkspaceGroup[]> => {
    const { modelConfig, records, workspaceStorageIds } = await loadQoderRecords(globalStateDb, workspaceStorageDir);
    const modelFallback = getModelFallback(modelConfig);
    const summaries = await mapWithConcurrency(records, READ_CONCURRENCY, (record) =>
        readQoderRecordSummary(record, workspaceStorageDir, workspaceStorageIds, modelFallback),
    );
    const sessionsByWorktree = new Map<string, QoderSessionSummary[]>();

    for (const session of summaries) {
        const sessions = sessionsByWorktree.get(session.worktree) ?? [];
        sessions.push(session);
        sessionsByWorktree.set(session.worktree, sessions);
    }

    return [...sessionsByWorktree.entries()]
        .map(([worktree, sessions]) => toWorkspaceGroup(worktree, sessions))
        .sort(
            (left, right) =>
                compareNullableMsDesc(left.lastActiveAtMs, right.lastActiveAtMs) ||
                left.worktree.localeCompare(right.worktree),
        );
};

const qoderWorkspaceMatchesQuery = (workspace: QoderWorkspaceGroup, query: string): boolean => {
    const raw = query.trim();
    if (!raw) {
        return true;
    }

    const lowered = raw.toLowerCase();
    if (workspace.key.toLowerCase() === lowered || workspace.label.toLowerCase() === lowered) {
        return true;
    }

    if (isWorkspacePathQuery(raw)) {
        return workspacePathMatchesQuery(workspace.worktree, raw);
    }

    return getPortablePathBasename(workspace.worktree).toLowerCase() === lowered;
};

export const findQoderWorkspaceGroups = (groups: QoderWorkspaceGroup[], query: string): QoderWorkspaceGroup[] => {
    return groups.filter((group) => qoderWorkspaceMatchesQuery(group, query));
};

const sortSessions = (sessions: QoderSessionSummary[]): QoderSessionSummary[] => {
    return [...sessions].sort(
        (left, right) =>
            compareNullableMsDesc(left.lastActiveAtMs, right.lastActiveAtMs) || left.title.localeCompare(right.title),
    );
};

export const listQoderSessionsForGroup = async (
    workspaceKey: string,
    globalStateDb = resolveQoderGlobalStateDb(),
    workspaceStorageDir = resolveQoderWorkspaceStorageDir(),
): Promise<QoderSessionSummary[]> => {
    const worktree = getWorktreeFromWorkspaceKey(workspaceKey);
    if (!worktree) {
        return [];
    }

    const { modelConfig, records, workspaceStorageIds } = await loadQoderRecords(globalStateDb, workspaceStorageDir);
    const matchingRecords = records.filter((record) => record.worktree === worktree);
    const modelFallback = getModelFallback(modelConfig);
    const summaries = await mapWithConcurrency(matchingRecords, READ_CONCURRENCY, (record) =>
        readQoderRecordSummary(record, workspaceStorageDir, workspaceStorageIds, modelFallback),
    );
    return sortSessions(summaries);
};
