import { createServerFn } from '@tanstack/react-start';
import { getCookie, setCookie } from '@tanstack/react-start/server';
import { z } from 'zod';
import { parseSerializedSettings, SETTINGS_COOKIE_NAME, serializeSettings } from '#/lib/settings';

const exportDefaultsSchema = z.object({
    includeCommentary: z.boolean(),
    includeMetadata: z.boolean(),
    includeTools: z.boolean(),
    outputFormat: z.enum(['md', 'txt']),
    zipArchive: z.boolean(),
});

const settingsSchema = z.object({
    convertToProjectRoot: z.boolean(),
    exportDefaults: exportDefaultsSchema,
    redactUsername: z.boolean(),
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
