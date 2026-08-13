import { act, cleanup, render, screen } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getInitialSettingsFnMock, saveSettingsFnMock } = vi.hoisted(() => ({
    getInitialSettingsFnMock: vi.fn(),
    saveSettingsFnMock: vi.fn(),
}));

vi.mock('./settings-server', () => ({
    getInitialSettingsFn: getInitialSettingsFnMock,
    saveSettingsFn: saveSettingsFnMock,
}));

import { DEFAULT_SETTINGS, type Settings } from './settings';
import { SettingsProvider, useSettings } from './settings-store';

const renderSnapshots: Settings[] = [];

const SettingsConsumer = () => {
    const { settings, updateSetting } = useSettings();

    return (
        <div>
            <span>{JSON.stringify(settings)}</span>
            <button type="button" onClick={() => updateSetting('redactUsername', true)}>
                Toggle redact
            </button>
            <button type="button" onClick={() => updateSetting('convertToProjectRoot', true)}>
                Toggle project root
            </button>
        </div>
    );
};

const RecordingSettingsConsumer = () => {
    const { settings } = useSettings();
    renderSnapshots.push(settings);
    return <span>{settings.redactUsername ? 'redacted' : 'visible'}</span>;
};

afterEach(() => {
    cleanup();
    renderSnapshots.length = 0;
    getInitialSettingsFnMock.mockReset();
    saveSettingsFnMock.mockReset();
    vi.unstubAllGlobals();
});

