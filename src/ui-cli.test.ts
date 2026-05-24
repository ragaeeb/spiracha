import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UI_EXPORT_DIR_ENV } from './lib/ui-export-files';
import { getUiHelpText, getUiStaticResponse, parseUiCliArgs } from './ui-cli';

const originalExportDir = process.env[UI_EXPORT_DIR_ENV];
const tempPaths: string[] = [];

afterEach(async () => {
    if (originalExportDir === undefined) {
        delete process.env[UI_EXPORT_DIR_ENV];
    } else {
        process.env[UI_EXPORT_DIR_ENV] = originalExportDir;
    }

    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

describe('ui cli', () => {
    it('should parse ui options with defaults', () => {
        expect(parseUiCliArgs([])).toEqual({
            dbPath: null,
            host: '127.0.0.1',
            openBrowser: true,
            port: 3000,
        });
    });

    it('should parse ui flags for port host db and no-open', () => {
        expect(
            parseUiCliArgs(['--port', '43123', '--host', '0.0.0.0', '--db', '/tmp/state.sqlite', '--no-open']),
        ).toEqual({
            dbPath: '/tmp/state.sqlite',
            host: '0.0.0.0',
            openBrowser: false,
            port: 43123,
        });
    });

    it('should describe the ui launcher in help text', () => {
        const help = getUiHelpText();
        expect(help).toContain('spiracha ui');
        expect(help).toContain('--no-open');
        expect(help).toContain('Stop the UI with Ctrl+C.');
    });

    it('should serve shared export artifacts through the packaged ui static responder', async () => {
        const exportDir = await mkdtemp(path.join(os.tmpdir(), 'spiracha-ui-cli-test-'));
        tempPaths.push(exportDir);
        process.env[UI_EXPORT_DIR_ENV] = exportDir;
        const filePath = path.join(exportDir, 'export.zip');
        await Bun.write(filePath, 'zip-body');

        const response = await getUiStaticResponse('/tmp/client', '/__exports/export.zip');

        expect(response?.status).toBe(200);
        expect(response?.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''export.zip");
        expect(await response?.text()).toBe('zip-body');
    });

    it('should return a not found response for missing shared export artifacts', async () => {
        const exportDir = await mkdtemp(path.join(os.tmpdir(), 'spiracha-ui-cli-test-'));
        tempPaths.push(exportDir);
        process.env[UI_EXPORT_DIR_ENV] = exportDir;

        const response = await getUiStaticResponse('/tmp/client', '/__exports/missing.zip');

        expect(response?.status).toBe(404);
    });
});
