import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { asObject, asString, expandHome, type JsonValue, type MetadataEntry, readJsonlObjects } from './shared';

const FALSEY = new Set(['0', 'false', 'no', 'off']);
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export type HeadroomRehydrationContext = {
    client?: string | null;
    model?: string | null;
    provider?: string | null;
    requestId?: string | null;
    sessionId?: string | null;
};

export type HeadroomRehydrationOptions = {
    archiveDir?: string | null;
    rehydrateHeadroom?: boolean;
};

export type HeadroomRehydrationMetadata = {
    archiveDir: string | null;
    applied: boolean;
    count: number;
};

export type HeadroomRehydrator = {
    metadata: () => HeadroomRehydrationMetadata;
    rehydrateText: (text: string, context?: HeadroomRehydrationContext) => string;
};

type ReplacementRecord = {
    client: string | null;
    model: string | null;
    originalText: string;
    provider: string | null;
    requestId: string | null;
    rewrittenText: string;
    rewrittenTextSha256: string;
    sessionId: string | null;
};

type ReplacementIndex = {
    archiveDir: string;
    byRewrittenSha: Map<string, ReplacementRecord[]>;
    byRewrittenText: Map<string, ReplacementRecord[]>;
};

export const getDefaultHeadroomTranscriptArchiveDir = (
    _env: NodeJS.ProcessEnv = process.env,
    homeDir = os.homedir(),
): string => path.join(homeDir, '.headroom', 'transcript_archive');

export const resolveHeadroomTranscriptArchiveDir = (): string => {
    const configured =
        process.env.SPIRACHA_HEADROOM_TRANSCRIPT_ARCHIVE_DIR?.trim() ||
        process.env.SPIRACHA_HEADROOM_ARCHIVE_DIR?.trim() ||
        process.env.HEADROOM_TRANSCRIPT_ARCHIVE_DIR?.trim();
    return configured ? expandHome(configured) : getDefaultHeadroomTranscriptArchiveDir();
};

const isExplicitlyDisabled = (): boolean => {
    const noRehydrate = process.env.SPIRACHA_NO_REHYDRATE_HEADROOM?.trim().toLowerCase();
    if (noRehydrate && TRUTHY.has(noRehydrate)) {
        return true;
    }

    const rehydrate = process.env.SPIRACHA_REHYDRATE_HEADROOM?.trim().toLowerCase();
    return Boolean(rehydrate && FALSEY.has(rehydrate));
};

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const listArchiveFiles = (archiveDir: string): string[] => {
    if (!existsSync(archiveDir)) {
        return [];
    }

    return readdirSync(archiveDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
        .map((entry) => path.join(archiveDir, entry.name))
        .sort();
};

const readJsonlObjectsSync = (filePath: string): Record<string, JsonValue>[] => {
    const text = readFileSync(filePath, 'utf8');
    return text.split(/\r?\n/u).flatMap((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
            return [];
        }

        try {
            const parsed = JSON.parse(trimmed) as JsonValue;
            const object = asObject(parsed);
            return object ? [object] : [];
        } catch {
            return [];
        }
    });
};

const toReplacementRecord = (event: Record<string, JsonValue>): ReplacementRecord | null => {
    if (event.schema_version !== 1 || event.event_type !== 'replacement') {
        return null;
    }

    const originalText = asString(event.original_text ?? null);
    const rewrittenText = asString(event.rewritten_text ?? null);
    const rewrittenTextSha256 =
        asString(event.rewritten_text_sha256 ?? null) ?? (rewrittenText ? sha256(rewrittenText) : null);
    if (!originalText || !rewrittenText || !rewrittenTextSha256) {
        return null;
    }

    return {
        client: asString(event.client ?? null),
        model: asString(event.model ?? null),
        originalText,
        provider: asString(event.provider ?? null),
        requestId: asString(event.request_id ?? null),
        rewrittenText,
        rewrittenTextSha256,
        sessionId: asString(event.session_id ?? null),
    };
};

const pushIndexValue = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const values = map.get(key) ?? [];
    values.push(value);
    map.set(key, values);
};

