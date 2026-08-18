import type { ExportDialogOptions, ExportLifecycleCallbacks } from '#/lib/export-options';

export type ExportSelectionMutationInput = Readonly<{
    ids: readonly string[];
    options: Readonly<ExportDialogOptions>;
}> &
    ExportLifecycleCallbacks;

export const createExportSelectionMutationInput = (
    ids: readonly string[],
    options: ExportDialogOptions,
    callbacks: ExportLifecycleCallbacks = {},
): ExportSelectionMutationInput => {
    if (ids.length === 0) {
        throw new Error('No conversations selected for export');
    }

    return {
        ...callbacks,
        ids: [...ids],
        options: { ...options },
    };
};
