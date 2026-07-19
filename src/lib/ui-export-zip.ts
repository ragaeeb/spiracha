import { readdir } from 'node:fs/promises';
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
    await Bun.write(zipPath, await createZip({ [path.basename(sourcePath)]: await readZipFile(sourcePath) }));
};

export const zipExportDirectory = async (sourceDirectory: string, zipPath: string) => {
    await Bun.write(zipPath, await createZip(await readZipDirectory(sourceDirectory)));
};
