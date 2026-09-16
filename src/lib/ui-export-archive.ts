import { SOURCE_CATALOG } from './conversation-data/source-catalog';
import type { ConversationSource } from './conversation-data/types';
import { getNumericMaximum } from './numeric-range';
import { getPortablePathBasename } from './portable-path';
import type { ExportFormat } from './shared-text';

export const EXPORT_ARCHIVE_MANIFEST_FILE = 'spiracha-manifest.json';
export const EXPORT_ARCHIVE_MANIFEST_SCHEMA_VERSION = 1;

export type ExportPlatform = (typeof SOURCE_CATALOG)[ConversationSource]['exportPlatform'];

type BatchExportNameEntry = {
    cwd: string | null;
    updatedAtMs: number | null;
};

type ConversationExportNameEntry = BatchExportNameEntry & {
    id: string;
};

export const sanitizeExportFileName = (value: string) => {
    const sanitized = value
        .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, ' ')
        .replace(/\.\.+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .replace(/[. ]+$/gu, '');
    return /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(sanitized) ? `_${sanitized}` : sanitized;
};

export const buildRawConversationExportFileName = (
    source: ConversationSource,
    id: string,
    originalFileName: string,
) => {
    const original = sanitizeExportFileName(getPortablePathBasename(originalFileName));
    return original || `${sanitizeExportFileName(`${source}-${id}`) || 'conversation'}.bin`;
};

const splitExportFileName = (fileName: string) => {
    const dot = fileName.lastIndexOf('.');
    return dot > 0
        ? { base: fileName.slice(0, dot), extension: fileName.slice(dot) }
        : { base: fileName, extension: '' };
};

export const resolveUniqueRawExportFileName = (fileName: string, usedCounts: Map<string, number>) => {
    const key = (value: string) => value.normalize('NFC').toLowerCase();
    const { base, extension } = splitExportFileName(fileName);
    let count = (usedCounts.get(key(fileName)) ?? 0) + 1;
    let candidate = count === 1 ? fileName : `${base}-${count}${extension}`;
    while (usedCounts.has(key(candidate))) {
        count += 1;
        candidate = `${base}-${count}${extension}`;
    }
    usedCounts.set(key(fileName), count);
    usedCounts.set(key(candidate), Math.max(usedCounts.get(key(candidate)) ?? 0, 1));
    return candidate;
};

export const getExportPlatformName = (source: ConversationSource): ExportPlatform =>
    SOURCE_CATALOG[source].exportPlatform;

const truncateExportName = (value: string, maxBytes: number): string => {
    const encoder = new TextEncoder();
    let bytes = 0;
    let result = '';
    for (const character of value) {
        const characterBytes = encoder.encode(character).byteLength;
        if (bytes + characterBytes > maxBytes) {
            break;
        }
        bytes += characterBytes;
        result += character;
    }
    return result;
};

export const NORMALIZED_EXPORT_BASE_NAME_BYTE_LIMIT = 120;

export const boundNormalizedExportBaseName = (title: string | null | undefined, fallback: string) => {
    const sanitized = sanitizeExportFileName(title?.trim() || '') || sanitizeExportFileName(fallback) || 'conversation';
    return truncateExportName(sanitized, NORMALIZED_EXPORT_BASE_NAME_BYTE_LIMIT) || 'conversation';
};

export const buildExportArchiveBaseName = (platform: string, baseName: string) =>
    truncateExportName(`${platform}_${sanitizeExportFileName(baseName) || 'export'}`, 150);

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
    return truncateExportName(
        sanitizeExportFileName(getPortablePathBasename(cwd ?? '') || fallbackProjectName) || 'threads',
        80,
    );
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
    const latestUpdatedAtMs = getNumericMaximum(
        entries.map((entry) => (Number.isFinite(entry.updatedAtMs) ? (entry.updatedAtMs ?? 0) : 0)),
    );

    return latestUpdatedAtMs > 0
        ? `${projectName}-${formatBatchExportDate(latestUpdatedAtMs)}-threads-${entries.length}`
        : `${projectName}-threads-${entries.length}`;
};
