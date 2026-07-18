import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';

export type Settings = {
    convertToProjectRoot: boolean;
    redactUsername: boolean;
};

type SettingsContextValue = {
    settings: Settings;
    updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
};

const STORAGE_KEY = 'spiracha-settings';

const defaultSettings: Settings = {
    convertToProjectRoot: false,
    redactUsername: false,
};

const SettingsContext = createContext<SettingsContextValue>({
    settings: defaultSettings,
    updateSetting: () => {},
});

const loadSettings = (): Settings => {
    if (typeof window === 'undefined') {
        return defaultSettings;
    }
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        return stored ? { ...defaultSettings, ...(JSON.parse(stored) as Partial<Settings>) } : defaultSettings;
    } catch {
        return defaultSettings;
    }
};

export function SettingsProvider({ children }: { children: ReactNode }) {
    const [settings, setSettings] = useState<Settings>(defaultSettings);
    const [loaded, setLoaded] = useState(false);

    // Load from localStorage on mount (client only — avoids SSR hydration mismatch)
    useEffect(() => {
        setSettings(loadSettings());
        setLoaded(true);
    }, []);

    useEffect(() => {
        if (!loaded) {
            return;
        }
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch {}
    }, [loaded, settings]);

    useEffect(() => {
        const synchronizeSettings = (event: StorageEvent) => {
            if (event.key !== STORAGE_KEY) {
                return;
            }
            try {
                setSettings(
                    event.newValue
                        ? { ...defaultSettings, ...(JSON.parse(event.newValue) as Partial<Settings>) }
                        : defaultSettings,
                );
            } catch {
                setSettings(defaultSettings);
            }
        };
        window.addEventListener('storage', synchronizeSettings);
        return () => window.removeEventListener('storage', synchronizeSettings);
    }, []);

    const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
        setSettings((prev) => ({ ...prev, [key]: value }));
    };

    return <SettingsContext.Provider value={{ settings, updateSetting }}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);
