import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '#/lib/settings';
import { getInitialSettingsFn, saveSettingsFn } from '#/lib/settings-server';

type SettingsContextValue = {
    settings: Settings;
    updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
};

const SETTINGS_CHANNEL_NAME = 'spiracha-settings';

const SettingsContext = createContext<SettingsContextValue>({
    settings: DEFAULT_SETTINGS,
    updateSetting: () => {},
});

export function SettingsProvider({
    children,
    initialSettings = DEFAULT_SETTINGS,
}: {
    children: ReactNode;
    initialSettings?: Settings;
}) {
    const [settings, setSettings] = useState(initialSettings);
    const channelRef = useRef<BroadcastChannel | null>(null);
    const pendingSaveCountRef = useRef(0);
    const settingsRef = useRef(initialSettings);
    const settingsRevisionRef = useRef(0);
    const synchronizationRequestRef = useRef(0);
    const persistenceQueueRef = useRef(Promise.resolve());

    useEffect(() => {
        const synchronizeFromCookie = () => {
            const hadPendingSave = pendingSaveCountRef.current > 0;
            const requestId = synchronizationRequestRef.current + 1;
            const revision = settingsRevisionRef.current;
            synchronizationRequestRef.current = requestId;
            void getInitialSettingsFn()
                .then((savedSettings) => {
                    if (
                        hadPendingSave ||
                        pendingSaveCountRef.current > 0 ||
                        requestId !== synchronizationRequestRef.current ||
                        revision !== settingsRevisionRef.current
                    ) {
                        return;
                    }
                    settingsRef.current = savedSettings;
                    setSettings(savedSettings);
                })
                .catch((error: unknown) => {
                    console.error('[spiracha:settings] synchronization failed', {
                        error: error instanceof Error ? error.message : String(error),
                    });
                });
        };
        const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(SETTINGS_CHANNEL_NAME);
        if (channel) {
            channel.onmessage = (event: MessageEvent<unknown>) => {
                if (pendingSaveCountRef.current > 0) {
                    return;
                }
                const synchronizedSettings = normalizeSettings(event.data);
                settingsRevisionRef.current += 1;
                settingsRef.current = synchronizedSettings;
                setSettings(synchronizedSettings);
            };
            channelRef.current = channel;
        }
        window.addEventListener('focus', synchronizeFromCookie);

        return () => {
            window.removeEventListener('focus', synchronizeFromCookie);
            channel?.close();
            channelRef.current = null;
        };
    }, []);

    const updateSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
        const nextSettings = { ...settingsRef.current, [key]: value };
        pendingSaveCountRef.current += 1;
        settingsRevisionRef.current += 1;
        settingsRef.current = nextSettings;
        setSettings(nextSettings);
        persistenceQueueRef.current = persistenceQueueRef.current.then(async () => {
            try {
                await saveSettingsFn({ data: nextSettings });
                channelRef.current?.postMessage(nextSettings);
            } catch (error) {
                console.error('[spiracha:settings] persistence failed', {
                    error: error instanceof Error ? error.message : String(error),
                });
            } finally {
                pendingSaveCountRef.current -= 1;
            }
        });
    }, []);
    const contextValue = useMemo(() => ({ settings, updateSetting }), [settings, updateSetting]);

    return <SettingsContext.Provider value={contextValue}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);
