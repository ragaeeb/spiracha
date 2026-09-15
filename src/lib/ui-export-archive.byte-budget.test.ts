import { describe, expect, it } from 'bun:test';
import { createConversationMarkdownZip } from './conversation-zip-export';
import { buildBatchExportBaseName, buildExportArchiveBaseName } from './ui-export-archive';

describe('archive filename byte budgets', () => {
    it('should bound multibyte archive names without splitting code points', () => {
        const name = buildExportArchiveBaseName('codex', '会話'.repeat(150));
        expect(Buffer.byteLength(name)).toBeLessThanOrEqual(150);
        expect(name).not.toContain('\uFFFD');
    });

    it('should export conversations from long but valid workspace directory names', async () => {
        const entries = [{ cwd: `/${'p'.repeat(240)}`, updatedAtMs: null }];
        const baseName = buildBatchExportBaseName(entries, 'conversations');
        expect(baseName).toContain('-threads-1');
        const result = await createConversationMarkdownZip({
            entries: [{ ...entries[0]!, fallbackBaseName: 'one', markdown: 'Answer', title: 'One' }],
            fallbackProjectName: 'conversations',
            platform: 'codex',
        });
        expect(Buffer.byteLength(result.fileName)).toBeLessThanOrEqual(154);
    });
});
