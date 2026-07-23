import { describe, expect, it } from 'vitest';
import { shouldLoadFullThreadTranscript, shouldRequestThreadTranscript } from './thread-transcript-load';

describe('thread transcript load helpers', () => {
    it('should preserve explicit full-load requests while deferring large transcripts by default', () => {
        expect(
            shouldRequestThreadTranscript({
                fullRequested: false,
                shouldDeferTranscriptLoad: true,
                transcriptMissing: false,
            }),
        ).toBe(false);
        expect(
            shouldRequestThreadTranscript({
                fullRequested: true,
                shouldDeferTranscriptLoad: true,
                transcriptMissing: false,
            }),
        ).toBe(true);
        expect(
            shouldRequestThreadTranscript({
                fullRequested: false,
                shouldDeferTranscriptLoad: false,
                transcriptMissing: false,
            }),
        ).toBe(true);
    });

    it('should allow loading a full transcript when the snapshot only has a partial preview', () => {
        expect(
            shouldLoadFullThreadTranscript({
                shouldLoadTranscript: true,
                snapshotTranscript: { isPartial: true },
                transcriptMissing: false,
            }),
        ).toBe(true);
    });

    it('should not load again when the snapshot already has the full transcript', () => {
        expect(
            shouldLoadFullThreadTranscript({
                shouldLoadTranscript: true,
                snapshotTranscript: { isPartial: false },
                transcriptMissing: false,
            }),
        ).toBe(false);
    });

    it('should require an explicit load request and an available transcript file', () => {
        expect(
            shouldLoadFullThreadTranscript({
                shouldLoadTranscript: false,
                snapshotTranscript: { isPartial: true },
                transcriptMissing: false,
            }),
        ).toBe(false);
        expect(
            shouldLoadFullThreadTranscript({
                shouldLoadTranscript: true,
                snapshotTranscript: { isPartial: true },
                transcriptMissing: true,
            }),
        ).toBe(false);
    });
});
