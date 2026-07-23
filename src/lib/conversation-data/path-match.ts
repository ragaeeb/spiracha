import path from 'node:path';
import { expandHome } from '../shared';
import type { ConversationPathMatch } from './types';

const trimTrailingSeparators = (value: string) => {
    if (/^[A-Za-z]:\/+$/u.test(value)) {
        return `${value.slice(0, 2)}/`;
    }
    const trimmed = value.replace(/[\\/]+$/u, '');
    return trimmed || value;
};

const normalizeSeparators = (value: string) => value.replace(/\\/gu, '/');

export const normalizeConversationPath = async (value: string): Promise<string> => {
    const expanded = expandHome(value.trim());
    const separated = normalizeSeparators(expanded);
    const absolute = /^(?:[A-Za-z]:\/|\/)/u.test(separated) ? separated : normalizeSeparators(path.resolve(expanded));
    const normalized = absolute.startsWith('//')
        ? `//${path.posix.normalize(absolute.slice(2))}`
        : path.posix.normalize(absolute);
    return trimTrailingSeparators(normalized);
};

const getNormalizedPathMatch = (requested: string, candidate: string): ConversationPathMatch | null => {
    if (requested === candidate) {
        return {
            candidatePath: candidate,
            kind: 'exact',
            requestedPath: requested,
        };
    }

    if (
        (requested === '/' && candidate !== '/' && candidate.startsWith('/')) ||
        candidate.startsWith(`${requested}/`)
    ) {
        return {
            candidatePath: candidate,
            kind: 'descendant',
            requestedPath: requested,
        };
    }

    return null;
};

export const getConversationPathMatch = async (
    requestedPath: string,
    candidatePath: string | null,
): Promise<ConversationPathMatch | null> => {
    if (!candidatePath?.trim()) {
        return null;
    }

    const [requested, candidate] = await Promise.all([
        normalizeConversationPath(requestedPath),
        normalizeConversationPath(candidatePath),
    ]);

    return getNormalizedPathMatch(requested, candidate);
};

export const getFirstConversationPathMatch = async (
    requestedPath: string,
    candidatePaths: Array<string | null>,
): Promise<ConversationPathMatch | null> => {
    const requested = await normalizeConversationPath(requestedPath);
    for (const candidatePath of candidatePaths) {
        if (!candidatePath?.trim()) {
            continue;
        }
        const candidate = await normalizeConversationPath(candidatePath);
        const match = getNormalizedPathMatch(requested, candidate);
        if (match) {
            return match;
        }
    }

    return null;
};
