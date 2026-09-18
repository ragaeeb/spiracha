import type { DownloadLifecycleState } from '#/lib/download';

export type ExportDialogOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: 'md' | 'txt';
    zipArchive: boolean;
    zipPassword: string;
};

export type PersistedExportDialogOptions = Omit<ExportDialogOptions, 'zipPassword'>;

export type ExportLifecycleCallbacks = {
    onDownloadStateChange?: (state: DownloadLifecycleState) => void;
};

export const DEFAULT_EXPORT_DIALOG_OPTIONS: PersistedExportDialogOptions = {
    includeCommentary: false,
    includeMetadata: true,
    includeTools: true,
    outputFormat: 'md',
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
