import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mapSettledWithConcurrency } from './concurrency';
import type { BatchFailurePolicy } from './conversation-data/export-options';
import {
    buildExportArchiveBaseName,
    EXPORT_ARCHIVE_MANIFEST_FILE,
    EXPORT_ARCHIVE_MANIFEST_SCHEMA_VERSION,
    resolveUniqueRawExportFileName,
} from './ui-export-archive';
import { buildUiExportDownloadUrl, ensureUiExportDir, reserveExportBytes } from './ui-export-files';
import { zipExportDirectory } from './ui-export-zip';

export { EXPORT_ARCHIVE_MANIFEST_FILE, EXPORT_ARCHIVE_MANIFEST_SCHEMA_VERSION };

const BATCH_LOAD_CONCURRENCY = 4;

export type ExportArchiveMember = {
    bytes: string | Uint8Array;
    generated?: boolean;
    relativePath: string;
};

export type ExportArchiveOutcomeStatus = 'exported' | 'failed' | 'missing';

export type ExportArchiveOutcome = {
    error: { code: string; message: string } | null;
    memberNames: string[];
    omissionSummary: string | null;
    requestedId: string;
    status: ExportArchiveOutcomeStatus;
};

export type ExportArchiveManifest = {
    entries: ExportArchiveOutcome[];
    failedCount: number;
    failurePolicy: BatchFailurePolicy;
    kind: string;
    missingCount: number;
    options: Record<string, unknown>;
    requestedCount: number;
    schemaVersion: typeof EXPORT_ARCHIVE_MANIFEST_SCHEMA_VERSION;
    source: string;
    successCount: number;
};

export type ExportArchiveBlob = {
    blob: Blob;
    fileName: string;
    mimeType: 'application/zip';
};

export type ExportArchiveDownloadUrl = {
    downloadUrl: string;
    fileName: string;
    mimeType: 'application/zip';
};

export type ConversationZipCleanupFailure = {
    error: string;
    path: string;
};

export class AtomicExportError extends Error {
    readonly failedIds: string[];
    readonly missingIds: string[];
    readonly outcomes: ExportArchiveOutcome[];

    constructor(outcomes: ExportArchiveOutcome[]) {
        const missingIds = outcomes
            .filter((outcome) => outcome.status === 'missing')
            .map((outcome) => outcome.requestedId);
        super('Some conversations do not exist for that source and id set.');
        this.name = 'AtomicExportError';
        this.failedIds = outcomes
            .filter((outcome) => outcome.status === 'failed')
            .map((outcome) => outcome.requestedId);
        this.missingIds = missingIds;
        this.outcomes = outcomes;
    }
}

export class EmptyPartialExportError extends Error {
    readonly outcomes: ExportArchiveOutcome[];

    constructor(outcomes: ExportArchiveOutcome[]) {
        super('No exportable conversations');
        this.name = 'EmptyPartialExportError';
        this.outcomes = outcomes;
    }
}

const throwIfAborted = (signal?: AbortSignal) => {
    if (!signal?.aborted) {
        return;
    }
    throw signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted.', 'AbortError');
};

const memberByteLength = (member: ExportArchiveMember) =>
    typeof member.bytes === 'string' ? Buffer.byteLength(member.bytes) : member.bytes.byteLength;

const toArchiveBytes = (value: string | Uint8Array) => (typeof value === 'string' ? value : new Uint8Array(value));

const isSafeArchiveMemberName = (value: string) =>
    value.length > 0 &&
    value === path.posix.basename(value) &&
    !value.includes('..') &&
    !value.includes('\0') &&
    !/[\\/]/u.test(value);

const MANIFEST_OPTION_KEYS = [
    'failurePolicy',
    'includeCommentary',
    'includeMetadata',
    'includeTools',
    'messageSelector',
    'outputFormat',
] as const;

const safeManifestOptions = (options: Record<string, unknown>) =>
    Object.fromEntries(MANIFEST_OPTION_KEYS.flatMap((key) => (key in options ? [[key, options[key]]] : []))) as Record<
        string,
        unknown
    >;

