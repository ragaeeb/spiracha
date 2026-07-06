import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveHeadroomRehydrator } from './headroom-transcript-rehydration';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const writeReplacementArchive = async (
    archiveDir: string,
    replacement: {
        client?: string;
        originalText: string;
        provider?: string;
        rewrittenText: string;
        sessionId?: string;
    },
) => {
    await mkdir(archiveDir, { recursive: true });
    await Bun.write(
        path.join(archiveDir, '2026-07-06.jsonl'),
        `${JSON.stringify({
            archive_id: 'replacement-1',
            client: replacement.client ?? null,
            endpoint: '/v1/messages',
            event_type: 'replacement',
            model: null,
            original_text: replacement.originalText,
            original_text_sha256: sha256(replacement.originalText),
            path: '$."messages"[0]."content"',
            provider: replacement.provider ?? null,
            request_id: null,
            rewritten_text: replacement.rewrittenText,
            rewritten_text_sha256: sha256(replacement.rewrittenText),
            schema_version: 1,
            session_id: replacement.sessionId ?? null,
            timestamp: '2026-07-06T12:00:00+0000',
            timestamp_unix: 1_783_340_800,
            tokens_saved: 12,
            transforms: ['markdown'],
            transport: 'http',
        })}\n`,
    );
};

describe('Headroom transcript rehydration', () => {
    it('should rehydrate by rewritten text hash and prefer tighter context matches', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'headroom-rehydration-test-'));
        try {
            const archiveDir = path.join(tempRoot, 'archive');
            await writeReplacementArchive(archiveDir, {
                client: 'codex_cli_rs',
                originalText: '# Original markdown\n\n- Keep structure',
                provider: 'openai',
                rewrittenText: 'Original markdown; keep structure.',
                sessionId: 'session-a',
            });

            const rehydrator = resolveHeadroomRehydrator({ archiveDir });

            expect(
                rehydrator?.rehydrateText('Original markdown; keep structure.', {
                    client: 'codex_cli_rs',
                    provider: 'openai',
                    sessionId: 'session-a',
                }),
            ).toBe('# Original markdown\n\n- Keep structure');
            expect(rehydrator?.metadata()).toEqual({
                applied: true,
                archiveDir,
                count: 1,
            });
        } finally {
            await rm(tempRoot, { force: true, recursive: true });
        }
    });
});
