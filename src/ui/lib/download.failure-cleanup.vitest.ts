import { describe, expect, it } from 'vitest';
import { downloadTextFile } from './download';

describe('failed inline download cleanup', () => {
    it('should release the blob URL and remove the anchor when clicking throws', () => {
        const revoked: string[] = [];
        let removed = false;
        const documentRef = {
            body: { append: () => {} },
            createElement: () => ({
                click: () => {
                    throw new Error('click failed');
                },
                remove: () => {
                    removed = true;
                },
            }),
        } as unknown as Document;
        expect(() =>
            downloadTextFile('export.md', 'content', 'text/markdown', {
                createObjectUrl: () => 'blob:failed-download',
                documentRef,
                revokeObjectUrl: (url) => revoked.push(url),
                schedule: () => {
                    throw new Error('must not schedule a failed click');
                },
            }),
        ).toThrow('click failed');
        expect(revoked).toEqual(['blob:failed-download']);
        expect(removed).toBe(true);
    });

    it('should release the blob URL when lifecycle notification fails before clicking', () => {
        const revoked: string[] = [];
        expect(() =>
            downloadTextFile('export.md', 'content', 'text/markdown', {
                createObjectUrl: () => 'blob:failed-lifecycle',
                documentRef: {} as Document,
                onStateChange: (state) => {
                    if (state === 'ready') {
                        throw new Error('notification failed');
                    }
                },
                revokeObjectUrl: (url) => revoked.push(url),
            }),
        ).toThrow('notification failed');
        expect(revoked).toEqual(['blob:failed-lifecycle']);
    });

    it('should keep successful download URLs alive until the scheduled cleanup', () => {
        const revoked: string[] = [];
        const callbacks: Array<() => void> = [];
        const documentRef = {
            body: { append: () => {} },
            createElement: () => ({ click: () => {}, remove: () => {} }),
        } as unknown as Document;
        downloadTextFile('export.md', 'content', 'text/markdown', {
            createObjectUrl: () => 'blob:successful-download',
            documentRef,
            revokeObjectUrl: (url) => revoked.push(url),
            schedule: (callback) => {
                callbacks.push(callback);
            },
        });
        expect(revoked).toEqual([]);
        expect(callbacks).toHaveLength(1);
        callbacks[0]!();
        expect(revoked).toEqual(['blob:successful-download']);
    });
});
