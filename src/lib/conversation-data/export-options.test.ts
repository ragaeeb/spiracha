import { describe, expect, it } from 'bun:test';
import {
    CONVERSATION_ONLY_EXPORT_INCLUDE,
    DEFAULT_NORMALIZED_EXPORT_OPTIONS,
    expandNormalizedExportOptions,
    FULL_AVAILABLE_EXPORT_INCLUDE,
} from './export-options';

describe('normalized export options', () => {
    it('should default to full available content without bootstrap or synthetic events', () => {
        expect(expandNormalizedExportOptions()).toEqual(DEFAULT_NORMALIZED_EXPORT_OPTIONS);
        expect(FULL_AVAILABLE_EXPORT_INCLUDE.bootstrap).toBe(false);
        expect(FULL_AVAILABLE_EXPORT_INCLUDE.synthetic).toBe(false);
        expect(FULL_AVAILABLE_EXPORT_INCLUDE.reasoning).toBe(true);
        expect(FULL_AVAILABLE_EXPORT_INCLUDE.commentary).toBe(true);
    });

    it('should expand compact tool and commentary flags without coupling reasoning', () => {
        const expanded = expandNormalizedExportOptions({
            includeCommentary: false,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'txt',
        });
        expect(expanded.format).toBe('txt');
        expect(expanded.include.commentary).toBe(false);
        expect(expanded.include.reasoning).toBe(true);
        expect(expanded.include.toolCalls).toBe(false);
        expect(expanded.include.toolOutputs).toBe(false);
        expect(expanded.include.metadata).toBe(false);
        expect(expanded.include.user).toBe(true);
    });

    it('should keep conversation-only preset independent of commentary and tools', () => {
        expect(CONVERSATION_ONLY_EXPORT_INCLUDE).toMatchObject({
            assistantFinal: true,
            commentary: false,
            reasoning: false,
            toolCalls: false,
            toolOutputs: false,
            user: true,
        });
    });
});
