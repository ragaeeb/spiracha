import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';
import {
    EXPORT_ARCHIVE_MANIFEST_FILE,
    EXPORT_ARCHIVE_MANIFEST_SCHEMA_VERSION,
    resolveUniqueRawExportFileName,
    sanitizeExportFileName,
} from '../ui-export-archive';
import { SourceChangedError } from './operation-types';
import type { ConversationRawDownload } from './types';

export type NativeFileIdentity = {
    ctimeMs: number;
    dev: number;
    ino: number;
    mtimeMs: number;
    size: number;
};

const mimeTypeForNativeFile = (fileName: string): ConversationRawDownload['mimeType'] => {
    const extension = path.extname(fileName).toLowerCase();
    if (extension === '.jsonl') {
        return 'application/x-ndjson';
    }
    if (extension === '.json') {
        return 'application/json';
    }
    if (extension === '.zip') {
        return 'application/zip';
    }
    return 'application/octet-stream';
};

const identitiesMatch = (left: NativeFileIdentity, right: NativeFileIdentity) =>
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;

export const captureNativeFileIdentity = async (filePath: string): Promise<NativeFileIdentity | null> => {
    try {
        const info = await lstat(filePath);
        if (!info.isFile() || info.isSymbolicLink()) {
            return null;
        }
        return {
            ctimeMs: info.ctimeMs,
            dev: info.dev,
            ino: info.ino,
            mtimeMs: info.mtimeMs,
            size: info.size,
        };
    } catch {
        return null;
    }
};

export const readNativeFileBytes = async (
    filePath: string,
    expected?: NativeFileIdentity,
): Promise<Uint8Array | null> => {
    const before = expected ?? (await captureNativeFileIdentity(filePath));
    if (!before) {
        return null;
    }

    const bytes = new Uint8Array(await Bun.file(filePath).arrayBuffer());
    const after = await captureNativeFileIdentity(filePath);
    if (!after || !identitiesMatch(before, after) || bytes.byteLength !== before.size) {
        throw new SourceChangedError();
    }
    return bytes;
};

const nativeArchiveMemberName = (filePath: string, usedBaseNames: Map<string, number>) =>
    resolveUniqueRawExportFileName(
        sanitizeExportFileName(path.basename(filePath)) || 'conversation.bin',
        usedBaseNames,
    );

const nativeFileSetManifest = (memberNames: string[]) => ({
    entries: memberNames.map((memberName) => ({
        error: null,
        memberNames: [memberName],
        omissionSummary: null,
        requestedId: memberName,
        status: 'exported' as const,
    })),
    failedCount: 0,
    failurePolicy: 'atomic' as const,
    generated: true as const,
    kind: 'original_raw',
    missingCount: 0,
    options: {},
    requestedCount: memberNames.length,
    schemaVersion: EXPORT_ARCHIVE_MANIFEST_SCHEMA_VERSION,
    source: 'native_file_set',
    successCount: memberNames.length,
});

export const createRawConversationDownload = async (filePath: string): Promise<ConversationRawDownload | null> => {
    const extension = path.extname(filePath).toLowerCase();
    if (extension !== '.json' && extension !== '.jsonl') {
        return null;
    }
    return createNativeFileDownload(filePath);
};

export const createNativeFileDownload = async (filePath: string): Promise<ConversationRawDownload | null> => {
    const bytes = await readNativeFileBytes(filePath);
    if (!bytes) {
        return null;
    }

    const fileName = path.basename(filePath);
    return {
        blob: new Blob([Buffer.from(bytes)]),
        fileName,
        mimeType: mimeTypeForNativeFile(fileName),
    };
};

export const createNativeRawDownload = async (
    filePaths: string[],
    archiveFileName = 'original-assets.zip',
): Promise<ConversationRawDownload | null> => {
    const existing: string[] = [];
    for (const filePath of filePaths) {
        if (await captureNativeFileIdentity(filePath)) {
            existing.push(filePath);
        }
    }
    if (existing.length === 0) {
        return null;
    }
    if (existing.length === 1) {
        return createNativeFileDownload(existing[0]!);
    }

    const usedBaseNames = new Map<string, number>([[EXPORT_ARCHIVE_MANIFEST_FILE.toLowerCase(), 1]]);
    const files: Record<string, Uint8Array> = {};
    const memberNames: string[] = [];
    for (const filePath of existing) {
        const bytes = await readNativeFileBytes(filePath);
        if (!bytes) {
            throw new SourceChangedError();
        }
        const memberName = nativeArchiveMemberName(filePath, usedBaseNames);
        files[memberName] = bytes;
        memberNames.push(memberName);
    }
    files[EXPORT_ARCHIVE_MANIFEST_FILE] = new TextEncoder().encode(
        `${JSON.stringify(nativeFileSetManifest(memberNames), null, 2)}\n`,
    );

    return {
        blob: new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }),
        fileName: path.basename(archiveFileName),
        mimeType: 'application/zip',
    };
};
