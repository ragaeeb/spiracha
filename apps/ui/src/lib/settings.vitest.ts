import { describe, expect, it } from 'vitest';
import {
    DEFAULT_SETTINGS,
    normalizeSettings,
    parseSerializedSettings,
    SETTINGS_COOKIE_NAME,
    serializeSettings,
} from './settings';

describe('settings persistence', () => {
    it('should merge partial saved settings with current defaults', () => {
        const settings = parseSerializedSettings(
            encodeURIComponent(
                JSON.stringify({
                    convertToProjectRoot: true,
                    exportDefaults: {
                        includeTools: false,
                        outputFormat: 'txt',
                    },
                }),
            ),
        );

        expect(settings).toEqual({
            convertToProjectRoot: true,
            exportDefaults: {
                ...DEFAULT_SETTINGS.exportDefaults,
                includeTools: false,
                outputFormat: 'txt',
            },
            redactUsername: false,
        });
    });

    it('should reject malformed and invalid saved settings safely', () => {
        expect(parseSerializedSettings('%not-json')).toEqual(DEFAULT_SETTINGS);
        expect(parseSerializedSettings(null)).toEqual(DEFAULT_SETTINGS);
        expect(normalizeSettings([])).toEqual(DEFAULT_SETTINGS);
        expect(
            normalizeSettings({
                convertToProjectRoot: 'yes',
                exportDefaults: {
                    includeCommentary: 'yes',
                    includeMetadata: null,
                    includeTools: 1,
                    outputFormat: 'html',
                    zipArchive: 'yes',
                },
                redactUsername: 1,
            }),
        ).toEqual(DEFAULT_SETTINGS);
    });

    it('should serialize settings for the server cookie encoder', () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            convertToProjectRoot: true,
            redactUsername: true,
        };

        expect(serializeSettings(settings)).toBe(JSON.stringify(settings));
        expect(parseSerializedSettings(serializeSettings(settings))).toEqual(settings);
    });

    it('should use a stable cookie name', () => {
        expect(SETTINGS_COOKIE_NAME).toBe('spiracha-settings');
    });
});
