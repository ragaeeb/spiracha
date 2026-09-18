import { describe, expect, it } from 'vitest';
import { createExportSelectionMutationInput } from './export-mutation';

describe('createExportSelectionMutationInput', () => {
    it('should snapshot selected IDs and dialog options for the mutation payload', () => {
        const selectedIds = ['thread-a', 'thread-b'];
        const options = {
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md' as const,
            zipArchive: true,
            zipPassword: 'secret',
        };

        const input = createExportSelectionMutationInput(selectedIds, options);
        selectedIds.splice(0, selectedIds.length, 'thread-c');
        options.includeTools = false;

        expect(input).toEqual({
            ids: ['thread-a', 'thread-b'],
            options: {
                includeCommentary: true,
                includeMetadata: true,
                includeTools: true,
                outputFormat: 'md',
                zipArchive: true,
                zipPassword: 'secret',
            },
        });
    });

    it('should reject an export submitted without a selection', () => {
        expect(() =>
            createExportSelectionMutationInput([], {
                includeCommentary: false,
                includeMetadata: true,
                includeTools: true,
                outputFormat: 'txt',
                zipArchive: false,
                zipPassword: '',
            }),
        ).toThrow('No conversations selected for export');
    });
});
