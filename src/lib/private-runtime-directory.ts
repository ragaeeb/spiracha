import { chmod, lstat, mkdir } from 'node:fs/promises';

const PRIVATE_DIRECTORY_MODE = 0o700;

const assertPrivateRuntimeDirectory = async (directory: string, label: string) => {
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error(`Unsafe Spiracha ${label} directory: ${directory}`);
    }

    if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
        throw new Error(`Spiracha ${label} directory is not owned by the current user: ${directory}`);
    }

    if ((metadata.mode & 0o777) !== PRIVATE_DIRECTORY_MODE) {
        await chmod(directory, PRIVATE_DIRECTORY_MODE);
        const refreshed = await lstat(directory);
        if (
            !refreshed.isDirectory() ||
            refreshed.isSymbolicLink() ||
            (refreshed.mode & 0o777) !== PRIVATE_DIRECTORY_MODE
        ) {
            throw new Error(`Unsafe Spiracha ${label} directory: ${directory}`);
        }
    }

    return metadata;
};

export const ensurePrivateRuntimeDirectory = async (directory: string, label: string) => {
    await mkdir(directory, { mode: PRIVATE_DIRECTORY_MODE, recursive: true });
    await assertPrivateRuntimeDirectory(directory, label);
    return directory;
};

export const assertPrivateRuntimeDirectorySafe = assertPrivateRuntimeDirectory;