export const loadHeadroomReplacementIndex = (archiveDir = resolveHeadroomTranscriptArchiveDir()): ReplacementIndex => {
    const byRewrittenSha = new Map<string, ReplacementRecord[]>();
    const byRewrittenText = new Map<string, ReplacementRecord[]>();

    for (const archiveFile of listArchiveFiles(archiveDir)) {
        for (const event of readJsonlObjectsSync(archiveFile)) {
            const replacement = toReplacementRecord(event);
            if (!replacement) {
                continue;
            }

            pushIndexValue(byRewrittenSha, replacement.rewrittenTextSha256, replacement);
            pushIndexValue(byRewrittenText, replacement.rewrittenText, replacement);
        }
    }

    return { archiveDir, byRewrittenSha, byRewrittenText };
};

export const loadHeadroomReplacementIndexAsync = async (
    archiveDir = resolveHeadroomTranscriptArchiveDir(),
): Promise<ReplacementIndex> => {
    const byRewrittenSha = new Map<string, ReplacementRecord[]>();
    const byRewrittenText = new Map<string, ReplacementRecord[]>();

    for (const archiveFile of listArchiveFiles(archiveDir)) {
        for await (const event of readJsonlObjects(archiveFile)) {
            const replacement = toReplacementRecord(event);
            if (!replacement) {
                continue;
            }

            pushIndexValue(byRewrittenSha, replacement.rewrittenTextSha256, replacement);
            pushIndexValue(byRewrittenText, replacement.rewrittenText, replacement);
        }
    }

    return { archiveDir, byRewrittenSha, byRewrittenText };
};

const scoreCandidate = (replacement: ReplacementRecord, context: HeadroomRehydrationContext): number => {
    const fields: Array<[keyof HeadroomRehydrationContext, keyof ReplacementRecord, number]> = [
        ['requestId', 'requestId', 8],
        ['sessionId', 'sessionId', 6],
        ['provider', 'provider', 4],
        ['client', 'client', 3],
        ['model', 'model', 1],
    ];

    return fields.reduce((score, [contextKey, replacementKey, weight]) => {
        const contextValue = context[contextKey];
        return contextValue && replacement[replacementKey] === contextValue ? score + weight : score;
    }, 0);
};

const chooseReplacement = (
    candidates: ReplacementRecord[],
    context: HeadroomRehydrationContext = {},
): ReplacementRecord | null => {
    if (candidates.length === 0) {
        return null;
    }

    return [...candidates].sort((left, right) => scoreCandidate(right, context) - scoreCandidate(left, context))[0]!;
};

export const createHeadroomRehydrator = (index: ReplacementIndex): HeadroomRehydrator => {
    let appliedCount = 0;

    return {
        metadata: () => ({
            applied: appliedCount > 0,
            archiveDir: index.archiveDir,
            count: appliedCount,
        }),
        rehydrateText: (text, context = {}) => {
            if (!text) {
                return text;
            }

            const candidates = [
                ...(index.byRewrittenSha.get(sha256(text)) ?? []),
                ...(index.byRewrittenText.get(text) ?? []),
            ];
            const replacement = chooseReplacement(candidates, context);
            if (!replacement) {
                return text;
            }

            appliedCount += 1;
            return replacement.originalText;
        },
    };
};

export const resolveHeadroomRehydrator = (options: HeadroomRehydrationOptions = {}): HeadroomRehydrator | null => {
    if (options.rehydrateHeadroom === false || isExplicitlyDisabled()) {
        return null;
    }

    const archiveDir = expandHome(options.archiveDir?.trim() || resolveHeadroomTranscriptArchiveDir());
    if (options.rehydrateHeadroom !== true) {
        try {
            if (!statSync(archiveDir).isDirectory()) {
                return null;
            }
        } catch {
            return null;
        }
    }

    return createHeadroomRehydrator(loadHeadroomReplacementIndex(archiveDir));
};

export const buildHeadroomMetadataEntries = (rehydrator: HeadroomRehydrator | null): MetadataEntry[] => {
    const metadata = rehydrator?.metadata();
    if (!metadata?.applied) {
        return [];
    }

    return [
        { key: 'headroom_rehydrated', value: true },
        { key: 'headroom_rehydration_count', value: metadata.count },
        { key: 'headroom_archive_dir', value: metadata.archiveDir },
    ];
};