export const cleanupConversationZipArtifacts = async (
    workspaceDir: string,
    zipPath?: string | null,
    remove: typeof rm = rm,
): Promise<ConversationZipCleanupFailure[]> => {
    const resolvedWorkspace = path.resolve(workspaceDir);
    const resolvedZip = zipPath ? path.resolve(zipPath) : null;
    const zipInsideWorkspace = Boolean(resolvedZip?.startsWith(`${resolvedWorkspace}${path.sep}`));
    const sameTarget = resolvedZip !== null && resolvedZip === resolvedWorkspace;
    const jobs =
        resolvedZip === null || zipInsideWorkspace || sameTarget
            ? [{ options: { force: true, recursive: true } as const, target: workspaceDir }]
            : [
                  { options: { force: true, recursive: true } as const, target: workspaceDir },
                  { options: { force: true } as const, target: zipPath! },
              ];
    const results = await Promise.allSettled(jobs.map((job) => remove(job.target, job.options)));
    return results.flatMap((result, index) =>
        result.status === 'rejected'
            ? [
                  {
                      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
                      path: jobs[index]!.target,
                  },
              ]
            : [],
    );
};

const missingOutcome = (requestedId: string): ExportArchiveOutcome => ({
    error: { code: 'missing', message: `Conversation not found: ${requestedId}` },
    memberNames: [],
    omissionSummary: null,
    requestedId,
    status: 'missing',
});

const failedOutcome = (requestedId: string, error: unknown): ExportArchiveOutcome => ({
    error: {
        code: 'failed',
        message: error instanceof Error ? error.message : String(error),
    },
    memberNames: [],
    omissionSummary: null,
    requestedId,
    status: 'failed',
});

const exportedOutcome = (
    requestedId: string,
    memberNames: string[],
    omissionSummary: string | null,
): ExportArchiveOutcome => ({
    error: null,
    memberNames,
    omissionSummary,
    requestedId,
    status: 'exported',
});

const buildManifest = ({
    entries,
    failurePolicy,
    kind,
    options,
    source,
}: {
    entries: ExportArchiveOutcome[];
    failurePolicy: BatchFailurePolicy;
    kind: string;
    options: Record<string, unknown>;
    source: string;
}): ExportArchiveManifest => ({
    entries,
    failedCount: entries.filter((entry) => entry.status === 'failed').length,
    failurePolicy,
    kind,
    missingCount: entries.filter((entry) => entry.status === 'missing').length,
    options: safeManifestOptions(options),
    requestedCount: entries.length,
    schemaVersion: EXPORT_ARCHIVE_MANIFEST_SCHEMA_VERSION,
    source,
    successCount: entries.filter((entry) => entry.status === 'exported').length,
});

export const assembleExportBatch = async ({
    failurePolicy,
    kind,
    load,
    options,
    requestedIds,
    signal,
    source,
}: {
    failurePolicy: BatchFailurePolicy;
    kind: string;
    load: (
        id: string,
        signal?: AbortSignal,
    ) => Promise<{ members: ExportArchiveMember[]; omissionSummary?: string | null } | null>;
    options: Record<string, unknown>;
    requestedIds: readonly string[];
    signal?: AbortSignal;
    source: string;
}): Promise<{ manifest: ExportArchiveManifest; members: ExportArchiveMember[] }> => {
    throwIfAborted(signal);
    const settled = await mapSettledWithConcurrency(
        [...requestedIds],
        BATCH_LOAD_CONCURRENCY,
        (id) => load(id, signal),
        signal,
    );
    const usedNames = new Map<string, number>([[EXPORT_ARCHIVE_MANIFEST_FILE.normalize('NFC').toLowerCase(), 1]]);
    const members: ExportArchiveMember[] = [];
    const entries: ExportArchiveOutcome[] = settled.map((result, index) => {
        const requestedId = requestedIds[index]!;
        if (result.status === 'cancelled') {
            return failedOutcome(requestedId, new DOMException('The operation was aborted.', 'AbortError'));
        }
        if (result.status === 'rejected') {
            return failedOutcome(requestedId, result.reason);
        }
        if (result.value === null) {
            return missingOutcome(requestedId);
        }
        const memberNames = result.value.members.map((member) => {
            const relativePath = resolveUniqueRawExportFileName(member.relativePath, usedNames);
            members.push({ ...member, relativePath });
            return relativePath;
        });
        return exportedOutcome(requestedId, memberNames, result.value.omissionSummary ?? null);
    });
    const manifest = buildManifest({ entries, failurePolicy, kind, options, source });
    if (failurePolicy === 'atomic') {
        const firstRejection = settled.find((result) => result.status === 'rejected');
        if (firstRejection && firstRejection.status === 'rejected') {
            throw firstRejection.reason;
        }
        if (manifest.failedCount > 0 || manifest.missingCount > 0) {
            throw new AtomicExportError(entries);
        }
    } else if (manifest.successCount === 0) {
        throw new EmptyPartialExportError(entries);
    }
    return { manifest, members };
};

