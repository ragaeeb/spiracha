import packageJson from '#package-metadata';

type PackageMetadata = {
    homepage: string;
    version: string;
};

export const parsePackageMetadata = (value: unknown): PackageMetadata => {
    if (!value || typeof value !== 'object') {
        throw new Error('Spiracha package metadata must be an object.');
    }

    const metadata = value as Partial<PackageMetadata>;
    if (typeof metadata.homepage !== 'string' || !metadata.homepage.trim()) {
        throw new Error('Spiracha package metadata is missing a homepage.');
    }
    if (typeof metadata.version !== 'string' || !metadata.version.trim()) {
        throw new Error('Spiracha package metadata is missing a version.');
    }

    return {
        homepage: metadata.homepage,
        version: metadata.version,
    };
};

export const packageMetadata = parsePackageMetadata(packageJson);
