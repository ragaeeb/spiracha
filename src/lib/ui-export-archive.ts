import { getPortablePathBasename } from './portable-path';
import type { ExportFormat } from './shared';

type BatchExportNameEntry = {
    cwd: string | null;
    updatedAtMs: number | null;
};

type ConversationExportNameEntry = BatchExportNameEntry & {
    id: string;
};

export const sanitizeExportFileName = (value: string) => {
    return value
        .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, ' ')
        .replace(/\.\.+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
};

export const getExportMimeType = (outputFormat: ExportFormat) => {
    return outputFormat === 'md' ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8';
};

export const resolveUniqueExportFileBaseName = (baseName: string, usedCounts: Map<string, number>) => {
    const normalizeKey = (value: string) => value.normalize('NFC').toLowerCase();
    const baseKey = normalizeKey(baseName);
    let count = (usedCounts.get(baseKey) ?? 0) + 1;
    let candidate = count === 1 ? baseName : `${baseName}-${count}`;

    while (usedCounts.has(normalizeKey(candidate))) {
        count += 1;
        candidate = `${baseName}-${count}`;
    }

    usedCounts.set(baseKey, count);
    usedCounts.set(normalizeKey(candidate), Math.max(usedCounts.get(normalizeKey(candidate)) ?? 0, 1));
    return candidate;
};

const formatBatchExportDate = (value: number) => {
    const date = new Date(value);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}-${hours}${minutes}`;
};

const resolveExportProjectName = (cwd: string | null, fallbackProjectName: string) => {
    return sanitizeExportFileName(getPortablePathBasename(cwd ?? '') || fallbackProjectName) || 'threads';
};

export const buildConversationExportBaseName = (
    { cwd, id, updatedAtMs }: ConversationExportNameEntry,
    fallbackProjectName: string,
) => {
    const projectName = resolveExportProjectName(cwd, fallbackProjectName);
    const shortId = sanitizeExportFileName(id).slice(0, 8) || 'conversation';
    return Number.isFinite(updatedAtMs) && (updatedAtMs ?? 0) > 0
        ? `${projectName}-${formatBatchExportDate(updatedAtMs!)}-${shortId}`
        : `${projectName}-${shortId}`;
};

export const buildBatchExportBaseName = (entries: BatchExportNameEntry[], fallbackProjectName: string) => {
    if (entries.length === 0) {
        throw new Error('No conversations selected for export');
    }

    const firstCwd = entries.find((entry) => entry.cwd?.trim())?.cwd ?? null;
    const projectName = resolveExportProjectName(firstCwd, fallbackProjectName);
    const latestUpdatedAtMs = Math.max(
        ...entries.map((entry) => (Number.isFinite(entry.updatedAtMs) ? (entry.updatedAtMs ?? 0) : 0)),
    );

    return latestUpdatedAtMs > 0
        ? `${projectName}-${formatBatchExportDate(latestUpdatedAtMs)}-threads-${entries.length}`
        : `${projectName}-threads-${entries.length}`;
};