const withGeneratedManifest = (
    members: readonly ExportArchiveMember[],
    manifest?: ExportArchiveManifest,
): ExportArchiveMember[] => [
    ...members,
    ...(manifest
        ? [
              {
                  bytes: `${JSON.stringify({ ...manifest, options: safeManifestOptions(manifest.options) }, null, 2)}\n`,
                  generated: true,
                  relativePath: EXPORT_ARCHIVE_MANIFEST_FILE,
              } satisfies ExportArchiveMember,
          ]
        : []),
];

const assertSafeArchiveMembers = (members: readonly ExportArchiveMember[]) => {
    for (const member of members) {
        if (!isSafeArchiveMemberName(member.relativePath)) {
            throw new Error(`Unsafe archive member name: ${member.relativePath}`);
        }
    }
};

const writeArchiveMembers = async (
    entriesDir: string,
    members: readonly ExportArchiveMember[],
    signal?: AbortSignal,
) => {
    for (const member of members) {
        throwIfAborted(signal);
        await Bun.write(path.join(entriesDir, member.relativePath), toArchiveBytes(member.bytes));
    }
};

const publishedArchive = async (
    destination: { mode: 'blob' } | { exportDir?: string; mode: 'download_url' },
    zipPath: string,
    fileName: string,
): Promise<ExportArchiveBlob | ExportArchiveDownloadUrl> => {
    if (destination.mode === 'blob') {
        return {
            blob: new Blob([await Bun.file(zipPath).arrayBuffer()], { type: 'application/zip' }),
            fileName,
            mimeType: 'application/zip',
        };
    }
    return {
        downloadUrl: buildUiExportDownloadUrl(zipPath),
        fileName,
        mimeType: 'application/zip',
    };
};

export const writeExportArchive = async ({
    baseName,
    destination,
    manifest,
    members,
    platform,
    signal,
    zipPassword,
}: {
    baseName: string;
    destination: { mode: 'blob' } | { exportDir?: string; mode: 'download_url' };
    manifest?: ExportArchiveManifest;
    members: readonly ExportArchiveMember[];
    platform: string;
    signal?: AbortSignal;
    zipPassword?: string;
}): Promise<ExportArchiveBlob | ExportArchiveDownloadUrl> => {
    if (members.length === 0 && !manifest) {
        throw new Error('No conversations selected for export');
    }
    throwIfAborted(signal);

    const archiveMembers = withGeneratedManifest(members, manifest);
    assertSafeArchiveMembers(archiveMembers);

    const estimatedBytes = archiveMembers.reduce((total, member) => total + memberByteLength(member), 0);
    const publishDir =
        destination.mode === 'download_url' ? (destination.exportDir ?? (await ensureUiExportDir())) : undefined;
    const reservation = await reserveExportBytes(estimatedBytes, {
        countRetained: destination.mode === 'download_url',
        ...(publishDir ? { exportDir: publishDir } : {}),
    });

    const archiveBaseName = buildExportArchiveBaseName(platform, baseName);
    let workspaceDir: string | undefined;
    let zipPath: string | undefined;
    let published = false;

    try {
        throwIfAborted(signal);
        workspaceDir = await mkdtemp(path.join(os.tmpdir(), `${archiveBaseName}-`));
        const entriesDir = path.join(workspaceDir, 'entries');
        zipPath =
            destination.mode === 'blob'
                ? path.join(workspaceDir, 'archive.zip')
                : path.join(publishDir!, `${archiveBaseName}-${randomUUID()}.zip`);
        await mkdir(entriesDir, { mode: 0o700 });
        await writeArchiveMembers(entriesDir, archiveMembers, signal);
        throwIfAborted(signal);
        await zipExportDirectory(entriesDir, zipPath, zipPassword);
        throwIfAborted(signal);
        const archive = await publishedArchive(destination, zipPath, `${archiveBaseName}.zip`);
        published = true;
        return archive;
    } finally {
        reservation.release();
        if (workspaceDir) {
            const cleanupFailures = await cleanupConversationZipArtifacts(
                workspaceDir,
                published && destination.mode === 'download_url' ? undefined : zipPath,
            );
            for (const failure of cleanupFailures) {
                console.warn('[spiracha:export] temporary cleanup failed', failure);
            }
        }
    }
};
