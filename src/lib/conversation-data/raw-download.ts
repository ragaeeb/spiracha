import path from 'node:path';
import { zipSync } from 'fflate';
import { resolveUniqueRawExportFileName } from '../ui-export-archive';
import type { ConversationRawDownload } from './types';

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

export const createRawConversationDownload = async (filePath: string): Promise<ConversationRawDownload | null> => {
    const extension = path.extname(filePath).toLowerCase();
    if (extension !== '.json' && extension !== '.jsonl') {
        return null;
    }
    return createNativeFileDownload(filePath);
};

export const createNativeFileDownload = async (filePath: string): Promise<ConversationRawDownload | null> => {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
        return null;
    }

    return {
        blob: file,
        fileName: path.basename(filePath),
        mimeType: mimeTypeForNativeFile(path.basename(filePath)),
    };
};

export const createNativeRawDownload = async (
    filePaths: string[],
    archiveFileName = 'original-assets.zip',
): Promise<ConversationRawDownload | null> => {
    const existing: string[] = [];
    for (const filePath of filePaths) {
        if (await Bun.file(filePath).exists()) {
            existing.push(filePath);
        }
    }
    if (existing.length === 0) {
        return null;
    }
    if (existing.length === 1) {
        return createNativeFileDownload(existing[0]!);
    }

    const usedBaseNames = new Map<string, number>();
    const files: Record<string, Uint8Array> = {};
    for (const filePath of existing) {
        const memberName = resolveUniqueRawExportFileName(path.basename(filePath), usedBaseNames);
        files[memberName] = new Uint8Array(await Bun.file(filePath).arrayBuffer());
    }

    return {
        blob: new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }),
        fileName: path.basename(archiveFileName),
        mimeType: 'application/zip',
    };
};
