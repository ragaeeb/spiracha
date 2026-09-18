import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';
import { type Zippable, zipSync } from 'fflate';

const readZipFile = async (filePath: string) => {
    return new Uint8Array(await Bun.file(filePath).arrayBuffer());
};

const createZip = async (files: Zippable, password?: string) => {
    if (password === undefined || password === '') {
        return zipSync(files, { level: 9 });
    }

    const writer = new ZipWriter(new BlobWriter('application/zip'), {
        encryptionStrength: 3,
        level: 9,
        password,
    });
    for (const [fileName, value] of Object.entries(files)) {
        if (!(value instanceof Uint8Array)) {
            throw new Error(`Cannot encrypt non-file ZIP member: ${fileName}`);
        }
        await writer.add(fileName, new Uint8ArrayReader(value));
    }
    const blob = await writer.close();
    return new Uint8Array(await blob.arrayBuffer());
};

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

export const zipExportFile = async (sourcePath: string, zipPath: string, password?: string) => {
    try {
        await Bun.write(
            zipPath,
            await createZip({ [path.basename(sourcePath)]: await readZipFile(sourcePath) }, password),
        );
    } catch (error) {
        await rm(zipPath, { force: true }).catch(() => undefined);
        throw error;
    }
};

/**
 * Recursively collects regular files (not directory-entry symlinks), reads all
 * contents into memory, then compresses a ZIP at level 9. Password-protected
 * archives use AES-256. This is not a streaming or fixed-heap export despite
 * accepting filesystem paths.
 * On failure, removes the partial destination best-effort and rethrows. The caller
 * owns source-directory cleanup and any stable-source snapshot validation.
 */
export const zipExportDirectory = async (sourceDirectory: string, zipPath: string, password?: string) => {
    try {
        await Bun.write(zipPath, await createZip(await readZipDirectory(sourceDirectory), password));
    } catch (error) {
        await rm(zipPath, { force: true }).catch(() => undefined);
        throw error;
    }
};