describe('settings store', () => {
    it('should start from server-loaded settings and persist updates in the request cookie', async () => {
        saveSettingsFnMock.mockResolvedValue(undefined);
        const initialSettings = {
            ...DEFAULT_SETTINGS,
            convertToProjectRoot: true,
        };

        render(
            <SettingsProvider initialSettings={initialSettings}>
                <SettingsConsumer />
            </SettingsProvider>,
        );

        expect(screen.getByText(JSON.stringify(initialSettings))).toBeTruthy();

        act(() => {
            screen.getByRole('button', { name: 'Toggle redact' }).click();
        });

        const updatedSettings = { ...initialSettings, redactUsername: true };
        expect(screen.getByText(JSON.stringify(updatedSettings))).toBeTruthy();
        await vi.waitFor(() => expect(saveSettingsFnMock).toHaveBeenCalledWith({ data: updatedSettings }));
    });

    it('should expose default settings even without a provider', () => {
        render(<SettingsConsumer />);

        expect(screen.getByText(JSON.stringify(DEFAULT_SETTINGS))).toBeTruthy();
    });

    it('should expose server-loaded preferences on the first client render', () => {
        const initialSettings = {
            ...DEFAULT_SETTINGS,
            convertToProjectRoot: true,
            redactUsername: true,
        };

        render(
            <SettingsProvider initialSettings={initialSettings}>
                <RecordingSettingsConsumer />
            </SettingsProvider>,
        );

        expect(renderSnapshots[0]?.redactUsername).toBe(true);
        expect(screen.getByText('redacted')).toBeTruthy();
    });

    it('should preserve snapshot identity while settings are unchanged', () => {
        const initialSettings = {
            ...DEFAULT_SETTINGS,
            redactUsername: true,
        };
        const view = (
            <SettingsProvider initialSettings={initialSettings}>
                <RecordingSettingsConsumer />
            </SettingsProvider>
        );
        const { rerender } = render(view);
        const firstSnapshot = renderSnapshots.at(-1);

        rerender(view);

        expect(renderSnapshots.at(-1)).toBe(firstSnapshot);
    });

    it('should use a stable default snapshot during server rendering', () => {
        const html = renderToString(
            <SettingsProvider>
                <RecordingSettingsConsumer />
            </SettingsProvider>,
        );

        expect(html).toContain('visible');
    });

    it('should hydrate with the server-loaded settings without rendering defaults first', async () => {
        const initialSettings: Settings = {
            ...DEFAULT_SETTINGS,
            redactUsername: true,
        };
        const view = (
            <SettingsProvider initialSettings={initialSettings}>
                <RecordingSettingsConsumer />
            </SettingsProvider>
        );
        const html = renderToString(view);
        const container = document.createElement('div');
        container.innerHTML = html;
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        let root: Root | undefined;

        try {
            expect(html).toContain('redacted');

            await act(async () => {
                root = hydrateRoot(container, view);
            });

            expect(container.textContent).toBe('redacted');
            expect(renderSnapshots.every((settings) => settings.redactUsername)).toBe(true);
            expect(consoleError).not.toHaveBeenCalled();
        } finally {
            await act(async () => root?.unmount());
            consoleError.mockRestore();
        }
    });

    it('should synchronize settings changed in another tab', async () => {
        render(
            <SettingsProvider>
                <SettingsConsumer />
            </SettingsProvider>,
        );

        const synchronizedSettings = {
            ...DEFAULT_SETTINGS,
            convertToProjectRoot: true,
            redactUsername: true,
        };
        getInitialSettingsFnMock.mockResolvedValue(synchronizedSettings);
        await act(async () => {
            window.dispatchEvent(new Event('focus'));
        });

        expect(screen.getByText(JSON.stringify(synchronizedSettings))).toBeTruthy();
    });

    it('should keep optimistic settings when persistence fails and report the failure', async () => {
        saveSettingsFnMock.mockRejectedValue(new Error('cookie unavailable'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(
            <SettingsProvider>
                <SettingsConsumer />
            </SettingsProvider>,
        );

        act(() => {
            screen.getByRole('button', { name: 'Toggle redact' }).click();
        });

        expect(screen.getByText(JSON.stringify({ ...DEFAULT_SETTINGS, redactUsername: true }))).toBeTruthy();
        await vi.waitFor(() =>
            expect(consoleError).toHaveBeenCalledWith('[spiracha:settings] persistence failed', {
                error: 'cookie unavailable',
            }),
        );
        consoleError.mockRestore();
    });

    it('should serialize rapid updates so an older request cannot overwrite a newer cookie', async () => {
        let finishFirstSave: (() => void) | undefined;
        saveSettingsFnMock
            .mockImplementationOnce(
                () =>
                    new Promise<void>((resolve) => {
                        finishFirstSave = resolve;
                    }),
            )
            .mockResolvedValueOnce(undefined);
        render(
            <SettingsProvider>
                <SettingsConsumer />
            </SettingsProvider>,
        );

        act(() => {
            screen.getByRole('button', { name: 'Toggle redact' }).click();
            screen.getByRole('button', { name: 'Toggle project root' }).click();
        });

        await vi.waitFor(() => expect(saveSettingsFnMock).toHaveBeenCalledTimes(1));
        expect(saveSettingsFnMock).toHaveBeenNthCalledWith(1, {
            data: { ...DEFAULT_SETTINGS, redactUsername: true },
        });

        finishFirstSave?.();

        await vi.waitFor(() => expect(saveSettingsFnMock).toHaveBeenCalledTimes(2));
        expect(saveSettingsFnMock).toHaveBeenNthCalledWith(2, {
            data: {
                ...DEFAULT_SETTINGS,
                convertToProjectRoot: true,
                redactUsername: true,
            },
        });
    });

    it('should report cross-tab synchronization failures without replacing current settings', async () => {
        getInitialSettingsFnMock.mockRejectedValue('server unavailable');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(
            <SettingsProvider initialSettings={{ ...DEFAULT_SETTINGS, redactUsername: true }}>
                <RecordingSettingsConsumer />
            </SettingsProvider>,
        );

        await act(async () => {
            window.dispatchEvent(new Event('focus'));
        });

        expect(screen.getByText('redacted')).toBeTruthy();
        expect(consoleError).toHaveBeenCalledWith('[spiracha:settings] synchronization failed', {
            error: 'server unavailable',
        });
        consoleError.mockRestore();
    });

    it('should not replace an unsaved local update with an older focus response', async () => {
        saveSettingsFnMock.mockReturnValue(new Promise<void>(() => {}));
        getInitialSettingsFnMock.mockResolvedValue(DEFAULT_SETTINGS);
        render(
            <SettingsProvider>
                <SettingsConsumer />
            </SettingsProvider>,
        );

        act(() => {
            screen.getByRole('button', { name: 'Toggle redact' }).click();
        });
        await vi.waitFor(() => expect(saveSettingsFnMock).toHaveBeenCalledTimes(1));

        await act(async () => {
            window.dispatchEvent(new Event('focus'));
        });

        expect(screen.getByText(JSON.stringify({ ...DEFAULT_SETTINGS, redactUsername: true }))).toBeTruthy();
    });

    it('should ignore an older focus response that finishes after a newer response', async () => {
        let finishFirstLoad: ((settings: Settings) => void) | undefined;
        const newerSettings = { ...DEFAULT_SETTINGS, redactUsername: true };
        getInitialSettingsFnMock
            .mockImplementationOnce(
                () =>
                    new Promise<Settings>((resolve) => {
                        finishFirstLoad = resolve;
                    }),
            )
            .mockResolvedValueOnce(newerSettings);
        render(
            <SettingsProvider>
                <RecordingSettingsConsumer />
            </SettingsProvider>,
        );

        window.dispatchEvent(new Event('focus'));
        await act(async () => {
            window.dispatchEvent(new Event('focus'));
        });
        expect(screen.getByText('redacted')).toBeTruthy();

        await act(async () => finishFirstLoad?.(DEFAULT_SETTINGS));

        expect(screen.getByText('redacted')).toBeTruthy();
    });

    it('should not replace an unsaved local update with a remote broadcast', async () => {
        let channel: { onmessage: ((event: MessageEvent<unknown>) => void) | null } | undefined;
        const BroadcastChannelStub = class {
            onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

            constructor() {
                channel = this;
            }

            close = vi.fn();
            postMessage = vi.fn();
        };
        vi.stubGlobal('BroadcastChannel', BroadcastChannelStub);
        saveSettingsFnMock.mockReturnValue(new Promise<void>(() => {}));
        render(
            <SettingsProvider>
                <SettingsConsumer />
            </SettingsProvider>,
        );

        act(() => {
            screen.getByRole('button', { name: 'Toggle redact' }).click();
            channel?.onmessage?.(new MessageEvent('message', { data: DEFAULT_SETTINGS }));
        });

        expect(screen.getByText(JSON.stringify({ ...DEFAULT_SETTINGS, redactUsername: true }))).toBeTruthy();
    });
});
