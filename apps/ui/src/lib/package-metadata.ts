import packageJsonRaw from '../../../../package.json?raw';

type PackageMetadata = {
    homepage: string;
    version: string;
};

const parsePackageMetadata = (): PackageMetadata => {
    const packageJson = JSON.parse(packageJsonRaw) as Partial<PackageMetadata>;
    return {
        homepage: typeof packageJson.homepage === 'string' ? packageJson.homepage : '',
        version: typeof packageJson.version === 'string' ? packageJson.version : '0.0.0',
    };
};

export const packageMetadata = parsePackageMetadata();
