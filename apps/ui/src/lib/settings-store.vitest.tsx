import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsProvider, useSettings } from './settings-store';

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

afterEach(() => {
    cleanup();
    window.localStorage.clear();
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

        expect(screen.getByText('{"convertToProjectRoot":true,"redactUsername":false}')).toBeTruthy();

        act(() => {
            screen.getByRole('button', { name: 'Toggle redact' }).click();
        });

        expect(window.localStorage.getItem('spiracha-settings')).toBe(
            '{"convertToProjectRoot":true,"redactUsername":true}',
        );
    });

    it('should fall back to default settings when local storage is invalid', () => {
        window.localStorage.setItem('spiracha-settings', '{oops');

        render(
            <SettingsProvider>
                <SettingsConsumer />
            </SettingsProvider>,
        );

        expect(screen.getByText('{"convertToProjectRoot":false,"redactUsername":false}')).toBeTruthy();
    });

    it('should expose default settings even without a provider', () => {
        render(<SettingsConsumer />);

        expect(screen.getByText('{"convertToProjectRoot":false,"redactUsername":false}')).toBeTruthy();
    });
});
