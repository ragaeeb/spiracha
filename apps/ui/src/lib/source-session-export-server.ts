import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getExportMimeType, sanitizeExportFileName, zipExportDirectory } from '@spiracha/lib/ui-export-archive';
import { buildUiExportDownloadUrl, ensureUiExportDir } from '@spiracha/lib/ui-export-files';

type ExportFormat = 'md' | 'txt';

type RenderSourceSessionDownloadOptions = {
    content: string;
    fallbackBaseName: string;
    fileBaseName: string;
    outputFormat: ExportFormat;
    zipArchive: boolean;
};

export const toSafeSourceExportName = (value: string, fallback: string) => {
    return sanitizeExportFileName(value) || fallback;
};

export const renderSourceSessionDownload = async ({
    content,
    fallbackBaseName,
    fileBaseName,
    outputFormat,
    zipArchive,
}: RenderSourceSessionDownloadOptions) => {
    const safeBaseName = toSafeSourceExportName(fileBaseName, fallbackBaseName);
    if (!zipArchive) {
        return {
            content,
            fileName: `${safeBaseName}.${outputFormat}`,
            mimeType: getExportMimeType(outputFormat),
            mode: 'download' as const,
        };
    }

    const exportDir = await ensureUiExportDir();
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), `${safeBaseName}-`));
    const zipPath = path.join(exportDir, `${safeBaseName}-${randomUUID()}.zip`);

    try {
        await Bun.write(path.join(workspaceDir, `${safeBaseName}.${outputFormat}`), content);
        await zipExportDirectory(workspaceDir, zipPath);
    } finally {
        await rm(workspaceDir, { force: true, recursive: true });
    }

    return {
        downloadUrl: buildUiExportDownloadUrl(zipPath),
        fileName: `${safeBaseName}.zip`,
        mimeType: 'application/zip',
        mode: 'download_url' as const,
    };
};
