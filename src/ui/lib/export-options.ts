import type { DownloadLifecycleState } from '#/lib/download';

export type ExportDialogOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: 'md' | 'txt';
    zipArchive: boolean;
};

export type ExportLifecycleCallbacks = {
    onDownloadStateChange?: (state: DownloadLifecycleState) => void;
};

export const DEFAULT_EXPORT_DIALOG_OPTIONS: ExportDialogOptions = {
    includeCommentary: false,
    includeMetadata: true,
    includeTools: true,
    outputFormat: 'md',
    zipArchive: false,
};
