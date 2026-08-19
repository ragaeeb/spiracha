import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFxSessionTranscript } from './fx-db';
import { writeFxFixture } from './fx-test-helpers';
import { renderFxTranscript } from './fx-transcript';

const tempRoots: string[] = [];

describe('FX transcript rendering', () => {
    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    it('should render metadata, commentary, tool evidence, and final answers', async () => {
        const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fx-transcript-test-'));
        tempRoots.push(dataDir);
        const fixture = await writeFxFixture(dataDir);
        const transcript = await readFxSessionTranscript(dataDir, fixture.sessionId);

        const markdown = renderFxTranscript(transcript!, {
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
        });

        expect(markdown).toContain('# FX router migration');
        expect(markdown).toContain('exported_from: "fx_event_log"');
        expect(markdown).toContain('I will inspect the workspace.');
        expect(markdown).toContain('Tool: `bash`');
        expect(markdown).toContain('full externalized output');
        expect(markdown).toContain('The committed turn is complete.');
    });

    it('should omit commentary and tools when export options disable them', async () => {
        const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fx-transcript-filter-test-'));
        tempRoots.push(dataDir);
        const fixture = await writeFxFixture(dataDir);
        const transcript = await readFxSessionTranscript(dataDir, fixture.sessionId);

        const markdown = renderFxTranscript(transcript!, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'md',
        });

        expect(markdown).not.toContain('I will inspect the workspace.');
        expect(markdown).not.toContain('Tool:');
        expect(markdown).not.toContain('exported_from');
        expect(markdown).toContain('The committed turn is complete.');
    });
});
