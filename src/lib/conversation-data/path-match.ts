import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { expandHome } from '../shared';
import type { ConversationPathMatch } from './types';

const trimTrailingSeparators = (value: string) => {
    const trimmed = value.replace(/[\\/]+$/u, '');
    return trimmed || value;
};

const normalizeSeparators = (value: string) => value.replace(/\\/gu, '/');

export const normalizeConversationPath = async (value: string): Promise<string> => {
    const expanded = expandHome(value.trim());
    const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(expanded);
    const resolved = await realpath(absolute).catch(() => absolute);
    return normalizeSeparators(trimTrailingSeparators(resolved));
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

export const getFirstConversationPathMatch = async (
    requestedPath: string,
    candidatePaths: Array<string | null>,
): Promise<ConversationPathMatch | null> => {
    for (const candidatePath of candidatePaths) {
        const match = await getConversationPathMatch(requestedPath, candidatePath);
        if (match) {
            return match;
        }
    }

    return null;
};
