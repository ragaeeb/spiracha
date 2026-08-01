import type { ConversationDetail, ConversationEvidenceEvent } from './types';

const PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\.?\.?\/)[^\s"'`<>|]+/gu;
const MAX_REFERENCE_SCAN_CHARACTERS = 100_000;
const MAX_REFERENCES_PER_EVENT = 64;
const MAX_ARTIFACT_REFERENCE_CHARACTERS = 1_024;

const collectMetadataStrings = (value: unknown, output: string[], depth = 0): void => {
    if (output.length >= MAX_REFERENCES_PER_EVENT || depth > 4) {
        return;
    }
    if (typeof value === 'string') {
        output.push(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value.slice(0, MAX_REFERENCES_PER_EVENT)) {
            collectMetadataStrings(item, output, depth + 1);
        }
        return;
    }
    if (!value || typeof value !== 'object') {
        return;
    }
    for (const item of Object.values(value).slice(0, MAX_REFERENCES_PER_EVENT)) {
        collectMetadataStrings(item, output, depth + 1);
    }
};

const extractArtifacts = (text: string, metadata: Record<string, unknown>): string[] => {
    const values = [text.slice(0, MAX_REFERENCE_SCAN_CHARACTERS)];
    collectMetadataStrings(metadata, values);
    const artifacts = new Set<string>();
    for (const value of values) {
        for (const match of value.match(PATH_PATTERN) ?? []) {
            artifacts.add(match.replace(/[),.;:\]}>]+$/u, '').slice(0, MAX_ARTIFACT_REFERENCE_CHARACTERS));
            if (artifacts.size >= MAX_REFERENCES_PER_EVENT) {
                return [...artifacts];
            }
        }
    }
    return [...artifacts];
};

export const buildEvidenceEvents = (conversation: ConversationDetail): ConversationEvidenceEvent[] => {
    return [...conversation.messages]
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
        .map((message) => {
            const metadata = { ...conversation.metadata, ...message.metadata };
            return {
                artifacts: extractArtifacts(message.text, metadata),
                conversationId: conversation.id,
                createdAtMs: message.createdAtMs,
                messageId: message.id,
                metadata,
                order: message.order,
                pairingConfidence: 'unpaired' as const,
                phase: message.phase,
                role: message.role,
                source: conversation.source,
                text: message.text,
                tool: message.toolEvidence ?? null,
            };
        });
};
