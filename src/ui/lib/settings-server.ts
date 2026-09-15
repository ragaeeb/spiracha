import { createServerFn } from '@tanstack/react-start';
import { getCookie, setCookie } from '@tanstack/react-start/server';
import { boolean, object, picklist } from 'valibot';
import { parseSerializedSettings, SETTINGS_COOKIE_NAME, serializeSettings } from '#/lib/settings';

const exportDefaultsSchema = object({
    includeCommentary: boolean(),
    includeMetadata: boolean(),
    includeTools: boolean(),
    outputFormat: picklist(['md', 'txt']),
    zipArchive: boolean(),
});

const settingsSchema = object({
    convertToProjectRoot: boolean(),
    exportDefaults: exportDefaultsSchema,
    redactUsername: boolean(),
});

export const getInitialSettingsFn = createServerFn({ method: 'GET' }).handler(async () =>
    parseSerializedSettings(getCookie(SETTINGS_COOKIE_NAME)),
);

export const saveSettingsFn = createServerFn({ method: 'POST' })
    .validator(settingsSchema)
    .handler(async ({ data }) => {
        setCookie(SETTINGS_COOKIE_NAME, serializeSettings(data), {
            httpOnly: true,
            maxAge: 60 * 60 * 24 * 365,
            path: '/',
            sameSite: 'lax',
        });
    });
