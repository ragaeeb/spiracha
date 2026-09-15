import { describe, expect, it, spyOn } from 'bun:test';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { createConversationMarkdownZip } from './conversation-zip-export';

describe('private conversation ZIP staging', () => {
    it('should write the archive inside an owner-only workspace, not the shared temporary directory', async () => {
        const write = Bun.write;
        const directoryModes: number[] = [];
        const spy = spyOn(Bun, 'write').mockImplementation((async (
            target: unknown,
            data: unknown,
            options?: unknown,
        ) => {
            if (typeof target === 'string' && target.endsWith('.zip')) {
                directoryModes.push((await stat(path.dirname(target))).mode & 0o777);
            }
            return write(target as never, data as never, options as never);
        }) as typeof write);
        try {
            await createConversationMarkdownZip({
                entries: [
                    { cwd: null, fallbackBaseName: 'private', markdown: 'Secret', title: null, updatedAtMs: null },
                ],
                fallbackProjectName: 'private',
                platform: 'codex',
            });
            expect(directoryModes).toEqual([0o700]);
        } finally {
            spy.mockRestore();
        }
    });
});
