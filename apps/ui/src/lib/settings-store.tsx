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

    // Load from localStorage on mount (client only — avoids SSR hydration mismatch)
    useEffect(() => {
        setSettings(loadSettings());
    }, []);

    const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
        setSettings((prev) => {
            const next = { ...prev, [key]: value };
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            } catch {}
            return next;
        });
    };

    return <SettingsContext.Provider value={{ settings, updateSetting }}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);
