import { act, cleanup, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from './settings-store';
import { DEFAULT_SETTINGS, SettingsProvider, useSettings } from './settings-store';

const renderSnapshots: Settings[] = [];

const SettingsConsumer = () => {
    const { settings, updateSetting } = useSettings();

    return (
        <div>
            <span>{JSON.stringify(settings)}</span>
            <button type="button" onClick={() => updateSetting('redactUsername', true)}>
                Toggle redact
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
    window.localStorage.clear();
    window.sessionStorage.clear();
});

describe('settings store', () => {
    it('should load persisted settings from local storage and persist updates', () => {
        window.localStorage.setItem(
            'spiracha-settings',
            JSON.stringify({
                convertToProjectRoot: true,
            }),
        );

        render(
            <SettingsProvider>
                <SettingsConsumer />
            </SettingsProvider>,
        );

        expect(screen.getByText(JSON.stringify({ ...DEFAULT_SETTINGS, convertToProjectRoot: true }))).toBeTruthy();

        act(() => {
            screen.getByRole('button', { name: 'Toggle redact' }).click();
        });

        expect(JSON.parse(window.localStorage.getItem('spiracha-settings') ?? 'null')).toEqual({
            ...DEFAULT_SETTINGS,
            convertToProjectRoot: true,
            redactUsername: true,
        });
    });

    it('should fall back to default settings when local storage is invalid', () => {
        window.localStorage.setItem('spiracha-settings', '{oops');

        render(
            <SettingsProvider>
                <SettingsConsumer />
            </SettingsProvider>,
        );

        expect(screen.getByText(JSON.stringify(DEFAULT_SETTINGS))).toBeTruthy();
    });

    it('should expose default settings even without a provider', () => {
        render(<SettingsConsumer />);

        expect(screen.getByText(JSON.stringify(DEFAULT_SETTINGS))).toBeTruthy();
    });

    it('should expose persisted preferences on the first client render', () => {
        window.localStorage.setItem('spiracha-settings', JSON.stringify({ redactUsername: true }));

        render(
            <SettingsProvider>
                <RecordingSettingsConsumer />
            </SettingsProvider>,
        );

        expect(renderSnapshots[0]?.redactUsername).toBe(true);
        expect(screen.getByText('redacted')).toBeTruthy();
    });

    it('should preserve snapshot identity while storage is unchanged', () => {
        window.localStorage.setItem('spiracha-settings', JSON.stringify({ redactUsername: true }));
        const view = (
            <SettingsProvider>
                <RecordingSettingsConsumer />
            </SettingsProvider>
        );
        const { rerender } = render(view);
        const firstSnapshot = renderSnapshots.at(-1);

        rerender(view);

        expect(renderSnapshots.at(-1)).toBe(firstSnapshot);
    });

    it('should stop repeatedly probing unavailable local storage', () => {
        const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
            throw new Error('storage unavailable');
        });

        try {
            const view = (
                <SettingsProvider>
                    <SettingsConsumer />
                </SettingsProvider>
            );
            const { rerender } = render(view);
            rerender(view);

            expect(getItem).toHaveBeenCalledTimes(1);
        } finally {
            getItem.mockRestore();
            act(() => {
                window.dispatchEvent(new StorageEvent('storage', { key: 'spiracha-settings', newValue: null }));
            });
        }
    });

    it('should persist settings in session storage when local storage writes fail', () => {
        const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
            throw new Error('quota exceeded');
        });

        try {
            render(
                <SettingsProvider>
                    <SettingsConsumer />
                </SettingsProvider>,
            );

            act(() => {
                screen.getByRole('button', { name: 'Toggle redact' }).click();
            });

            expect(JSON.parse(window.sessionStorage.getItem('spiracha-settings') ?? 'null')).toEqual({
                ...DEFAULT_SETTINGS,
                redactUsername: true,
            });
        } finally {
            setItem.mockRestore();
            act(() => {
                window.dispatchEvent(new StorageEvent('storage', { key: 'spiracha-settings', newValue: null }));
            });
        }
    });

    it('should use a stable default snapshot during server rendering', () => {
        window.localStorage.setItem('spiracha-settings', JSON.stringify({ redactUsername: true }));

        const html = renderToString(
            <SettingsProvider>
                <RecordingSettingsConsumer />
            </SettingsProvider>,
        );

        expect(html).toContain('visible');
    });

    it('should synchronize settings changed in another tab', () => {
        render(
            <SettingsProvider>
                <SettingsConsumer />
            </SettingsProvider>,
        );

        const synchronizedSettings = {
            convertToProjectRoot: true,
            redactUsername: true,
        };
        window.localStorage.setItem('spiracha-settings', JSON.stringify(synchronizedSettings));
        act(() => {
            window.dispatchEvent(
                new StorageEvent('storage', {
                    key: 'spiracha-settings',
                    newValue: JSON.stringify(synchronizedSettings),
                }),
            );
        });

        expect(
            screen.getByText(
                JSON.stringify({
                    ...DEFAULT_SETTINGS,
                    convertToProjectRoot: true,
                    redactUsername: true,
                }),
            ),
        ).toBeTruthy();
    });
});
