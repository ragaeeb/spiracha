import { DEFAULT_EXPORT_DIALOG_OPTIONS, type ExportDialogOptions } from '#/lib/export-options';

export type Settings = {
    convertToProjectRoot: boolean;
    exportDefaults: ExportDialogOptions;
    redactUsername: boolean;
};

export const SETTINGS_COOKIE_NAME = 'spiracha-settings';

export const DEFAULT_SETTINGS: Settings = {
    convertToProjectRoot: false,
    exportDefaults: DEFAULT_EXPORT_DIALOG_OPTIONS,
    redactUsername: false,
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const booleanOrDefault = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

const parseExportDefaults = (value: unknown): ExportDialogOptions => {
    const record = asRecord(value);
    if (!record) {
        return DEFAULT_EXPORT_DIALOG_OPTIONS;
    }

    return {
        includeCommentary: booleanOrDefault(record.includeCommentary, DEFAULT_EXPORT_DIALOG_OPTIONS.includeCommentary),
        includeMetadata: booleanOrDefault(record.includeMetadata, DEFAULT_EXPORT_DIALOG_OPTIONS.includeMetadata),
        includeTools: booleanOrDefault(record.includeTools, DEFAULT_EXPORT_DIALOG_OPTIONS.includeTools),
        outputFormat:
            record.outputFormat === 'txt' || record.outputFormat === 'md'
                ? record.outputFormat
                : DEFAULT_EXPORT_DIALOG_OPTIONS.outputFormat,
        zipArchive: booleanOrDefault(record.zipArchive, DEFAULT_EXPORT_DIALOG_OPTIONS.zipArchive),
    };
};

export const normalizeSettings = (value: unknown): Settings => {
    const record = asRecord(value);
    if (!record) {
        return DEFAULT_SETTINGS;
    }

    return {
        convertToProjectRoot: booleanOrDefault(record.convertToProjectRoot, DEFAULT_SETTINGS.convertToProjectRoot),
        exportDefaults: parseExportDefaults(record.exportDefaults),
        redactUsername: booleanOrDefault(record.redactUsername, DEFAULT_SETTINGS.redactUsername),
    };
};

export const parseSerializedSettings = (serialized: string | null | undefined): Settings => {
    if (!serialized) {
        return DEFAULT_SETTINGS;
    }

    try {
        return normalizeSettings(JSON.parse(decodeURIComponent(serialized)));
    } catch {
        return DEFAULT_SETTINGS;
    }
};

export const serializeSettings = (settings: Settings) => JSON.stringify(settings);
