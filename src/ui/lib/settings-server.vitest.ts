import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCookieMock, setCookieMock } = vi.hoisted(() => ({
    getCookieMock: vi.fn(),
    setCookieMock: vi.fn(),
}));

vi.mock('@tanstack/react-start', () => ({
    createServerFn: () => {
        const serverFn = {
            handler: (callback: unknown) => callback,
            validator: () => serverFn,
        };

        return serverFn;
    },
}));

vi.mock('@tanstack/react-start/server', () => ({
    getCookie: getCookieMock,
    setCookie: setCookieMock,
}));

import { DEFAULT_SETTINGS, SETTINGS_COOKIE_NAME, serializeSettings } from './settings';
import { getInitialSettingsFn, saveSettingsFn } from './settings-server';

describe('settings server', () => {
    beforeEach(() => {
        getCookieMock.mockReset();
        setCookieMock.mockReset();
    });

    it('should load saved settings from the request cookie for server rendering', async () => {
        getCookieMock.mockReturnValue(
            encodeURIComponent(
                JSON.stringify({
                    convertToProjectRoot: true,
                    exportDefaults: { includeTools: false, outputFormat: 'txt' },
                    redactUsername: true,
                }),
            ),
        );

        await expect(getInitialSettingsFn()).resolves.toEqual({
            convertToProjectRoot: true,
            exportDefaults: {
                ...DEFAULT_SETTINGS.exportDefaults,
                includeTools: false,
                outputFormat: 'txt',
            },
            redactUsername: true,
        });
    });

    it('should use default settings when the request cookie is invalid', async () => {
        getCookieMock.mockReturnValue('%not-json');

        await expect(getInitialSettingsFn()).resolves.toEqual(DEFAULT_SETTINGS);
    });

    it('should persist validated settings in an HTTP-only bootstrap cookie', async () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            redactUsername: true,
        };

        await saveSettingsFn({ data: settings });

        expect(setCookieMock).toHaveBeenCalledWith(SETTINGS_COOKIE_NAME, serializeSettings(settings), {
            httpOnly: true,
            maxAge: 31_536_000,
            path: '/',
            sameSite: 'lax',
        });
    });
});
