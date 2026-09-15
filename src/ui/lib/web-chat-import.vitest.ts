import { describe, expect, it, vi } from 'vitest';
import { dedupeImportErrors, readImportFiles } from './web-chat-import';
import { MAX_WEB_CHAT_FILE_BYTES, MAX_WEB_CHAT_FILES, MAX_WEB_CHAT_IMPORT_BYTES } from './web-chat-limits';

const file = (name: string, size = 2, content = '{}') => ({
    name,
    size,
    text: vi.fn<() => Promise<string>>().mockResolvedValue(content),
});

describe('Web import file preparation', () => {
    it('should handle an empty selection without performing reads', async () => {
        expect(await readImportFiles([])).toEqual({ errors: [], payload: [] });
    });

    it('should accept the exact file count and reject one more before any read', async () => {
        const files = Array.from({ length: MAX_WEB_CHAT_FILES }, (_, index) => file(`${index}.json`));
        expect((await readImportFiles(files)).payload).toHaveLength(MAX_WEB_CHAT_FILES);
        for (const input of files) input.text.mockClear();
        await expect(readImportFiles([...files, file('extra.json')])).rejects.toThrow('at most 20');
        for (const input of files) expect(input.text).not.toHaveBeenCalled();
    });

    it('should accept the exact per-file size but never read an oversized file', async () => {
        const exact = file('exact.json', MAX_WEB_CHAT_FILE_BYTES);
        const tooLarge = file('large.json', MAX_WEB_CHAT_FILE_BYTES + 1);
        expect(await readImportFiles([exact, tooLarge])).toEqual({
            errors: [{ fileName: 'large.json', message: 'File exceeds the 25 MB limit.' }],
            payload: [{ content: '{}', name: 'exact.json' }],
        });
        expect(tooLarge.text).not.toHaveBeenCalled();
    });

    it('should accept exactly the total limit and reject one extra byte before reads', async () => {
        const files = Array.from({ length: 4 }, (_, index) => file(`${index}.json`, MAX_WEB_CHAT_IMPORT_BYTES / 4));
        expect((await readImportFiles(files)).payload).toHaveLength(4);
        for (const input of files) input.text.mockClear();
        await expect(readImportFiles([...files, file('extra.json', 1)])).rejects.toThrow('100 MB');
        for (const input of files) expect(input.text).not.toHaveBeenCalled();
    });

    it('should keep valid files when another file cannot be read', async () => {
        const broken = file('broken.json');
        broken.text.mockRejectedValue(new Error('disk failure'));
        expect(await readImportFiles([file('first.json', 10, '会🙂'), broken, file('last.json')])).toEqual({
            errors: [{ fileName: 'broken.json', message: 'Could not read this file.' }],
            payload: [{ content: '会🙂', name: 'first.json' }, { content: '{}', name: 'last.json' }],
        });
    });

    it('should preserve selection order rather than completion order', async () => {
        let finishFirst: (content: string) => void = () => { };
        const first = file('first.json');
        first.text.mockImplementation(() => new Promise((resolve) => { finishFirst = resolve; }));
        const pending = readImportFiles([first, file('second.json')]);
        finishFirst('first');
        expect((await pending).payload.map(({ name }) => name)).toEqual(['first.json', 'second.json']);
    });

    it('should deduplicate only identical filename and message pairs without mutating the input', () => {
        const errors = [
            { fileName: 'one.json', message: 'invalid' },
            { fileName: 'one.json', message: 'unreadable' },
            { fileName: 'two.json', message: 'invalid' },
            { fileName: 'one.json', message: 'invalid' },
        ];
        const original = structuredClone(errors);
        expect(dedupeImportErrors(errors)).toEqual(errors.slice(0, 3));
        expect(errors).toEqual(original);
    });
});
