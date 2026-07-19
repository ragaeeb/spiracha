import type { EvidenceOmissionStats } from './types';

const MAX_JSON_PARSE_CHARACTERS = 100_000;
const ARRAY_SAMPLE_SIZE = 3;
const STRUCTURED_DEPTH_LIMIT = 6;
const HIGH_SIGNAL_KEY =
    /(?:status|outcome|code|message|guidance|schema|version|session|artifact|error|warning|diagnostic|duration|count|path|id)/iu;

export type EvidenceProjectionState = {
    diagnostics: Set<string>;
    stats: EvidenceOmissionStats;
};

export const createEvidenceProjectionState = (
    inputEvents: number,
    inputCharacters: number,
): EvidenceProjectionState => ({
    diagnostics: new Set<string>(),
    stats: {
        budgetReached: false,
        deduplicatedDiagnostics: 0,
        inputCharacters,
        inputEvents,
        omittedBinaryPayloads: 0,
        omittedEvents: inputEvents,
        selectedEvents: 0,
        truncatedArrays: 0,
        truncatedFields: 0,
    },
});

const looksOpaque = (text: string) => {
    const prefix = text.slice(0, 128).toLowerCase();
    if (prefix.includes('base64,') || prefix.includes('encrypted_content')) {
        return true;
    }
    if (text.length < 1024) {
        return false;
    }
    const sample = text.slice(0, 2048);
    return /^[A-Za-z0-9+/=\r\n]+$/u.test(sample) && sample.replace(/[\r\n]/gu, '').length > 1000;
};

const projectStructured = (value: unknown, state: EvidenceProjectionState, depth = 0): unknown => {
    if (depth >= STRUCTURED_DEPTH_LIMIT) {
        state.stats.truncatedFields += 1;
        return '[omitted: depth limit]';
    }
    if (Array.isArray(value)) {
        if (value.length > ARRAY_SAMPLE_SIZE) {
            state.stats.truncatedArrays += 1;
        }
        return {
            itemCount: value.length,
            sample: value.slice(0, ARRAY_SAMPLE_SIZE).map((item) => projectStructured(item, state, depth + 1)),
            ...(value.length > ARRAY_SAMPLE_SIZE ? { omittedItems: value.length - ARRAY_SAMPLE_SIZE } : {}),
        };
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
        left.localeCompare(right),
    );
    const highSignal = entries.filter(([key]) => HIGH_SIGNAL_KEY.test(key));
    const selected = highSignal.length > 0 ? highSignal.slice(0, 32) : entries.slice(0, 12);
    if (selected.length < entries.length) {
        state.stats.truncatedFields += entries.length - selected.length;
    }
    return Object.fromEntries(selected.map(([key, item]) => [key, projectStructured(item, state, depth + 1)]));
};

const truncateHeadTail = (text: string, maximum: number, state: EvidenceProjectionState) => {
    if (maximum <= 0) {
        return '';
    }
    if (text.length <= maximum) {
        return text;
    }
    state.stats.truncatedFields += 1;
    if (maximum < 80) {
        return `[truncated ${text.length} characters]`.slice(0, maximum);
    }
    const marker = `\n… [truncated ${text.length - maximum} characters] …\n`;
    const retained = Math.max(0, maximum - marker.length);
    const head = Math.ceil(retained * 0.65);
    return `${text.slice(0, head)}${marker}${text.slice(text.length - (retained - head))}`;
};

const diagnosticFingerprint = (text: string) => {
    const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /(?:error|warn|fail|diagnostic|guidance)/iu.test(line));
    return lines.join('\n');
};

export const projectEvidenceText = (text: string, maximum: number, state: EvidenceProjectionState): string => {
    if (!text) {
        return '';
    }
    if (looksOpaque(text)) {
        state.stats.omittedBinaryPayloads += 1;
        return '[omitted binary or opaque payload]';
    }
    const diagnostic = diagnosticFingerprint(text);
    if (diagnostic && state.diagnostics.has(diagnostic)) {
        state.stats.deduplicatedDiagnostics += 1;
        return '[deduplicated diagnostic]';
    }
    if (diagnostic) {
        state.diagnostics.add(diagnostic);
    }
    if (text.length <= MAX_JSON_PARSE_CHARACTERS && /^[\s]*[[{]/u.test(text)) {
        try {
            const structured = projectStructured(JSON.parse(text), state);
            return truncateHeadTail(JSON.stringify(structured, null, 2), maximum, state);
        } catch {
            // Unknown structured-looking text uses the bounded text projection below.
        }
    }
    return truncateHeadTail(text, maximum, state);
};

export const fencedEvidenceText = (text: string) => {
    const longestFence = Math.max(0, ...[...text.matchAll(/`+/gu)].map((match) => match[0].length));
    const fence = '`'.repeat(Math.max(3, longestFence + 1));
    return `${fence}text\n${text}\n${fence}`;
};
