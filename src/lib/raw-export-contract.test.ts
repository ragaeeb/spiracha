import { describe, expect, it } from 'bun:test';
import { decodeRawDownloadBase64 } from './raw-export-contract';
import { buildRawConversationExportFileName, resolveUniqueRawExportFileName } from './ui-export-archive';

describe('raw export transport and names', () => {
    it('should decode original bytes without a UTF-8 round trip', () => {
        expect([...decodeRawDownloadBase64('AP/AQQ0K')]).toEqual([0, 255, 192, 65, 13, 10]);
        expect([...decodeRawDownloadBase64('')]).toEqual([]);
        expect(() => decodeRawDownloadBase64('not base64!')).toThrow();
    });

    it('should preserve sanitized native filenames and extensions', () => {
        expect(buildRawConversationExportFileName('codex', 'a', 'messages.jsonl')).toBe('messages.jsonl');
        expect(buildRawConversationExportFileName('grok-bot', 'a', '../replica.blob')).toBe('replica.blob');
        expect(buildRawConversationExportFileName('grok', 'a', 'C:\\private\\history.json')).toBe('history.json');
        expect(buildRawConversationExportFileName('codex', 'a/b', '')).toBe('codex-a b.bin');
        expect(buildRawConversationExportFileName('codex', 'a', 'file\r\nname.JSONL')).toBe('file name.JSONL');
    });

    it('should disambiguate whole archive filenames while keeping their extensions', () => {
        const used = new Map<string, number>();
        expect(resolveUniqueRawExportFileName('messages.jsonl', used)).toBe('messages.jsonl');
        expect(resolveUniqueRawExportFileName('messages-2.jsonl', used)).toBe('messages-2.jsonl');
        expect(resolveUniqueRawExportFileName('MESSAGES.jsonl', used)).toBe('MESSAGES-3.jsonl');
        expect(resolveUniqueRawExportFileName('messages.json', used)).toBe('messages.json');
        expect(resolveUniqueRawExportFileName('replica.blob', used)).toBe('replica.blob');
        expect(resolveUniqueRawExportFileName('replica.blob', used)).toBe('replica-2.blob');
    });
});
