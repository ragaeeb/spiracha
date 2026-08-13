import { applyPathTransforms as applySharedPathTransforms } from '@spiracha/lib/path-transforms';
import type { Settings } from './settings';

export const applyPathTransforms = (
    text: string,
    settings: Pick<Settings, 'convertToProjectRoot' | 'redactUsername'>,
    projectPath: string | null,
) => {
    return applySharedPathTransforms(text, {
        ...settings,
        projectPath,
    });
};
