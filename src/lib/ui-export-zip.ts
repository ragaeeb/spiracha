import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { type Zippable, zipSync } from 'fflate';

const readZipFile = async (filePath: string) => {
    return new Uint8Array(await Bun.file(filePath).arrayBuffer());
};

const createZip = async (files: Zippable) => zipSync(files, { level: 3 });

const readZipDirectory = async (
    rootDirectory: string,
    currentDirectory = rootDirectory,
    files: Zippable = {},
): Promise<Zippable> => {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    await Promise.all(
        entries.map(async (entry) => {
            const entryPath = path.join(currentDirectory, entry.name);
            if (entry.isDirectory()) {
                await readZipDirectory(rootDirectory, entryPath, files);
                return;
            }

            if (entry.isFile()) {
                const archivePath = path.relative(rootDirectory, entryPath).split(path.sep).join('/');
                files[archivePath] = await readZipFile(entryPath);
            }
        }),
    );
    return files;
};

export const zipExportFile = async (sourcePath: string, zipPath: string) => {
    try {
        await Bun.write(zipPath, await createZip({ [path.basename(sourcePath)]: await readZipFile(sourcePath) }));
    } catch (error) {
        await rm(zipPath, { force: true }).catch(() => undefined);
        throw error;
    }
};

/**
 * Recursively collects regular files (not directory-entry symlinks), reads all
 * contents into memory, then synchronously compresses a ZIP at level 3. This is
 * not a streaming or fixed-heap export despite accepting filesystem paths.
 * On failure, removes the partial destination best-effort and rethrows. The caller
 * owns source-directory cleanup and any stable-source snapshot validation.
 */
export const zipExportDirectory = async (sourceDirectory: string, zipPath: string) => {
    try {
        await Bun.write(zipPath, await createZip(await readZipDirectory(sourceDirectory)));
    } catch (error) {
        await rm(zipPath, { force: true }).catch(() => undefined);
        throw error;
    }
};
