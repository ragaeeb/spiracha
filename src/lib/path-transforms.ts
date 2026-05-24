export type PathDisplaySettings = {
    convertToProjectRoot: boolean;
    projectPath?: string | null;
    redactUsername: boolean;
};

const escapeForRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const toUniquePathVariants = (projectPath: string) => {
    const normalized = projectPath.trim();
    const variants = [normalized, normalized.replaceAll('\\', '/'), normalized.replaceAll('/', '\\')].filter(Boolean);
    return [...new Set(variants)].sort((left, right) => right.length - left.length);
};

const replaceExactProjectPath = (text: string, projectPath: string) => {
    let result = text;

    for (const variant of toUniquePathVariants(projectPath)) {
        const escapedVariant = escapeForRegex(variant);
        result = result.replace(new RegExp(`${escapedVariant}(?<separator>[\\\\/])`, 'gu'), '');
        result = result.replace(new RegExp(`${escapedVariant}(?=$|[^A-Za-z0-9._-])`, 'gu'), '.');
    }

    return result;
};

const redactRemainingUsernames = (text: string) => {
    return text
        .replace(/\/Users\/[^/\\]+(?=\/|$)/gu, '~')
        .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/]+(?=[\\/]|$)/gu, '~');
};

export const applyPathTransforms = (text: string, settings: PathDisplaySettings): string => {
    let result = text;

    if (settings.convertToProjectRoot && settings.projectPath) {
        result = replaceExactProjectPath(result, settings.projectPath);
    }

    if (settings.redactUsername) {
        result = redactRemainingUsernames(result);
    }

    return result;
};
