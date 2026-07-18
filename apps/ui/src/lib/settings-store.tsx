import { createContext, type ReactNode, useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import { DEFAULT_EXPORT_DIALOG_OPTIONS, type ExportDialogOptions } from '#/lib/export-options';

export type Settings = {
    convertToProjectRoot: boolean;
    exportDefaults: ExportDialogOptions;
    redactUsername: boolean;
};

type SettingsContextValue = {
    settings: Settings;
    updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
};

const STORAGE_KEY = 'spiracha-settings';

export const DEFAULT_SETTINGS: Settings = {
    convertToProjectRoot: false,
    exportDefaults: DEFAULT_EXPORT_DIALOG_OPTIONS,
    redactUsername: false,
};

const SettingsContext = createContext<SettingsContextValue>({
    settings: DEFAULT_SETTINGS,
    updateSetting: () => {},
});

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

const parseSettings = (serialized: string | null): Settings => {
    if (!serialized) {
        return DEFAULT_SETTINGS;
    }

    try {
        const record = asRecord(JSON.parse(serialized));
        if (!record) {
            return DEFAULT_SETTINGS;
        }

        return {
            convertToProjectRoot: booleanOrDefault(record.convertToProjectRoot, DEFAULT_SETTINGS.convertToProjectRoot),
            exportDefaults: parseExportDefaults(record.exportDefaults),
            redactUsername: booleanOrDefault(record.redactUsername, DEFAULT_SETTINGS.redactUsername),
        };
    } catch {
        return DEFAULT_SETTINGS;
    }
};

const subscribers = new Set<() => void>();
let cachedSerializedSettings: string | null | undefined;
let cachedSettings = DEFAULT_SETTINGS;
let preserveVolatileSettings = false;
let listeningForStorageChanges = false;

const getBrowserSettingsSnapshot = () => {
    if (typeof window === 'undefined') {
        return DEFAULT_SETTINGS;
    }
    if (preserveVolatileSettings) {
        return cachedSettings;
    }

    let serialized: string | null;
    try {
        serialized = window.localStorage.getItem(STORAGE_KEY);
    } catch {
        return cachedSettings;
    }

    if (serialized !== cachedSerializedSettings) {
        cachedSerializedSettings = serialized;
        cachedSettings = parseSettings(serialized);
    }
    return cachedSettings;
};

const getServerSettingsSnapshot = () => DEFAULT_SETTINGS;

const notifySubscribers = () => {
    for (const subscriber of subscribers) {
        subscriber();
    }
};

const handleStorageChange = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) {
        return;
    }

    preserveVolatileSettings = false;
    cachedSerializedSettings = event.newValue;
    cachedSettings = parseSettings(event.newValue);
    notifySubscribers();
};

const subscribeToSettings = (subscriber: () => void) => {
    subscribers.add(subscriber);
    if (!listeningForStorageChanges && typeof window !== 'undefined') {
        window.addEventListener('storage', handleStorageChange);
        listeningForStorageChanges = true;
    }

    return () => {
        subscribers.delete(subscriber);
        if (subscribers.size === 0 && listeningForStorageChanges && typeof window !== 'undefined') {
            window.removeEventListener('storage', handleStorageChange);
            listeningForStorageChanges = false;
        }
    };
};

const storeSettings = (settings: Settings) => {
    const serialized = JSON.stringify(settings);
    cachedSettings = settings;
    cachedSerializedSettings = serialized;
    preserveVolatileSettings = false;

    try {
        window.localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
        preserveVolatileSettings = true;
    }
    notifySubscribers();
};

export function SettingsProvider({ children }: { children: ReactNode }) {
    const settings = useSyncExternalStore(subscribeToSettings, getBrowserSettingsSnapshot, getServerSettingsSnapshot);
    const updateSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
        storeSettings({ ...getBrowserSettingsSnapshot(), [key]: value });
    }, []);
    const contextValue = useMemo(() => ({ settings, updateSetting }), [settings, updateSetting]);

    return <SettingsContext.Provider value={contextValue}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);
