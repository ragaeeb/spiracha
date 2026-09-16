export type PathDisplaySettings = {
    convertToProjectRoot: boolean;
    projectPath?: string | null;
    redactUsername: boolean;
};

const escapeForRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const toUniquePathVariants = (projectPath: string) => {
    const trimmed = projectPath.trim();
    const normalized = trimmed.replace(/[\\/]+$/u, '') || trimmed;
    const variants = [normalized, normalized.replaceAll('\\', '/'), normalized.replaceAll('/', '\\')].filter(Boolean);
    return [...new Set(variants)].sort((left, right) => right.length - left.length);
};

const toFileUri = (pathVariant: string) =>
    pathVariant.startsWith('\\\\') ? `file://${pathVariant.slice(2).replaceAll('\\', '/')}` : `file://${pathVariant}`;

const replaceExactProjectPath = (text: string, projectPath: string) => {
    let result = text;

    for (const variant of toUniquePathVariants(projectPath)) {
        result = result.replaceAll(toFileUri(variant), () => variant);
        if (/^[A-Za-z]:[\\/]/u.test(variant)) {
            result = result.replaceAll(`file:///${variant}`, () => variant);
        }
        const escapedVariant = escapeForRegex(variant);
        result = result.replace(new RegExp(`${escapedVariant}(?<separator>[\\\\/])`, 'gu'), '');
        result = result.replace(new RegExp(`${escapedVariant}(?=$|[^A-Za-z0-9._-])`, 'gu'), '.');
    }

    return result;
};

const redactRemainingUsernames = (text: string) => {
    return (
        text
            // Prefer complete path components so spaces in usernames remain redacted.
            .replace(/(?:[A-Za-z]:[\\/]+Users[\\/]+|\/(?:home|Users)\/)[^/\\\r\n`"<>]*[^\s/\\`"<>](?=[/\\])/gu, '~')
            .replace(
                /(?:[A-Za-z]:[\\/]+Users[\\/]+|\/(?:home|Users)\/)(?:[A-Z][^/\\\s`"'<>()[\]{};,.!?]+ )+[A-Z][^/\\\s`"'<>()[\]{};,.!?]+(?=$|[.,;:!?)\]])/gu,
                '~',
            )
            .replace(/\/home\/[^/\\\s`"'<>()[\]{};,]+(?=[/\\\s`"'<>()[\]{};,]|$)/gu, '~')
            .replace(/\/Users\/[^/\\\s`"'<>()[\]{};,]+(?=[/\\\s`"'<>()[\]{};,]|$)/gu, '~')
            .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s`"'<>()[\]{};,]+(?=[\\/\s`"'<>()[\]{};,]|$)/gu, '~')
    );
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
