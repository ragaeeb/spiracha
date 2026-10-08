import type { DownloadLifecycleState } from '#/lib/download';

export type ExportDialogOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTimestamps: boolean;
    includeTools: boolean;
    outputFormat: 'md' | 'txt';
    zipArchive: boolean;
    zipPassword: string;
};

// The output format is deliberately not remembered: the dialog always opens on its default (JSON when available).
// The dialog-chosen format is a separate concept (it can also be JSON or focused evidence), so drafts omit it.
export type ExportDraftOptions = Omit<ExportDialogOptions, 'outputFormat'>;

export type RawJsonExportOptions = Pick<ExportDialogOptions, 'zipArchive' | 'zipPassword'>;

export type PersistedExportDialogOptions = Omit<ExportDialogOptions, 'outputFormat' | 'zipPassword'>;

export type ExportLifecycleCallbacks = {
    onDownloadStateChange?: (state: DownloadLifecycleState) => void;
};

export const DEFAULT_EXPORT_DIALOG_OPTIONS: PersistedExportDialogOptions = {
    includeCommentary: false,
    includeMetadata: true,
    includeTimestamps: true,
    includeTools: true,
    zipArchive: false,
};

export const ZIP_PASSWORD_STORAGE_KEY = 'spiracha-export-zip-password';

export const readStoredZipPassword = () => {
    if (typeof window === 'undefined') {
        return '';
    }

    try {
        return window.localStorage.getItem(ZIP_PASSWORD_STORAGE_KEY) ?? '';
    } catch {
        return '';
    }
};

export const storeZipPassword = (password: string) => {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        window.localStorage.setItem(ZIP_PASSWORD_STORAGE_KEY, password);
    } catch {
        // Storage can be unavailable in privacy-restricted browser contexts.
    }
};
