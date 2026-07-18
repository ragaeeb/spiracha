import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveUniqueExportFileBaseName, sanitizeExportFileName } from './ui-export-archive';
import { zipExportDirectory } from './ui-export-zip';

type ConversationMarkdownZipEntry = {
    fallbackBaseName: string;
    markdown: string;
    title: string | null;
};

type ConversationMarkdownZipOptions = {
    entries: ConversationMarkdownZipEntry[];
    fileBaseName: string;
};

const EXPORT_BASE_NAME_BYTE_LIMIT = 120;

const truncateUtf8 = (value: string, maxBytes: number) => {
    let bytes = 0;
    let result = '';
    for (const character of value) {
        const characterBytes = Buffer.byteLength(character);
        if (bytes + characterBytes > maxBytes) {
            break;
        }
        bytes += characterBytes;
        result += character;
    }
    return result;
};

export type ConversationMarkdownZip = {
    blob: Blob;
    fileName: string;
    mimeType: 'application/zip';
};

const toSafeFileBaseName = (value: string | null, fallback: string) => {
    const sanitized = sanitizeExportFileName(value?.trim() || '') || sanitizeExportFileName(fallback) || 'conversation';
    return truncateUtf8(sanitized, EXPORT_BASE_NAME_BYTE_LIMIT) || 'conversation';
};

export const createConversationMarkdownZip = async ({
    entries,
    fileBaseName,
}: ConversationMarkdownZipOptions): Promise<ConversationMarkdownZip> => {
    if (entries.length === 0) {
        throw new Error('No conversations selected for export');
    }

    const safeBaseName = toSafeFileBaseName(fileBaseName, 'conversations');
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), `${safeBaseName}-`));
    const zipPath = path.join(os.tmpdir(), `${safeBaseName}-${randomUUID()}.zip`);
    const usedBaseNames = new Map<string, number>();

    try {
        for (const entry of entries) {
            const entryBaseName = toSafeFileBaseName(entry.title, entry.fallbackBaseName);
            const fileBaseNameForEntry = resolveUniqueExportFileBaseName(entryBaseName, usedBaseNames);
            await Bun.write(path.join(workspaceDir, `${fileBaseNameForEntry}.md`), entry.markdown);
        }

        await zipExportDirectory(workspaceDir, zipPath);
        return {
            blob: new Blob([await Bun.file(zipPath).arrayBuffer()], { type: 'application/zip' }),
            fileName: `${safeBaseName}.zip`,
            mimeType: 'application/zip',
        };
    } finally {
        await Promise.all([rm(workspaceDir, { force: true, recursive: true }), rm(zipPath, { force: true })]);
    }
};
