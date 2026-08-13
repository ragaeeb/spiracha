import type { ExportDialogOptions } from '#/lib/export-options';

export type ExportSelectionMutationInput = Readonly<{
    ids: readonly string[];
    options: Readonly<ExportDialogOptions>;
}>;

export const createExportSelectionMutationInput = (
    ids: readonly string[],
    options: ExportDialogOptions,
): ExportSelectionMutationInput => {
    if (ids.length === 0) {
        throw new Error('No conversations selected for export');
    }

    return {
        ids: [...ids],
        options: { ...options },
    };
};
